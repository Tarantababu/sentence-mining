from __future__ import annotations

from dataclasses import dataclass

from app.schemas.openai_payloads import GeneratedPack
from app.services.memory_engine import RankedUnit, rotate_card_types, select_card_groups
from app.services.openai_client import complete_json
from app.services.unit_catalog import CATALOG_BY_KEY


@dataclass
class DraftCard:
    card_type: str
    prompt: str
    answer: str
    why: str
    unit_keys: list[str]
    skill_tags: list[str]


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


def _template_for(unit: RankedUnit, card_type: str) -> tuple[str, str, str]:
    defn = CATALOG_BY_KEY.get(unit.key)
    if defn and card_type in defn.templates:
        return defn.templates[card_type]
    label = unit.label
    if card_type == "fill_in_blank":
        return (f"Complete the natural phrase for: {label}.", label, f"Target unit: {label}.")
    if card_type == "fix_error":
        return (
            f"Fix the sentence so it uses {label} correctly.",
            label,
            f"Focus on {label}.",
        )
    return (
        f"Rewrite a short everyday sentence that uses {label}.",
        label,
        f"Keep the surrounding English simple; target {label}.",
    )


def _merge_why(units: list[RankedUnit]) -> str:
    return " · ".join(unit.label for unit in units)


def fallback_pack(
    ranked: list[RankedUnit],
    budget_cards: int,
    budget_prompts: int,
) -> DraftPack:
    groups = select_card_groups(ranked, budget_cards)
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
        cards.append(
            DraftCard(
                card_type=card_type,
                prompt=prompt,
                answer=answer,
                why=why,
                unit_keys=[unit.key for unit in group],
                skill_tags=tags,
            )
        )

    prompts: list[DraftPrompt] = []
    for unit in ranked[:budget_prompts]:
        prompts.append(
            DraftPrompt(
                prompt=(
                    f"Next session: tell a 20-second story that naturally uses "
                    f"“{unit.label}”. Keep everything else easy."
                ),
                unit_keys=[unit.key],
                why=f"Speak this unit because urgency is high ({unit.urgency:.2f}).",
            )
        )
    if budget_prompts > len(prompts) and len(ranked) >= 2:
        pair = ranked[:2]
        prompts.append(
            DraftPrompt(
                prompt=(
                    f"Next session: compare two recent situations using "
                    f"“{pair[0].label}” and “{pair[1].label}”."
                ),
                unit_keys=[unit.key for unit in pair],
                why=_merge_why(pair),
            )
        )
    return DraftPack(cards=cards, speaking_prompts=prompts[:budget_prompts], generator="fallback")


def _validate_llm_pack(
    payload: GeneratedPack,
    allowed_keys: set[str],
    budget_cards: int,
    budget_prompts: int,
    skill_lookup: dict[str, list[str]],
) -> DraftPack | None:
    cards: list[DraftCard] = []
    for card in payload.cards[:budget_cards]:
        keys = [key for key in card.unit_keys if key in allowed_keys][:2]
        if not keys:
            return None
        tags: list[str] = []
        for key in keys:
            for tag in skill_lookup.get(key, []):
                if tag not in tags:
                    tags.append(tag)
        cards.append(
            DraftCard(
                card_type=card.card_type,
                prompt=card.prompt.strip(),
                answer=card.answer.strip(),
                why=card.why.strip(),
                unit_keys=keys,
                skill_tags=tags,
            )
        )
    if len(cards) != min(budget_cards, len(payload.cards)) or not cards:
        return None
    prompts: list[DraftPrompt] = []
    for item in payload.speaking_prompts[:budget_prompts]:
        keys = [key for key in item.unit_keys if key in allowed_keys]
        if not keys:
            continue
        prompts.append(
            DraftPrompt(prompt=item.prompt.strip(), unit_keys=keys, why=item.why.strip())
        )
    return DraftPack(cards=cards, speaking_prompts=prompts, generator="openai")


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
    user = {
        "units": [
            {
                "key": unit.key,
                "label": unit.label,
                "kind": unit.kind,
                "urgency": round(unit.urgency, 4),
                "p_k": round(unit.p_k, 4),
            }
            for unit in ranked[:20]
        ],
        "skeleton_cards": [
            {
                "card_type": card.card_type,
                "unit_keys": card.unit_keys,
                "prompt": card.prompt,
                "answer": card.answer,
                "why": card.why,
            }
            for card in skeleton.cards
        ],
        "budget_cards": budget_cards,
        "budget_prompts": budget_prompts,
        "constraints": [
            "Each card targets 1-2 of the provided unit keys only.",
            "Surrounding English must be natural, adult, and i+1 (easy except the target).",
            "Preserve card_type and the intended answer meaning.",
            "Return JSON: cards[], speaking_prompts[].",
        ],
    }
    system = (
        "You write short i+1 English practice cards for an adult learner. "
        "Return only JSON matching the schema {cards:[{card_type,prompt,answer,why,unit_keys}],"
        "speaking_prompts:[{prompt,unit_keys,why}]}."
    )
    llm = complete_json(system, str(user), GeneratedPack)
    if llm is None:
        return skeleton
    validated = _validate_llm_pack(llm, allowed, budget_cards, budget_prompts, skill_lookup)
    if validated is None or len(validated.cards) < len(skeleton.cards):
        return skeleton
    if len(validated.speaking_prompts) < min(budget_prompts, 1) and budget_prompts:
        validated.speaking_prompts = skeleton.speaking_prompts
        validated.generator = "openai"
    return validated
