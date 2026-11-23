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


def test_novel_log_items_get_their_own_keys() -> None:
    log = """
You said: I am agree with you
Correct: I agree with you
Why: don't use am with agree

You said: I go to the shop every days
Correct: I go to the shop every day
Why: every day not every days

VOCABULARY OF THE DAY
- catch up: let's catch up next week
- on the fence: I'm still on the fence (used well!)

TRACKING LIST
- phrasal verbs with get
- third person -s

FOCUS FOR NEXT LESSON
- present perfect vs past
"""
    parsed = parse_session_log(log)
    error_keys = {item.unit_key for item in parsed.errors}
    assert "articles_a_the_zero" not in error_keys
    assert any("agree" in key for key in error_keys)
    assert any("every_day" in key or "shop" in key for key in error_keys)
    vocab_keys = {item.unit_key for item in parsed.vocab}
    assert any("catch_up" in key for key in vocab_keys)
    assert all(item.unit_key for item in parsed.vocab)
    tracking_keys = {key for item in parsed.tracking for key in item.unit_keys}
    assert tracking_keys
    assert parsed.focus_unit_keys
    assert any("perfect" in key or "past" in key for key in parsed.focus_unit_keys)


def test_numbered_quoted_lesson_log() -> None:
    log = '''YOUR SENTENCES, CORRECTED

WEEKEND

1. You said: "My weekend was wrong."
Correct: "My weekend was relaxed." / "My weekend was a bit rough."
Why: "wrong" doesn't describe a weekend; choose relaxed, busy, or rough.

2. You said: "A friend came and visit."
Correct: "A friend came to visit us."
Why: come + to + verb for purpose.

3. You said: "...if she joined to me."
Correct: "...if she joins me."
Why: "join" takes no preposition (same pattern as "attend the meeting"). (RECURRING)

10. You said: "It's great game."
Correct: "It's a great game."
Why: singular countable noun needs "a". (RECURRING: articles)

22. You said: "No room for any errors."
C1 upgrade: "There's zero margin for error." / "We can't afford any mistakes."

23. You said: "This week I got a lot of things to be work on."
Correct: "This week I've got quite a lot on my plate."

27. "All in all, I'm looking forward to getting the ball rolling." (PERFECT!)

VOCABULARY OF THE DAY
- catch up on: I finally caught up on some sleep this weekend.
- have a lot on my plate: I've got a lot on my plate this week. (used well!)
- get the ball rolling: Let's get the ball rolling on the new project. (used well!)

TRACKING LIST (will be revisited)
- Articles: a / an / the (#1 pattern)
- No preposition after transitive verbs: join me, attend the meeting

FOCUS FOR NEXT LESSON
Articles before singular nouns, and completing every sentence.
'''
    parsed = parse_session_log(log)
    assert len(parsed.errors) >= 6
    raws = {item.raw_utterance.lower() for item in parsed.errors}
    assert any("weekend was wrong" in item for item in raws)
    assert any("joined to me" in item for item in raws)
    assert any("great game" in item for item in raws)
    assert any("no room for any errors" in item for item in raws)
    relaxed = next(item for item in parsed.errors if "weekend was wrong" in item.raw_utterance.lower())
    assert "relaxed" in relaxed.corrected_utterance.lower()
    assert "/" not in relaxed.corrected_utterance
    zero = next(item for item in parsed.errors if "no room" in item.raw_utterance.lower())
    assert "margin for error" in zero.corrected_utterance.lower()
    assert any(item.is_recurring for item in parsed.errors)
    assert any("catch up" in item.item.lower() for item in parsed.vocab)
    assert any(item.used_well and "plate" in item.item.lower() for item in parsed.vocab)
    assert any("looking forward" in item.item.lower() or "ball rolling" in item.item.lower() for item in parsed.vocab)
    assert parsed.tracking
    assert parsed.focus_lines


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
