from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from app.schemas.openai_payloads import GeneratedPack, ParsedLogLLM
from app.services import openai_client
from app.services.material_generator import generate_pack
from app.services.memory_engine import RankedUnit
from app.services.openai_client import complete_json, reset_rate_limit


class _FakeResponse:
    def __init__(self, payload: Any, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("error", request=request, response=response)

    def json(self) -> Any:
        return self._payload


def _unit(key: str, urgency: float) -> RankedUnit:
    return RankedUnit(
        key=key,
        label=key.replace("_", " "),
        kind="chunk",
        skill_tags=["collocation"],
        stability_days=1.0,
        p_k=0.0,
        urgency=urgency,
        is_recurring=False,
        is_focus=False,
        is_tracking=False,
    )


@pytest.fixture(autouse=True)
def _openai_env(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_rate_limit()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_TIMEOUT_SECONDS", "12")
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
    reset_rate_limit()


def test_complete_json_skips_when_key_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "")
    from app.config import get_settings

    get_settings.cache_clear()
    called = {"n": 0}

    class _Client:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            called["n"] += 1

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *args: Any) -> None:
            return None

        def post(self, *args: Any, **kwargs: Any) -> _FakeResponse:
            raise AssertionError("network should not be used")

    monkeypatch.setattr(openai_client.httpx, "Client", _Client)
    assert complete_json("sys", "user", GeneratedPack) is None
    assert called["n"] == 0


def test_complete_json_passes_timeout_and_validates(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    pack = {
        "cards": [
            {
                "card_type": "fill_in_blank",
                "prompt": "Complete: I _____ every morning.",
                "answer": "do the school run",
                "why": "Fixed chunk.",
                "unit_keys": ["do_the_school_run"],
            }
        ],
        "speaking_prompts": [
            {"prompt": "Tell a school-run story.", "unit_keys": ["do_the_school_run"], "why": "focus"}
        ],
    }

    class _Client:
        def __init__(self, timeout: float) -> None:
            captured["timeout"] = timeout

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *args: Any) -> None:
            return None

        def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> _FakeResponse:
            captured["url"] = url
            captured["headers"] = headers
            captured["body"] = json
            return _FakeResponse(
                {"choices": [{"message": {"content": __import__("json").dumps(pack)}}]}
            )

    monkeypatch.setattr(openai_client.httpx, "Client", _Client)
    result = complete_json("sys", "user", GeneratedPack)
    assert result is not None
    assert result.cards[0].unit_keys == ["do_the_school_run"]
    assert captured["timeout"] == 12.0
    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert "sk-test-not-real" in captured["headers"]["Authorization"]


def test_complete_json_invalid_payload_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Client:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *args: Any) -> None:
            return None

        def post(self, *args: Any, **kwargs: Any) -> _FakeResponse:
            return _FakeResponse({"choices": [{"message": {"content": json.dumps({"cards": "nope"})}}]})

    monkeypatch.setattr(openai_client.httpx, "Client", _Client)
    assert complete_json("sys", "user", GeneratedPack) is None


def test_complete_json_timeout_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Client:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *args: Any) -> None:
            return None

        def post(self, *args: Any, **kwargs: Any) -> _FakeResponse:
            raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(openai_client.httpx, "Client", _Client)
    assert complete_json("sys", "user", ParsedLogLLM) is None


def test_generated_pack_pydantic_rejects_bad_card_type() -> None:
    with pytest.raises(ValidationError):
        GeneratedPack.model_validate(
            {
                "cards": [
                    {
                        "card_type": "multiple_choice",
                        "prompt": "x",
                        "answer": "y",
                        "why": "z",
                        "unit_keys": ["do_the_school_run"],
                    }
                ]
            }
        )


def test_generate_pack_falls_back_when_llm_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.material_generator.complete_json", lambda *a, **k: None)
    ranked = [_unit("do_the_school_run", 2.0), _unit("attend_no_prep", 1.5)]
    pack = generate_pack(ranked, budget_cards=2, budget_prompts=1)
    assert pack.generator == "fallback"
    assert len(pack.cards) == 2


def test_generate_pack_keeps_openai_when_validation_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = GeneratedPack.model_validate(
        {
            "cards": [
                {
                    "card_type": "fix_error",
                    "prompt": "Fix: I attended to the meeting.",
                    "answer": "I attended the meeting.",
                    "why": "No preposition.",
                    "unit_keys": ["attend_no_prep"],
                },
                {
                    "card_type": "fill_in_blank",
                    "prompt": "I _____ every weekday.",
                    "answer": "do the school run",
                    "why": "Chunk.",
                    "unit_keys": ["do_the_school_run"],
                },
            ],
            "speaking_prompts": [
                {
                    "prompt": "Talk about commuting.",
                    "unit_keys": ["do_the_school_run"],
                    "why": "high urgency",
                }
            ],
        }
    )
    monkeypatch.setattr("app.services.material_generator.complete_json", lambda *a, **k: payload)
    ranked = [_unit("attend_no_prep", 2.0), _unit("do_the_school_run", 1.8)]
    pack = generate_pack(ranked, budget_cards=2, budget_prompts=1)
    assert pack.generator == "openai"
    assert pack.cards[0].answer == "I attended the meeting."


def test_generate_pack_falls_back_on_unknown_unit_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = GeneratedPack.model_validate(
        {
            "cards": [
                {
                    "card_type": "fill_in_blank",
                    "prompt": "x",
                    "answer": "y",
                    "why": "z",
                    "unit_keys": ["not_a_real_unit"],
                }
            ]
        }
    )
    monkeypatch.setattr("app.services.material_generator.complete_json", lambda *a, **k: payload)
    ranked = [_unit("do_the_school_run", 2.0)]
    pack = generate_pack(ranked, budget_cards=1, budget_prompts=1)
    assert pack.generator == "fallback"
