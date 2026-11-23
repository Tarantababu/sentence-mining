from __future__ import annotations

from app.services.memory_engine import (
    RankedUnit,
    rotate_card_types,
    select_card_groups,
    select_due_then_stretch,
)
from app.services.material_generator import blank_from_pair, fallback_pack


def _unit(key: str, urgency: float, tags: list[str], recurring: bool = False) -> RankedUnit:
    return RankedUnit(
        key=key,
        label=key.replace("_", " "),
        kind="chunk",
        skill_tags=tags,
        stability_days=1.0,
        p_k=0.0,
        urgency=urgency,
        is_recurring=recurring,
        is_focus=False,
        is_tracking=False,
    )


def test_budget_and_one_or_two_units_per_card() -> None:
    ranked = [
        _unit("do_the_school_run", 2.0, ["collocation", "chunks"], True),
        _unit("no_point_in_ing", 1.8, ["collocation", "chunks"]),
        _unit("by_hand", 1.1, ["collocation", "chunks"]),
        _unit("attend_no_prep", 1.7, ["verb-preposition"], True),
        _unit("schedule_meeting", 1.4, ["verb-preposition"]),
        _unit("for_free_vs_freely", 0.9, ["lexical-contrast"]),
        _unit("rather_not_vs_wouldnt_prefer", 1.5, ["lexical-contrast"]),
        _unit("articles_a_the_zero", 1.2, ["articles", "grammar"]),
        _unit("misc_extra", 0.4, ["misc"]),
    ]
    groups = select_card_groups(ranked, budget_cards=8)
    assert len(groups) == 8
    for group in groups:
        assert 1 <= len(group) <= 2


def test_coverage_diminishing_returns_prefers_new_units() -> None:
    hot = _unit("attend_no_prep", 3.0, ["verb-preposition"], True)
    partner = _unit("schedule_meeting", 2.8, ["verb-preposition"])
    other = _unit("articles_a_the_zero", 2.2, ["articles"])
    extra = _unit("for_free_vs_freely", 2.0, ["lexical-contrast"])
    groups = select_card_groups([hot, partner, other, extra], budget_cards=3)
    keys = [tuple(item.key for item in group) for group in groups]
    flat = [key for group in groups for key in (u.key for u in group)]
    assert "attend_no_prep" in flat
    assert len(set(flat)) >= 3
    assert keys[0][0] == "attend_no_prep"


def test_card_type_diversity_cap() -> None:
    types = rotate_card_types(8)
    assert len(types) == 8
    assert set(types) == {"fill_in_blank", "fix_error", "transform_sentence"}
    for name in set(types):
        assert types.count(name) <= 4


def test_due_items_selected_before_stretch() -> None:
    due_a = _unit("attend_no_prep", 2.4, ["verb-preposition"], True)
    due_a.queue = "due"
    due_a.due = True
    due_b = _unit("do_the_school_run", 2.1, ["chunks"], True)
    due_b.queue = "due"
    due_b.due = True
    stretch = _unit("by_hand", 0.4, ["chunks"])
    stretch.queue = "stretch"
    stretch.due = False
    groups = select_due_then_stretch([stretch, due_a, due_b], budget_cards=3)
    assert groups[0][0].key in {"attend_no_prep", "do_the_school_run"}
    assert groups[1][0].key in {"attend_no_prep", "do_the_school_run"}
    assert groups[2][0].key == "by_hand"


def test_blank_from_pair_targets_the_correction() -> None:
    prompt, answer = blank_from_pair("It's great game.", "It's a great game.")
    assert "_____" in prompt
    assert answer.lower() == "a"
    prompt, answer = blank_from_pair("My weekend was wrong.", "My weekend was relaxed.")
    assert "_____" in prompt
    assert "relaxed" in answer.lower()
    assert "before dinner" not in prompt.lower()
    prompt, answer = blank_from_pair("I attended to the meeting.", "I attended the meeting.")
    assert "_____" in prompt
    assert "attended" in answer.lower()
    assert "to" not in prompt.lower()
    prompt, answer = blank_from_pair(
        "It's a quite important process.",
        "It's quite an important process, so there's zero margin for error.",
    )
    assert "_____" in prompt
    assert len(answer.split()) <= 3


def test_fallback_uses_learner_correction() -> None:
    unit = _unit("misc_weekend", 2.0, ["misc"])
    unit.you_said = "My weekend was wrong."
    unit.correct = "My weekend was relaxed."
    unit.why = "wrong doesn't describe a weekend"
    unit.queue = "due"
    unit.due = True
    pack = fallback_pack([unit], budget_cards=1, budget_prompts=1)
    card = pack.cards[0]
    blob = f"{card.prompt} {card.answer} {card.why}".lower()
    assert "before dinner" not in blob
    assert "weekend" in blob
    assert 1 <= len(card.unit_keys) <= 2


def test_fallback_pack_respects_budget() -> None:
    ranked = [
        _unit("do_the_school_run", 2.0, ["chunks"]),
        _unit("attend_no_prep", 1.9, ["verb-preposition"]),
        _unit("articles_a_the_zero", 1.5, ["articles"]),
        _unit("rather_not_vs_wouldnt_prefer", 1.4, ["lexical-contrast"]),
        _unit("by_hand", 1.0, ["chunks"]),
    ]
    pack = fallback_pack(ranked, budget_cards=4, budget_prompts=3)
    assert len(pack.cards) == 4
    assert len(pack.speaking_prompts) == 3
    assert pack.generator == "fallback"
    for card in pack.cards:
        assert 1 <= len(card.unit_keys) <= 2
        assert card.card_type in {"fill_in_blank", "fix_error", "transform_sentence"}
