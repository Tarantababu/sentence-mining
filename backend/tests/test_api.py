from __future__ import annotations

from fastapi.testclient import TestClient

from app.services.seed import sample_log


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["openai_configured"] is False


def test_ingest_generate_units_and_review_roundtrip(client: TestClient) -> None:
    ingest = client.post("/api/sessions/ingest", json={"raw_log": sample_log()})
    assert ingest.status_code == 200, ingest.text
    payload = ingest.json()
    assert payload["error_count"] >= 8
    assert "attend_no_prep" in payload["units_touched"]
    assert any(item["is_recurring"] for item in payload["errors"])

    generated = client.get("/api/study-pack/latest")
    assert generated.status_code == 200, generated.text
    pack = generated.json()
    assert pack["cards"]
    generated = client.post(
        "/api/study-pack/generate",
        json={"budget_cards": 8, "budget_prompts": 3},
    )
    assert generated.status_code == 200, generated.text
    pack = generated.json()
    assert len(pack["cards"]) == 8
    assert len(pack["speaking_prompts"]) == 3
    for card in pack["cards"]:
        assert 1 <= len(card["unit_keys"]) <= 2
        assert card["card_type"] in {"fill_in_blank", "fix_error", "transform_sentence"}

    latest = client.get("/api/study-pack/latest")
    assert latest.status_code == 200
    assert latest.json()["id"] == pack["id"]

    units = client.get("/api/units")
    assert units.status_code == 200
    keys = {item["key"] for item in units.json()["units"]}
    assert "do_the_school_run" in keys
    attend = next(item for item in units.json()["units"] if item["key"] == "attend_no_prep")
    assert attend["is_recurring"] is True
    assert attend["is_focus"] is True or attend["is_tracking"] is True

    card_id = pack["cards"][0]["id"]
    review = client.post(
        "/api/reviews/submit",
        json={"card_id": card_id, "result": "knew_it"},
    )
    assert review.status_code == 200, review.text
    body = review.json()
    assert body["result"] == "knew_it"
    assert body["s_after"]
    for key, after in body["s_after"].items():
        assert after >= body["s_before"][key]

    listed = units.json()
    assert listed["due_count"] == sum(1 for item in listed["units"] if item["due"])
    assert listed["due_count"] >= 1

    due_pack = client.post(
        "/api/study-pack/generate",
        json={"budget_cards": 8, "budget_prompts": 3, "due_only": True},
    )
    assert due_pack.status_code == 200, due_pack.text
    due_cards = due_pack.json()["cards"]
    assert due_cards
    assert all(card["queue"] == "due" for card in due_cards)

    sessions = client.get("/api/sessions")
    assert sessions.status_code == 200
    logs = sessions.json()["sessions"]
    assert logs
    detail = client.get(f"/api/sessions/{logs[0]['id']}")
    assert detail.status_code == 200
    assert "You said" in (detail.json().get("raw_log") or "")

    novel = """
You said: I am agree with you
Correct: I agree with you
Why: don't use am with agree

VOCABULARY OF THE DAY
- catch up: let's catch up next week

TRACKING LIST
- phrasal verbs with get

FOCUS FOR NEXT LESSON
- present perfect vs past
"""
    second = client.post("/api/sessions/ingest", json={"raw_log": novel})
    assert second.status_code == 200, second.text
    assert second.json()["error_count"] == 1
    assert second.json()["vocab_count"] == 1
    after = client.get("/api/units")
    labels = {item["label"].lower() for item in after.json()["units"]}
    assert any("agree" in label for label in labels)
    assert any("catch up" in label for label in labels)
    assert after.json()["stats"]["total_items"] > listed["stats"]["total_items"]

    settings = client.get("/api/settings")
    assert settings.status_code == 200
    assert settings.json()["daily_limit"] is None
    assert settings.json()["api_key_set"] is False
    assert listed["stats"]["total_items"] >= 8
    assert listed["stats"]["daily_limit"] is None


def test_ingest_builds_practice_from_you_said(client: TestClient) -> None:
    log = """
1. You said: "My weekend was wrong."
Correct: "My weekend was relaxed."
Why: wrong doesn't describe a weekend

2. You said: "I attended to the meeting."
Correct: "I attended the meeting."
Why: attend takes no preposition. RECURRING
"""
    ingest = client.post("/api/sessions/ingest", json={"raw_log": log})
    assert ingest.status_code == 200, ingest.text
    assert ingest.json()["error_count"] == 2
    pack = client.get("/api/study-pack/latest")
    assert pack.status_code == 200, pack.text
    cards = pack.json()["cards"]
    assert cards
    blob = " ".join(f"{card['prompt']} {card['answer']} {card['why']}" for card in cards).lower()
    assert "before dinner" not in blob
    assert "weekend" in blob or "attended" in blob
    assert any(
        "_____" in card["prompt"]
        or card["prompt"].lower().startswith("fix:")
        or "rewrite" in card["prompt"].lower()
        for card in cards
    )
    for card in cards:
        assert 1 <= len(card["unit_keys"]) <= 2
        assert card["card_type"] in {"fill_in_blank", "fix_error", "transform_sentence"}
