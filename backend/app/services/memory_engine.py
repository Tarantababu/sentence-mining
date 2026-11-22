from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

SECONDS_PER_DAY = 86400.0
S_MIN = 0.25
S_INIT = 1.0
S_ASYMPTOTE = 60.0
MISS_BASE = 0.20
MISS_SURPRISE_WEIGHT = 0.55
MISS_RECURRING_MULT = 1.35
SUCCESS_GAIN = 0.80
SHAKY_GAIN_SCALE = 0.35
FOCUS_BOOST = 0.50
RECURRING_BOOST = 0.40
TRACKING_BOOST = 0.20
REDUCTION_CAP = 0.85
P_REVIEW = 0.9

ReviewResult = Literal["knew_it", "shaky", "missed"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def elapsed_days(now: datetime, last_seen_at: datetime | None, *, for_success: bool = False) -> float:
    if last_seen_at is None:
        return S_INIT if for_success else 0.0
    last = last_seen_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    current = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return max(0.0, (current - last).total_seconds() / SECONDS_PER_DAY)


def recall_probability(stability_days: float, delta_t_days: float, *, seen: bool) -> float:
    if not seen:
        return 0.0
    stability = max(float(stability_days), S_MIN)
    return math.exp(-delta_t_days / stability)


def miss_reduction(p_k: float, is_recurring: bool) -> float:
    recurring = MISS_RECURRING_MULT if is_recurring else 1.0
    reduction = MISS_BASE * (1.0 + MISS_SURPRISE_WEIGHT * p_k) * recurring
    return min(reduction, REDUCTION_CAP)


def apply_miss(stability_days: float, p_k: float, is_recurring: bool) -> float:
    return max(S_MIN, stability_days * (1.0 - miss_reduction(p_k, is_recurring)))


def apply_success(stability_days: float, delta_t_days: float, gain_scale: float = 1.0) -> float:
    stability = max(float(stability_days), S_MIN)
    spacing = delta_t_days / (delta_t_days + stability) if (delta_t_days + stability) else 0.0
    diminish = S_ASYMPTOTE / (S_ASYMPTOTE + stability)
    return stability * (1.0 + SUCCESS_GAIN * gain_scale * spacing * diminish)


def weight(is_focus: bool, is_recurring: bool, is_tracking: bool) -> float:
    value = 1.0
    if is_focus:
        value += FOCUS_BOOST
    if is_recurring:
        value += RECURRING_BOOST
    if is_tracking:
        value += TRACKING_BOOST
    return value


def urgency(
    p_k: float,
    *,
    is_focus: bool = False,
    is_recurring: bool = False,
    is_tracking: bool = False,
) -> float:
    return weight(is_focus, is_recurring, is_tracking) * (1.0 - p_k)


def review_interval_days(stability_days: float) -> float:
    return max(float(stability_days), S_MIN) * -math.log(P_REVIEW)


def next_review_at(
    stability_days: float,
    last_seen_at: datetime | None,
    now: datetime,
) -> datetime:
    if last_seen_at is None:
        return now
    last = last_seen_at if last_seen_at.tzinfo else last_seen_at.replace(tzinfo=timezone.utc)
    return last + timedelta(days=review_interval_days(stability_days))


def queue_role(memory: MemorySnapshot, p_k: float, now: datetime) -> str:
    never_practiced = memory.last_seen_at is None
    if never_practiced and memory.error_count > 0:
        return "due"
    if memory.last_outcome == 0 and memory.error_count > 0:
        return "due"
    if never_practiced:
        return "stretch"
    nxt = next_review_at(memory.stability_days, memory.last_seen_at, now)
    if p_k < P_REVIEW or nxt <= now:
        return "due"
    if memory.is_focus or memory.is_tracking:
        return "stretch"
    return "upcoming"


@dataclass(frozen=True)
class MemorySnapshot:
    stability_days: float
    last_seen_at: datetime | None
    last_p: float | None
    last_outcome: int | None
    error_count: int
    success_count: int
    is_recurring: bool
    is_focus: bool
    is_tracking: bool


@dataclass(frozen=True)
class MemoryUpdate:
    stability_days: float
    last_seen_at: datetime | None
    last_p: float
    last_outcome: int
    error_count: int
    success_count: int
    is_recurring: bool
    is_focus: bool
    is_tracking: bool
    p_before: float
    s_before: float
    delta_t_days: float


def snapshot_p(memory: MemorySnapshot, now: datetime) -> tuple[float, float]:
    seen = memory.last_seen_at is not None
    delta = elapsed_days(now, memory.last_seen_at)
    return recall_probability(memory.stability_days, delta, seen=seen), delta


def apply_outcome(
    memory: MemorySnapshot,
    now: datetime,
    result: ReviewResult | Literal["error", "used_well"],
    *,
    mark_recurring: bool = False,
    touch_last_seen: bool = False,
) -> MemoryUpdate:
    is_recurring = memory.is_recurring or mark_recurring
    p_before, delta = snapshot_p(memory, now)
    s_before = memory.stability_days
    last_seen = memory.last_seen_at
    error_count = memory.error_count
    success_count = memory.success_count
    last_outcome = memory.last_outcome

    if result in ("missed", "error"):
        new_s = apply_miss(s_before, p_before, is_recurring)
        error_count += 1
        last_outcome = 0
        if touch_last_seen:
            last_seen = now
    elif result == "shaky":
        success_delta = elapsed_days(now, last_seen, for_success=True)
        new_s = apply_success(s_before, success_delta, SHAKY_GAIN_SCALE)
        success_count += 1
        last_outcome = 1
        last_seen = now
    else:
        success_delta = elapsed_days(now, last_seen, for_success=True)
        new_s = apply_success(s_before, success_delta, 1.0)
        success_count += 1
        last_outcome = 1
        last_seen = now

    return MemoryUpdate(
        stability_days=new_s,
        last_seen_at=last_seen,
        last_p=p_before,
        last_outcome=last_outcome,
        error_count=error_count,
        success_count=success_count,
        is_recurring=is_recurring,
        is_focus=memory.is_focus,
        is_tracking=memory.is_tracking,
        p_before=p_before,
        s_before=s_before,
        delta_t_days=delta,
    )


@dataclass
class RankedUnit:
    key: str
    label: str
    kind: str
    skill_tags: list[str]
    stability_days: float
    p_k: float
    urgency: float
    is_recurring: bool
    is_focus: bool
    is_tracking: bool
    error_count: int = 0
    success_count: int = 0
    last_seen_at: datetime | None = None
    next_review_at: datetime | None = None
    due: bool = False
    queue: str = "due"


def select_card_groups(
    ranked: list[RankedUnit],
    budget_cards: int,
    *,
    max_units_per_card: int = 2,
    coverage_alpha: float = 1.0,
    wrap: bool = True,
) -> list[list[RankedUnit]]:
    """Greedy submodular pick: urgency / (1 + coverage), 1–2 units per card."""
    remaining = list(ranked)
    selected_keys: set[str] = set()
    tag_counts: dict[str, int] = {}
    groups: list[list[RankedUnit]] = []

    def penalty(unit: RankedUnit) -> float:
        value = 1.0
        if unit.key in selected_keys:
            value += coverage_alpha
        value += 0.5 * coverage_alpha * sum(tag_counts.get(tag, 0) for tag in unit.skill_tags)
        return value

    pool = list(ranked)
    while len(groups) < budget_cards:
        if not remaining:
            if not wrap:
                break
            remaining = list(pool)
            if not remaining:
                break
        remaining.sort(key=lambda unit: unit.urgency / penalty(unit), reverse=True)
        primary = remaining.pop(0)
        partner: RankedUnit | None = None
        slots_after = budget_cards - len(groups) - 1
        can_consume_partner = max_units_per_card > 1 and len(remaining) > slots_after
        if can_consume_partner:
            primary_tags = set(primary.skill_tags)
            for candidate in remaining:
                if not primary_tags.intersection(candidate.skill_tags):
                    continue
                if candidate.urgency < 0.45 * primary.urgency:
                    continue
                partner = candidate
                break
        if partner is not None:
            remaining.remove(partner)
        group = [primary] if partner is None else [primary, partner]
        groups.append(group)
        for unit in group:
            selected_keys.add(unit.key)
            for tag in unit.skill_tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return groups


def select_due_then_stretch(ranked: list[RankedUnit], budget_cards: int) -> list[list[RankedUnit]]:
    due = [unit for unit in ranked if unit.queue == "due"]
    stretch = [unit for unit in ranked if unit.queue != "due"]
    due_groups = select_card_groups(due, min(budget_cards, len(due)), wrap=False)
    remaining = budget_cards - len(due_groups)
    if remaining <= 0:
        return due_groups[:budget_cards]
    if stretch:
        return (due_groups + select_card_groups(stretch, remaining, wrap=True))[:budget_cards]
    return (due_groups + select_card_groups(due, remaining, wrap=True))[:budget_cards]


def rotate_card_types(count: int) -> list[str]:
    cycle = ("fill_in_blank", "fix_error", "transform_sentence")
    types: list[str] = []
    tallies = {name: 0 for name in cycle}
    cap = max(1, math.ceil(count / 2))
    index = 0
    while len(types) < count:
        candidate = cycle[index % 3]
        index += 1
        if tallies[candidate] >= cap:
            continue
        types.append(candidate)
        tallies[candidate] += 1
        if index > count * 6:
            types.append(cycle[len(types) % 3])
    return types[:count]
