from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import Unit, UnitMemory
from app.services import memory_engine as mem
from app.services.ingest import ingest_session
from app.services.seed import sample_log
from app.services.study import generate_study_pack, submit_review

NOW = datetime(2026, 11, 22, tzinfo=timezone.utc)


def _memory(db: Session, key: str) -> UnitMemory:
    unit = db.query(Unit).filter_by(key=key).one()
    memory = db.get(UnitMemory, unit.id)
    assert memory is not None
    return memory


def test_ingest_then_reviews_update_stability(db: Session) -> None:
    ingest_session(db, sample_log(), source="test", now=NOW)
    before = _memory(db, "attend_no_prep")
    s0 = before.stability_days
    assert before.last_outcome == 0
    assert before.is_recurring is True
    assert before.last_seen_at is None

    pack = generate_study_pack(db, budget_cards=8, budget_prompts=3, now=NOW)
    target = next(card for card in pack.cards if "attend_no_prep" in (card.unit_keys or []))

    missed = submit_review(db, target.id, "missed")
    after_miss = _memory(db, "attend_no_prep")
    assert after_miss.stability_days <= s0
    assert after_miss.last_seen_at is not None
    assert missed.s_after["attend_no_prep"] == after_miss.stability_days

    s_miss = after_miss.stability_days
    after_miss.last_seen_at = NOW - timedelta(days=3)
    db.commit()

    knew = submit_review(db, target.id, "knew_it")
    after_success = _memory(db, "attend_no_prep")
    assert after_success.stability_days > s_miss
    assert knew.s_before["attend_no_prep"] == s_miss
    assert knew.s_after["attend_no_prep"] == after_success.stability_days


def test_shaky_grows_less_than_knew_it() -> None:
    snap = mem.MemorySnapshot(
        stability_days=5.0,
        last_seen_at=NOW - timedelta(days=4),
        last_p=None,
        last_outcome=0,
        error_count=1,
        success_count=0,
        is_recurring=False,
        is_focus=False,
        is_tracking=False,
    )
    shaky = mem.apply_outcome(snap, NOW, "shaky", touch_last_seen=True)
    knew = mem.apply_outcome(snap, NOW, "knew_it", touch_last_seen=True)
    assert knew.stability_days > shaky.stability_days > 5.0
