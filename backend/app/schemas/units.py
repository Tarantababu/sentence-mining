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


class UnitsResponse(BaseModel):
    units: list[UnitMemoryOut]
    now: datetime
