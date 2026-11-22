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

    missing = client.get("/api/study-pack/latest")
    assert missing.status_code == 404

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
