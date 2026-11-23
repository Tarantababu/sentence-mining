from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.schemas.openai_payloads import GeneratedPack
from app.services.memory_engine import RankedUnit, rotate_card_types, select_due_then_stretch
from app.services.openai_client import complete_json
from app.services.unit_catalog import CATALOG_BY_KEY

LLM_CARD_CAP = 8


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


def blank_from_pair(raw: str, correct: str) -> tuple[str, str]:
    original = [part for part in re.sub(r"\s+", " ", raw).strip().split(" ") if part]
    target = [part for part in re.sub(r"\s+", " ", correct).strip().split(" ") if part]
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
    why = (unit.why or "").strip() or f"Keep this natural: {correct}"
    if raw and correct:
        if card_type == "fill_in_blank":
            prompt, answer = blank_from_pair(raw, correct)
            return prompt, answer, why
        if card_type == "fix_error":
            return f"Fix: {raw}", correct, why
        return f"Rewrite naturally: {raw}", correct, why
    defn = CATALOG_BY_KEY.get(unit.key)
    if defn and card_type in defn.templates:
        return defn.templates[card_type]
    if card_type == "fill_in_blank":
        prompt, answer = blank_from_pair(unit.label, unit.label)
        return prompt, answer, f"Use the natural phrase: {unit.label}."
    if card_type == "fix_error":
        return f"Fix: {unit.label}", unit.label, f"Keep {unit.label} as a set phrase."
    return (
        f"Rewrite naturally: {unit.label}",
        unit.label,
        f"Keep the surrounding English simple; target {unit.label}.",
    )


def _merge_why(units: list[RankedUnit]) -> str:
    return " · ".join(unit.label for unit in units)


def fallback_pack(
    ranked: list[RankedUnit],
    budget_cards: int,
    budget_prompts: int,
) -> DraftPack:
    groups = select_due_then_stretch(ranked, budget_cards)
    types = rotate_card_types(len(groups))
    cards: list[DraftCard] = []
    for index, group in enumerate(groups):
        card_type = types[index]
        primary = group[0]
        prompt, answer, why = _template_for(primary, card_type)
        if len(group) == 2:
            why = f"{why} Also keep {group[1].label} in mind."
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
                unit_keys=[unit.key for unit in group],
                skill_tags=tags,
                queue=queue,
            )
        )

    prompts: list[DraftPrompt] = []
    for unit in ranked[:budget_prompts]:
        target = unit.correct or unit.label
        prompts.append(
            DraftPrompt(
                prompt=f"Tell a 20-second story that naturally uses “{target}”. Keep everything else easy.",
                unit_keys=[unit.key],
                why=unit.why or "This phrase needs a spoken pass in a real conversation.",
            )
        )
    if budget_prompts > len(prompts) and len(ranked) >= 2:
        pair = ranked[:2]
        prompts.append(
            DraftPrompt(
                prompt=(
                    f"Compare two recent situations using "
                    f"“{pair[0].correct or pair[0].label}” and “{pair[1].correct or pair[1].label}”."
                ),
                unit_keys=[unit.key for unit in pair],
                why=_merge_why(pair),
            )
        )
    return DraftPack(cards=cards, speaking_prompts=prompts[:budget_prompts], generator="fallback")


def _merge_llm_pack(
    skeleton: DraftPack,
    payload: GeneratedPack,
    allowed_keys: set[str],
    skill_lookup: dict[str, list[str]],
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
        kept_llm = True
        tags: list[str] = []
        for key in keys:
            for tag in skill_lookup.get(key, []):
                if tag not in tags:
                    tags.append(tag)
        queue = "due" if any(queue_by_key.get(key) == "due" for key in keys) else (
            skeleton.cards[len(cards)].queue if len(cards) < len(skeleton.cards) else "due"
        )
        cards.append(
            DraftCard(
                card_type=card.card_type,
                prompt=card.prompt.strip(),
                answer=card.answer.strip(),
                why=card.why.strip(),
                unit_keys=keys,
                skill_tags=tags,
                queue=queue,
            )
        )
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
    skeleton = fallback_pack(ranked, budget_cards, budget_prompts)
    if not ranked:
        return skeleton

    allowed = {unit.key for unit in ranked}
    skill_lookup = {unit.key: unit.skill_tags for unit in ranked}
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
            for unit in ranked[:16]
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
            "i+1: each card targets 1–2 weak units; surrounding English stays easy and adult.",
            "fill_in_blank: one natural sentence with _____ only on the target.",
            "fix_error: show the learner's You said line; answer is the Correct sentence.",
            "transform_sentence: ask for a rewrite; answer is the Correct sentence.",
            "Use you_said / correct / why from the units. Do not invent a different grammar point.",
            "prompt, answer, and why are human language only — never unit slugs.",
            "Keep unit_keys in JSON only. Keep card_type. Keep due cards first.",
        ],
    }
    system = (
        "You write i+1 English practice cards for an adult learner from their own speaking errors. "
        "Prefer the learner's Correct sentence. Blank or repair only the weak point. "
        "Never put unit slugs in prompt, answer, or why. "
        "Return JSON {cards:[{card_type,prompt,answer,why,unit_keys}],"
        "speaking_prompts:[{prompt,unit_keys,why}]}."
    )
    llm = complete_json(system, json.dumps(user), GeneratedPack, timeout_seconds=20.0)
    if llm is None:
        return skeleton
    merged = _merge_llm_pack(skeleton, llm, allowed, skill_lookup, budget_cards, budget_prompts)
    return merged if merged.cards else skeleton
