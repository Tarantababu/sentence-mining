from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

CardType = Literal["fill_in_blank", "fix_error", "transform_sentence"]


class ParsedErrorLLM(BaseModel):
    raw_utterance: str
    corrected_utterance: str
    explanation: str = ""
    is_recurring: bool = False


class ParsedVocabLLM(BaseModel):
    item: str
    example_usage: str = ""
    used_well: bool = False


class ParsedLogLLM(BaseModel):
    errors: list[ParsedErrorLLM] = Field(default_factory=list)
    vocab: list[ParsedVocabLLM] = Field(default_factory=list)
    tracking: list[str] = Field(default_factory=list)
    focus: list[str] = Field(default_factory=list)


class GeneratedStudyCard(BaseModel):
    card_type: CardType
    prompt: str
    answer: str
    why: str
    unit_keys: list[str] = Field(min_length=1, max_length=2)


class SpeakingPromptLLM(BaseModel):
    prompt: str
    unit_keys: list[str]
    why: str = ""


class GeneratedPack(BaseModel):
    cards: list[GeneratedStudyCard]
    speaking_prompts: list[SpeakingPromptLLM] = Field(default_factory=list)
