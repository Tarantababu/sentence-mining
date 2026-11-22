from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ReviewResult = Literal["knew_it", "shaky", "missed"]


class ReviewSubmitRequest(BaseModel):
    card_id: int
    result: ReviewResult


class ReviewSubmitResponse(BaseModel):
    review_id: int
    card_id: int
    result: ReviewResult
    p_before: dict[str, float]
    s_before: dict[str, float]
    s_after: dict[str, float]
    units: list[str] = Field(default_factory=list)
