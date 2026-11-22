from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from app.services import memory_engine as mem
from app.services.memory_engine import MemorySnapshot

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)


def test_recall_probability_exact() -> None:
    p = mem.recall_probability(10.0, 10.0, seen=True)
    assert math.isclose(p, math.exp(-1.0), rel_tol=1e-12)
    assert mem.recall_probability(10.0, 0.0, seen=False) == 0.0
    assert mem.recall_probability(10.0, 0.0, seen=True) == 1.0


def test_surprise_penalty_stronger_when_p_high() -> None:
    high = mem.apply_miss(10.0, p_k=0.95, is_recurring=False)
    low = mem.apply_miss(10.0, p_k=0.20, is_recurring=False)
    assert high < low
    assert high >= mem.S_MIN


def test_recurring_miss_penalizes_more_than_one_off() -> None:
    one_off = mem.apply_miss(8.0, p_k=0.7, is_recurring=False)
    recurring = mem.apply_miss(8.0, p_k=0.7, is_recurring=True)
    assert recurring < one_off


def test_success_grows_with_spacing_and_diminishes_as_s_grows() -> None:
    small = mem.apply_success(1.0, delta_t_days=5.0)
    large = mem.apply_success(40.0, delta_t_days=5.0)
    assert small > 1.0
    assert large > 40.0
    assert (small / 1.0) > (large / 40.0)
    spaced = mem.apply_success(5.0, delta_t_days=20.0)
    recent = mem.apply_success(5.0, delta_t_days=0.1)
    assert spaced > recent


def test_urgency_includes_focus_and_recurring_weights() -> None:
    base = mem.urgency(0.5)
    boosted = mem.urgency(0.5, is_focus=True, is_recurring=True, is_tracking=True)
    assert math.isclose(base, 0.5)
    assert math.isclose(boosted, (1 + 0.50 + 0.40 + 0.20) * 0.5)


def test_apply_outcome_error_does_not_touch_last_seen() -> None:
    snap = MemorySnapshot(
        stability_days=4.0,
        last_seen_at=NOW - timedelta(days=2),
        last_p=None,
        last_outcome=None,
        error_count=0,
        success_count=0,
        is_recurring=False,
        is_focus=False,
        is_tracking=False,
    )
    update = mem.apply_outcome(snap, NOW, "error", mark_recurring=True, touch_last_seen=False)
    assert update.last_seen_at == snap.last_seen_at
    assert update.last_outcome == 0
    assert update.error_count == 1
    assert update.is_recurring is True
    assert update.stability_days < 4.0
