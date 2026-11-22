from __future__ import annotations

from app.services.parser import parse_session_log
from app.services.seed import sample_log


def test_parse_recurring_and_used_well() -> None:
    parsed = parse_session_log(sample_log())
    assert parsed.parser == "rules"
    keys = {item.unit_key for item in parsed.errors}
    assert "do_the_school_run" in keys
    assert "attend_no_prep" in keys
    assert "no_point_in_ing" in keys
    assert "by_hand" in keys
    assert "schedule_meeting" in keys
    assert "for_free_vs_freely" in keys
    assert "rather_not_vs_wouldnt_prefer" in keys
    assert "articles_a_the_zero" in keys

    recurring = {item.unit_key for item in parsed.errors if item.is_recurring}
    assert "do_the_school_run" in recurring
    assert "attend_no_prep" in recurring

    used_well = [item for item in parsed.vocab if item.used_well]
    assert any(item.item.lower().startswith("school run") for item in used_well)
    assert any(item.unit_key == "do_the_school_run" for item in used_well)


def test_tracking_and_focus_map_to_units() -> None:
    parsed = parse_session_log(sample_log())
    tracking_keys = {key for item in parsed.tracking for key in item.unit_keys}
    assert "attend_no_prep" in tracking_keys
    assert "articles_a_the_zero" in tracking_keys
    assert "attend_no_prep" in parsed.focus_unit_keys
    assert "rather_not_vs_wouldnt_prefer" in parsed.focus_unit_keys


def test_repeat_occurrence_marks_recurring_without_flag() -> None:
    log = """
You said: I attended to class
Correct: I attended class
Why: no preposition

You said: She attended to the meeting
Correct: She attended the meeting
Why: attend + event
"""
    parsed = parse_session_log(log)
    assert len(parsed.errors) == 2
    assert all(item.unit_key == "attend_no_prep" for item in parsed.errors)
    assert all(item.is_recurring for item in parsed.errors)
