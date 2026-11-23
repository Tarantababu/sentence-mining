from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.schemas.openai_payloads import GeneratedPack
from app.services.memory_engine import RankedUnit, rotate_card_types, select_due_then_stretch
from app.services.openai_client import complete_json
from app.services.unit_catalog import CATALOG_BY_KEY

LLM_CARD_CAP = 8
_DUMMY_CARRIER = re.compile(
    r"in a short everyday sentence|\bi will mention\b|\bi'll mention\b|"
    r"keep the surrounding english simple|before dinner",
    re.I,
)


@dataclass
class DraftCard:
    card_type: str
    prompt: str
    answer: str
    why: str
    unit_keys: list[str]
    skill_tags: list[str]
    queue: str = "due"


@dataclass
class DraftPrompt:
    prompt: str
    unit_keys: list[str]
    why: str


@dataclass
class DraftPack:
    cards: list[DraftCard]
    speaking_prompts: list[DraftPrompt]
    generator: str


def _tokenize(text: str) -> list[str]:
    return [part for part in re.sub(r"\s+", " ", text).strip().split(" ") if part]


def _normalize(text: str) -> str:
    stripped = re.sub(r"^(complete:|fix:|rewrite[^:]*:)\s*", "", text, flags=re.I)
    cleaned = re.sub(r"[^\w\s']+", " ", stripped.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def word_count(text: str) -> int:
    return len(_tokenize(text))


def is_complete_sentence(text: str) -> bool:
    words = word_count(text)
    return words >= 8 or (words >= 6 and bool(re.search(r"[.?!]", text)))


def is_distinct_pair(raw: str, correct: str) -> bool:
    left = _normalize(raw)
    right = _normalize(correct)
    return bool(left and right and left != right)


def token_overlap(left: str, right: str) -> float:
    source = {word for word in _tokenize(_normalize(left)) if len(word) > 1}
    target = [word for word in _tokenize(_normalize(right)) if len(word) > 1]
    if not source or not target:
        return 0.0
    hits = sum(1 for word in target if word in source)
    return hits / max(len(target), 1)


def is_dummy_carrier(text: str) -> bool:
    return bool(_DUMMY_CARRIER.search(text or ""))


def is_wrapped_sentence(text: str, inner: str) -> bool:
    clause = _normalize(inner)
    haystack = _normalize(text)
    if not clause or word_count(clause) < 6 or clause not in haystack:
        return False
    extra = haystack.replace(clause, " ").strip()
    return len(_tokenize(extra)) >= 3


def can_practice(unit: RankedUnit) -> bool:
    raw = (unit.you_said or "").strip()
    correct = (unit.correct or unit.label or "").strip()
    if is_distinct_pair(raw, correct):
        return True
    if unit.key in CATALOG_BY_KEY and not is_complete_sentence(unit.label):
        return True
    phrase = correct or unit.label
    return 0 < word_count(phrase) <= 6 and not is_complete_sentence(phrase)


def is_valid_iplus1_card(card: DraftCard, source: RankedUnit | None) -> bool:
    prompt = card.prompt.strip()
    answer = card.answer.strip()
    why = card.why.strip()
    if not prompt or not answer:
        return False
    if is_dummy_carrier(prompt) or is_dummy_carrier(answer) or is_dummy_carrier(why):
        return False
    inner = ((source.correct if source else "") or (source.you_said if source else "") or (source.label if source else "")).strip()
    if inner and (is_wrapped_sentence(prompt, inner) or is_wrapped_sentence(answer, inner)):
        return False
    if source and source.label and is_wrapped_sentence(prompt, source.label):
        return False
    if card.card_type == "fill_in_blank":
        if not re.search(r"_{3,}|_____", prompt):
            return False
        return word_count(answer) <= 6
    if _normalize(prompt) == _normalize(answer):
        return False
    if word_count(answer) < 2:
        return False
    raw = (source.you_said if source else "").strip()
    correct = (source.correct if source else "").strip()
    if raw and correct and is_distinct_pair(raw, correct):
        if token_overlap(answer, correct) < 0.35:
            return False
        prompt_looks_like_error = token_overlap(prompt, raw) >= 0.3
        prompt_looks_like_blank = bool(re.search(r"_{3,}|_____", prompt))
        if not prompt_looks_like_error and not prompt_looks_like_blank:
            return False
    return True


def blank_from_pair(raw: str, correct: str) -> tuple[str, str]:
    original = _tokenize(raw)
    target = _tokenize(correct)
    if not target:
        return (f"{correct} _____".strip(), correct)

    def same(left: str, right: str) -> bool:
        return re.sub(r"[^\w']+", "", left).lower() == re.sub(r"[^\w']+", "", right).lower()

    start = 0
    while start < len(original) and start < len(target) and same(original[start], target[start]):
        start += 1
    orig_end = len(original)
    tgt_end = len(target)
    while orig_end > start and tgt_end > start and same(original[orig_end - 1], target[tgt_end - 1]):
        orig_end -= 1
        tgt_end -= 1
    if tgt_end <= start:
        start = start - 1 if start > 0 else 0
        tgt_end = min(len(target), start + 1)
    if start == 0 and tgt_end == len(target) and len(target) >= 4:
        start = max(1, len(target) // 3)
        tgt_end = min(len(target) - 1, start + 2)
    if tgt_end - start > 3:
        tgt_end = start + 2
    answer = " ".join(target[start:tgt_end]).strip() or target[-1]
    before = " ".join(target[:start])
    after = " ".join(target[tgt_end:])
    prompt = f"{before} _____ {after}".replace("  ", " ").strip()
    return prompt, answer


def _template_for(unit: RankedUnit, card_type: str) -> tuple[str, str, str]:
    raw = (unit.you_said or "").strip()
    correct = (unit.correct or unit.label).strip()
    why = (unit.why or "").strip() or "Say the corrected line the way a native speaker would."
    if is_distinct_pair(raw, correct):
        if card_type == "fill_in_blank":
            prompt, answer = blank_from_pair(raw, correct)
            return prompt, answer, why
        return raw, correct, why
    defn = CATALOG_BY_KEY.get(unit.key)
    if defn and card_type in defn.templates:
        return defn.templates[card_type]
    phrase = correct or unit.label
    prompt, answer = blank_from_pair(phrase, phrase)
    return prompt, answer, f"Use this naturally: {phrase}."


def fallback_pack(
    ranked: list[RankedUnit],
    budget_cards: int,
    budget_prompts: int,
) -> DraftPack:
    usable = [unit for unit in ranked if can_practice(unit)]
    groups = select_due_then_stretch(usable, budget_cards)
    types = rotate_card_types(len(groups))
    cards: list[DraftCard] = []
    for index, group in enumerate(groups):
        card_type = types[index]
        primary = group[0]
        prompt, answer, why = _template_for(primary, card_type)
        partner = group[1] if len(group) == 2 else None
        keys = [primary.key]
        if partner and word_count(partner.label) <= 6:
            why = f"{why} Also keep {partner.label} in mind."
            keys.append(partner.key)
        tags: list[str] = []
        for unit in group:
            for tag in unit.skill_tags:
                if tag not in tags:
                    tags.append(tag)
        queue = "due" if any(unit.queue == "due" for unit in group) else "stretch"
        cards.append(
            DraftCard(
                card_type=card_type,
                prompt=prompt,
                answer=answer,
                why=why,
                unit_keys=keys,
                skill_tags=tags,
                queue=queue,
            )
        )

    spoken = usable or ranked
    prompts: list[DraftPrompt] = []
    for unit in spoken[:budget_prompts]:
        target = (unit.correct or unit.label).strip()
        if is_distinct_pair(unit.you_said or "", target):
            line = f"Say this naturally: “{target}”. Start from what you actually said: “{unit.you_said}”."
        else:
            line = f"Tell a 20-second story that naturally uses “{target}”. Keep everything else easy."
        prompts.append(
            DraftPrompt(
                prompt=line,
                unit_keys=[unit.key],
                why=unit.why or "This needs a spoken pass in a real conversation.",
            )
        )
    return DraftPack(cards=cards, speaking_prompts=prompts[:budget_prompts], generator="fallback")


def _merge_llm_pack(
    skeleton: DraftPack,
    payload: GeneratedPack,
    allowed_keys: set[str],
    skill_lookup: dict[str, list[str]],
    by_key: dict[str, RankedUnit],
    budget_cards: int,
    budget_prompts: int,
) -> DraftPack:
    used: set[str] = set()
    cards: list[DraftCard] = []
    kept_llm = False
    queue_by_key = {card.unit_keys[0]: card.queue for card in skeleton.cards if card.unit_keys}
    for card in payload.cards:
        if len(cards) >= budget_cards:
            break
        keys = [key for key in card.unit_keys if key in allowed_keys][:2]
        if not keys:
            continue
        queue = "due" if any(queue_by_key.get(key) == "due" for key in keys) else (
            skeleton.cards[len(cards)].queue if len(cards) < len(skeleton.cards) else "due"
        )
        tags: list[str] = []
        for key in keys:
            for tag in skill_lookup.get(key, []):
                if tag not in tags:
                    tags.append(tag)
        drafted = DraftCard(
            card_type=card.card_type,
            prompt=card.prompt.strip(),
            answer=card.answer.strip(),
            why=card.why.strip(),
            unit_keys=keys,
            skill_tags=tags,
            queue=queue,
        )
        if not is_valid_iplus1_card(drafted, by_key.get(keys[0])):
            continue
        kept_llm = True
        cards.append(drafted)
        used.update(keys)
    for card in skeleton.cards:
        if len(cards) >= budget_cards:
            break
        if all(key in used for key in card.unit_keys):
            continue
        cards.append(card)
        used.update(card.unit_keys)
    prompts: list[DraftPrompt] = []
    for item in payload.speaking_prompts[:budget_prompts]:
        keys = [key for key in item.unit_keys if key in allowed_keys][:2]
        if not keys:
            continue
        if is_dummy_carrier(item.prompt) or is_dummy_carrier(item.why):
            continue
        prompts.append(DraftPrompt(prompt=item.prompt.strip(), unit_keys=keys, why=item.why.strip()))
    if len(prompts) < min(budget_prompts, 1):
        prompts = skeleton.speaking_prompts
    return DraftPack(
        cards=cards,
        speaking_prompts=prompts[:budget_prompts],
        generator="openai" if kept_llm else "fallback",
    )


def generate_pack(
    ranked: list[RankedUnit],
    budget_cards: int = 8,
    budget_prompts: int = 3,
) -> DraftPack:
    usable = [unit for unit in ranked if can_practice(unit)]
    skeleton = fallback_pack(ranked, budget_cards, budget_prompts)
    if not usable:
        return skeleton

    allowed = {unit.key for unit in usable}
    skill_lookup = {unit.key: unit.skill_tags for unit in usable}
    by_key = {unit.key: unit for unit in usable}
    llm_budget = min(LLM_CARD_CAP, budget_cards, len(skeleton.cards))
    user = {
        "units": [
            {
                "key": unit.key,
                "label": unit.label,
                "kind": unit.kind,
                "you_said": unit.you_said,
                "correct": unit.correct or unit.label,
                "why": unit.why,
                "urgency": round(unit.urgency, 4),
                "p_k": round(unit.p_k, 4),
                "queue": unit.queue,
                "due": unit.due,
                "recurring": unit.is_recurring,
                "focus": unit.is_focus,
            }
            for unit in usable[:16]
        ],
        "skeleton_cards": [
            {
                "card_type": card.card_type,
                "unit_keys": card.unit_keys,
                "prompt": card.prompt,
                "answer": card.answer,
                "why": card.why,
                "queue": card.queue,
            }
            for card in skeleton.cards[:llm_budget]
        ],
        "budget_cards": llm_budget,
        "budget_prompts": budget_prompts,
        "constraints": [
            "i+1: each card targets 1–2 weak points. Surrounding English stays easy and adult.",
            "If you_said and correct exist, the card IS that pair. Do not invent a new sentence around them.",
            "Never wrap a learner sentence inside another sentence. Forbidden: 'I will mention … in a short everyday sentence'.",
            "fill_in_blank: one natural sentence with _____ only on the 1–3 word target. Answer is only those missing words.",
            "fix_error: prompt is the You said line; answer is the Correct line.",
            "transform_sentence: prompt is the You said line; answer is the Correct line.",
            "prompt, answer, and why are human language only — never unit slugs.",
            "Keep unit_keys in JSON only. Keep card_type. Keep due cards first.",
        ],
    }
    system = (
        "You write i+1 English practice cards from the learner's own speaking errors. "
        "The practice item must be the learner's sentence with one small gap or fix — never a dummy carrier. "
        "Never put unit slugs in prompt, answer, or why. "
        "Return JSON {cards:[{card_type,prompt,answer,why,unit_keys}],"
        "speaking_prompts:[{prompt,unit_keys,why}]}."
    )
    llm = complete_json(system, json.dumps(user), GeneratedPack, timeout_seconds=20.0)
    if llm is None:
        return skeleton
    merged = _merge_llm_pack(skeleton, llm, allowed, skill_lookup, by_key, budget_cards, budget_prompts)
    return merged if merged.cards else skeleton
