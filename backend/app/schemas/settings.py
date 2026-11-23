from __future__ import annotations

from pydantic import BaseModel, Field


class SettingsUpdate(BaseModel):
    daily_limit: int | None = Field(default=None, ge=1, le=200)


class SettingsResponse(BaseModel):
    openai_configured: bool
    has_personal_key: bool = False
    has_hosted_key: bool
    api_key_set: bool
    daily_limit: int | None
    remaining_today: int | None
