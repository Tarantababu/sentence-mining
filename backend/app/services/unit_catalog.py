from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Unit


@dataclass(frozen=True)
class UnitDef:
    key: str
    label: str
    kind: str
    skill_tags: tuple[str, ...]
    is_structural: bool
    patterns: tuple[str, ...]
    templates: dict[str, tuple[str, str, str]] = field(default_factory=dict)


def _t(
    fill: tuple[str, str, str],
    fix: tuple[str, str, str],
    transform: tuple[str, str, str],
) -> dict[str, tuple[str, str, str]]:
    return {
        "fill_in_blank": fill,
        "fix_error": fix,
        "transform_sentence": transform,
    }


CATALOG: tuple[UnitDef, ...] = (
    UnitDef(
        key="do_the_school_run",
        label="do the school run",
        kind="chunk",
        skill_tags=("collocation", "chunks"),
        is_structural=True,
        patterns=(r"school runn", r"school run", r"do the school"),
        templates=_t(
            (
                "Complete: I _____ every weekday morning with the kids.",
                "do the school run",
                "Fixed chunk: do the school run (not 'running').",
            ),
            (
                "Fix: I do the school running every morning.",
                "I do the school run every morning.",
                "'School run' is a noun chunk; don't use the -ing form here.",
            ),
            (
                "Rewrite with the chunk 'do the school run': I take the children to school each day.",
                "I do the school run each day.",
                "Prefer the set phrase over a literal paraphrase.",
            ),
        ),
    ),
    UnitDef(
        key="no_point_in_ing",
        label="no point in + -ing",
        kind="chunk",
        skill_tags=("collocation", "chunks", "gerund"),
        is_structural=True,
        patterns=(r"no point (to|in)", r"no point waiting", r"point in"),
        templates=_t(
            (
                "Complete: There's no point _____ for a reply tonight. (wait)",
                "in waiting",
                "Pattern: no point in + -ing.",
            ),
            (
                "Fix: There is no point to wait.",
                "There's no point in waiting.",
                "'No point' takes in + gerund, not to-infinitive.",
            ),
            (
                "Rewrite with 'no point in': Waiting any longer is useless.",
                "There's no point in waiting any longer.",
                "Use the chunk to express futility.",
            ),
        ),
    ),
    UnitDef(
        key="by_hand",
        label="by hand",
        kind="chunk",
        skill_tags=("collocation", "chunks", "articles"),
        is_structural=False,
        patterns=(r"by the hand", r"by hand"),
        templates=_t(
            (
                "Complete: She made the pasta _____, not with a machine.",
                "by hand",
                "'By hand' takes no article.",
            ),
            (
                "Fix: I made it by the hand.",
                "I made it by hand.",
                "Zero article: by hand, by bus, by email.",
            ),
            (
                "Rewrite with 'by hand': They assembled every piece without machines.",
                "They assembled every piece by hand.",
                "Keep the set phrase; drop the article.",
            ),
        ),
    ),
    UnitDef(
        key="attend_no_prep",
        label="attend (no preposition)",
        kind="verb_prep",
        skill_tags=("verb-preposition", "collocation"),
        is_structural=True,
        patterns=(r"attend(ed|ing)? to (the )?(meeting|class|school|conference)", r"\battend"),
        templates=_t(
            (
                "Complete: Did you _____ the meeting on Friday? (attend / attend to)",
                "attend",
                "'Attend' a meeting/class takes no preposition.",
            ),
            (
                "Fix: I attended to the meeting.",
                "I attended the meeting.",
                "Don't add 'to' for events. 'Attend to' means 'deal with'.",
            ),
            (
                "Rewrite without a preposition after attend: She went to the conference.",
                "She attended the conference.",
                "attend + event, no to/at.",
            ),
        ),
    ),
    UnitDef(
        key="schedule_meeting",
        label="schedule a meeting for",
        kind="verb_prep",
        skill_tags=("verb-preposition", "collocation"),
        is_structural=False,
        patterns=(r"schedul\w+ .* (on|for) friday", r"scheduled on", r"schedule(d)? (a )?meeting"),
        templates=_t(
            (
                "Complete: Let's schedule the meeting _____ Monday morning. (for/on)",
                "for",
                "schedule a meeting for + day/time.",
            ),
            (
                "Fix: The meeting was scheduled on Friday.",
                "The meeting is scheduled for Friday.",
                "Use 'scheduled for' with a planned time.",
            ),
            (
                "Rewrite with 'schedule for': Can we put the call on Thursday?",
                "Can we schedule the call for Thursday?",
                "schedule [event] for [time].",
            ),
        ),
    ),
    UnitDef(
        key="for_free_vs_freely",
        label="for free vs freely",
        kind="lexical_contrast",
        skill_tags=("lexical-contrast", "adverbs"),
        is_structural=False,
        patterns=(r"for freely", r"for free", r"\bfreely\b"),
        templates=_t(
            (
                "Complete: Members can use the gym _____. (no payment)",
                "for free",
                "'For free' = at no cost. 'Freely' = without restriction.",
            ),
            (
                "Fix: I got it for freely.",
                "I got it for free.",
                "Cost → for free. Manner → freely.",
            ),
            (
                "Rewrite to mean 'at no cost': They gave us the extra night without charging.",
                "They gave us the extra night for free.",
                "Don't swap in the adverb 'freely'.",
            ),
        ),
    ),
    UnitDef(
        key="rather_not_vs_wouldnt_prefer",
        label="I'd rather not vs wouldn't prefer",
        kind="lexical_contrast",
        skill_tags=("lexical-contrast", "preferences"),
        is_structural=True,
        patterns=(r"wouldn'?t prefer", r"rather not", r"would prefer not"),
        templates=_t(
            (
                "Complete: I'd _____ stay in tonight. (rather not / wouldn't prefer)",
                "rather not",
                "Natural preference: I'd rather not + verb.",
            ),
            (
                "Fix: I wouldn't prefer to go.",
                "I'd rather not go.",
                "'Wouldn't prefer' is awkward; use 'I'd rather not'.",
            ),
            (
                "Rewrite with 'rather not': I wouldn't prefer to discuss it now.",
                "I'd rather not discuss it now.",
                "Keep rather + not + base verb.",
            ),
        ),
    ),
    UnitDef(
        key="articles_a_the_zero",
        label="articles: a / the / zero",
        kind="grammar",
        skill_tags=("articles", "grammar"),
        is_structural=True,
        patterns=(
            r"by the bus",
            r"to the school",
            r"by (?:the )?(?:bus|train|car|bike)\b",
            r"\bzero article\b",
            r"\barticles?\b",
        ),
        templates=_t(
            (
                "Complete: I went _____ school by _____. (institution / transport)",
                "to school / by bus",
                "Zero article with institutions as activities and with by + transport.",
            ),
            (
                "Fix: I went to school by the bus.",
                "I went to school by bus.",
                "'By bus/train/car' takes zero article.",
            ),
            (
                "Rewrite with zero article where needed: She takes the kids to the school by the bus.",
                "She takes the kids to school by bus.",
                "Activity/institution and by-transport drop the.",
            ),
        ),
    ),
)

CATALOG_BY_KEY = {item.key: item for item in CATALOG}

_FOCUS_MAP: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"verb[- ]prep|collocation", ("attend_no_prep", "schedule_meeting")),
    (r"rather not|prefer", ("rather_not_vs_wouldnt_prefer",)),
    (r"article", ("articles_a_the_zero",)),
    (r"chunk|school run|by hand|no point", ("do_the_school_run", "by_hand", "no_point_in_ing")),
    (r"free", ("for_free_vs_freely",)),
)

_TRACKING_MAP: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"attend", ("attend_no_prep",)),
    (r"article|transport|institution", ("articles_a_the_zero",)),
    (r"schedule", ("schedule_meeting",)),
    (r"point in", ("no_point_in_ing",)),
    (r"school run", ("do_the_school_run",)),
    (r"by hand", ("by_hand",)),
    (r"rather|prefer", ("rather_not_vs_wouldnt_prefer",)),
    (r"free", ("for_free_vs_freely",)),
)


def _search(patterns: tuple[tuple[str, tuple[str, ...]], ...], text: str) -> list[str]:
    keys: list[str] = []
    lower = text.lower()
    for pattern, mapped in patterns:
        if re.search(pattern, lower):
            for key in mapped:
                if key not in keys:
                    keys.append(key)
    return keys


def match_unit_key(*texts: str) -> str | None:
    blob = " ".join(part for part in texts if part)
    lower = blob.lower()
    for item in CATALOG:
        for pattern in item.patterns:
            if re.search(pattern, lower, flags=re.I):
                return item.key
    return None


def match_focus_keys(text: str) -> list[str]:
    return _search(_FOCUS_MAP, text)


def match_tracking_keys(text: str) -> list[str]:
    return _search(_TRACKING_MAP, text)


def slug_from_phrase(phrase: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", phrase.lower()).strip("_")
    return (cleaned or "misc")[:48]


def phrase_unit_key(*texts: str) -> str:
    mapped = match_unit_key(*texts)
    if mapped:
        return mapped
    source = next((part for part in texts if part and part.strip()), "misc")
    return f"item_{slug_from_phrase(source)}"


def keys_for_line(text: str, mapped: list[str]) -> list[str]:
    return mapped if mapped else [phrase_unit_key(text)]


def ensure_catalog(db: Session) -> None:
    existing = {row.key for row in db.scalars(select(Unit)).all()}
    added = False
    for item in CATALOG:
        if item.key in existing:
            continue
        db.add(
            Unit(
                key=item.key,
                label=item.label,
                kind=item.kind,
                skill_tags=list(item.skill_tags),
                is_structural=item.is_structural,
            )
        )
        added = True
    if added:
        db.commit()


def get_or_create_unit(db: Session, key: str, label: str | None = None, kind: str = "chunk") -> Unit:
    unit = db.scalar(select(Unit).where(Unit.key == key))
    if unit:
        return unit
    defn = CATALOG_BY_KEY.get(key)
    unit = Unit(
        key=key,
        label=defn.label if defn else (label or key.removeprefix("item_").replace("_", " ")),
        kind=defn.kind if defn else kind,
        skill_tags=list(defn.skill_tags) if defn else ["misc"],
        is_structural=defn.is_structural if defn else False,
    )
    db.add(unit)
    db.flush()
    return unit
