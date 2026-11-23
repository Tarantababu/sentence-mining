from __future__ import annotations

import json
import logging
from collections import deque
from time import monotonic
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

_OPENAI_WINDOW_SECONDS = 60.0
_OPENAI_MAX_CALLS = 30
_recent_calls: deque[float] = deque()


def reset_rate_limit() -> None:
    _recent_calls.clear()


def _allow_openai_call() -> bool:
    now = monotonic()
    while _recent_calls and now - _recent_calls[0] > _OPENAI_WINDOW_SECONDS:
        _recent_calls.popleft()
    if len(_recent_calls) >= _OPENAI_MAX_CALLS:
        logger.warning("OpenAI rate limit reached; using fallback")
        return False
    _recent_calls.append(now)
    return True


def complete_json(
    system: str,
    user: str,
    model_type: type[T],
    *,
    timeout_seconds: float | None = None,
) -> T | None:
    settings = get_settings()
    if not settings.openai_configured:
        return None
    if not _allow_openai_call():
        return None
    timeout = timeout_seconds if timeout_seconds is not None else settings.openai_timeout_seconds
    payload: dict[str, Any] = {
        "model": settings.openai_model,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"]["content"]
            data = json.loads(content)
            return model_type.model_validate(data)
    except (
        httpx.HTTPError,
        httpx.TimeoutException,
        json.JSONDecodeError,
        ValidationError,
        KeyError,
        IndexError,
        TypeError,
        ValueError,
    ) as exc:
        logger.warning("OpenAI call failed; using fallback. %s", exc)
        return None
