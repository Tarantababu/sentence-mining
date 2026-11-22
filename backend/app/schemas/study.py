from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class StudyPackGenerateRequest(BaseModel):
    budget_cards: int = Field(default=8, ge=1, le=20)
    budget_prompts: int = Field(default=3, ge=0, le=10)
    due_only: bool = False
    stretch_only: bool = False


class StudyCardOut(BaseModel):
    id: int
    card_type: str
    prompt: str
    answer: str
    why: str
    unit_keys: list[str]
    skill_tags: list[str]
    queue: str = "due"
    order_index: int


class SpeakingPromptOut(BaseModel):
    prompt: str
    unit_keys: list[str]
    why: str


class StudyPackResponse(BaseModel):
    id: int
    generated_at: datetime
    budget_cards: int
    budget_prompts: int
    generator: str
    cards: list[StudyCardOut]
    speaking_prompts: list[SpeakingPromptOut]
