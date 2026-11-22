from __future__ import annotations

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    raw_log: str = Field(min_length=1, max_length=20_000)


class ParsedErrorOut(BaseModel):
    raw_utterance: str
    corrected_utterance: str
    explanation: str
    is_recurring: bool
    unit_key: str


class IngestResponse(BaseModel):
    session_id: int
    error_count: int
    vocab_count: int
    tracking_count: int
    focus_next_lesson: str | None
    units_touched: list[str]
    errors: list[ParsedErrorOut]
    parser: str
