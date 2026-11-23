from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class UnitMemoryOut(BaseModel):
    key: str
    label: str
    kind: str
    skill_tags: list[str]
    is_structural: bool
    stability_days: float
    last_seen_at: datetime | None
    p_k: float
    urgency: float
    last_p: float | None
    last_outcome: int | None
    error_count: int
    success_count: int
    is_recurring: bool
    is_focus: bool
    is_tracking: bool
    due: bool = False
    next_review_at: datetime | None = None
    queue: str = "due"


class DeckStats(BaseModel):
    total_items: int
    learning_now: int
    waiting: int
    learnt: int
    due: int
    new: int
    learning: int
    review: int
    stretch: int
    reps_today: int
    reps_total: int
    knew_it_today: int
    shaky_today: int
    missed_today: int
    daily_limit: int | None
    remaining_today: int | None


class UnitsResponse(BaseModel):
    units: list[UnitMemoryOut]
    now: datetime
    due_count: int = 0
    stats: DeckStats | None = None
