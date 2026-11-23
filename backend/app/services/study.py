from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import AppSetting, Review, SessionError, StudyCard, StudyPack, Unit, UnitMemory
from app.schemas.reviews import ReviewResult
from app.schemas.study import (
    SpeakingPromptOut,
    StudyCardOut,
    StudyPackResponse,
)
from app.schemas.units import DeckStats, UnitMemoryOut, UnitsResponse
from app.services import memory_engine as mem
from app.services.ingest import _memory_row, _persist_memory, _snapshot
from app.services.material_generator import generate_pack
from app.services.memory_engine import RankedUnit


def _rank_units(db: Session, now: datetime) -> list[RankedUnit]:
    rows = db.execute(select(Unit, UnitMemory).join(UnitMemory, isouter=True)).all()
    error_rows = db.scalars(select(SessionError).order_by(SessionError.id.desc())).all()
    latest_error: dict[int, SessionError] = {}
    for row in error_rows:
        if row.unit_id is None or row.unit_id in latest_error:
            continue
        latest_error[row.unit_id] = row
    ranked: list[RankedUnit] = []
    for unit, memory in rows:
        snap = _snapshot(memory)
        tracked = (
            snap.error_count + snap.success_count > 0
            or snap.is_focus
            or snap.is_tracking
            or snap.is_recurring
        )
        if not tracked:
            continue
        p_k, _ = mem.snapshot_p(snap, now)
        queue = mem.queue_role(snap, p_k, now)
        source = latest_error.get(unit.id)
        ranked.append(
            RankedUnit(
                key=unit.key,
                label=unit.label,
                kind=unit.kind,
                skill_tags=list(unit.skill_tags or []),
                stability_days=snap.stability_days,
                p_k=p_k,
                urgency=mem.urgency(
                    p_k,
                    is_focus=snap.is_focus,
                    is_recurring=snap.is_recurring,
                    is_tracking=snap.is_tracking,
                ),
                is_recurring=snap.is_recurring,
                is_focus=snap.is_focus,
                is_tracking=snap.is_tracking,
                error_count=snap.error_count,
                success_count=snap.success_count,
                last_seen_at=snap.last_seen_at,
                next_review_at=mem.next_review_at(snap.stability_days, snap.last_seen_at, now),
                due=queue == "due",
                queue=queue,
                you_said=source.raw_utterance if source else "",
                correct=source.corrected_utterance if source else "",
                why=source.explanation if source else "",
            )
        )
    ranked.sort(
        key=lambda item: (
            {"due": 0, "stretch": 1, "upcoming": 2}.get(item.queue, 9),
            -item.urgency if item.queue == "due" else 0,
        )
    )
    return ranked


def _day_start(now: datetime) -> datetime:
    current = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return current.replace(hour=0, minute=0, second=0, microsecond=0)


def get_app_settings(db: Session) -> AppSetting:
    row = db.get(AppSetting, 1)
    if row is None:
        row = AppSetting(id=1, daily_limit=None)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def count_reviews_today(db: Session, now: datetime | None = None) -> dict[str, int]:
    now = now or mem.utcnow()
    start = _day_start(now)
    rows = db.execute(select(Review.result, func.count()).where(Review.submitted_at >= start).group_by(Review.result)).all()
    tallies = {name: 0 for name in ("knew_it", "shaky", "missed")}
    total = 0
    for result, n in rows:
        tallies[str(result)] = int(n)
        total += int(n)
    all_time = int(db.scalar(select(func.count()).select_from(Review)) or 0)
    return {
        "total": total,
        "knew_it": tallies["knew_it"],
        "shaky": tallies["shaky"],
        "missed": tallies["missed"],
        "all_time": all_time,
    }


def remaining_daily_budget(db: Session, requested: int | None = None, now: datetime | None = None) -> int | None:
    limit = get_app_settings(db).daily_limit
    today = count_reviews_today(db, now)["total"]
    if limit is None:
        return requested
    leftover = max(0, int(limit) - today)
    if requested is None:
        return leftover
    return min(requested, leftover)


def deck_stats(db: Session, now: datetime | None = None) -> DeckStats:
    now = now or mem.utcnow()
    ranked = _rank_units(db, now)
    total_items = int(db.scalar(select(func.count()).select_from(Unit)) or 0)
    due = [unit for unit in ranked if unit.due]
    stretch = [unit for unit in ranked if unit.queue == "stretch"]
    new_count = sum(1 for unit in due if unit.last_seen_at is None)
    review = sum(1 for unit in due if unit.last_seen_at is not None and unit.success_count > 0)
    learning = max(0, len(due) - review)
    learnt = sum(
        1 for unit in ranked if unit.queue == "upcoming" and unit.success_count > 0 and unit.p_k >= 0.9
    )
    learning_now = sum(1 for unit in ranked if unit.due or unit.queue == "stretch")
    reps = count_reviews_today(db, now)
    daily_limit = get_app_settings(db).daily_limit
    remaining = remaining_daily_budget(db, now=now)
    return DeckStats(
        total_items=total_items,
        learning_now=learning_now,
        waiting=max(0, total_items - len(ranked)),
        learnt=learnt,
        due=len(due),
        new=new_count,
        learning=learning,
        review=review,
        stretch=len(stretch),
        reps_today=reps["total"],
        reps_total=reps["all_time"],
        knew_it_today=reps["knew_it"],
        shaky_today=reps["shaky"],
        missed_today=reps["missed"],
        daily_limit=daily_limit,
        remaining_today=None if daily_limit is None else remaining,
    )


def pack_to_response(pack: StudyPack) -> StudyPackResponse:
    prompts = [
        SpeakingPromptOut(
            prompt=item.get("prompt", ""),
            unit_keys=list(item.get("unit_keys") or []),
            why=item.get("why", ""),
        )
        for item in (pack.speaking_prompts or [])
    ]
    cards = [
        StudyCardOut(
            id=card.id,
            card_type=card.card_type,
            prompt=card.prompt,
            answer=card.answer,
            why=card.why,
            unit_keys=list(card.unit_keys or []),
            skill_tags=list(card.skill_tags or []),
            queue=card.queue or "due",
            order_index=card.order_index,
        )
        for card in pack.cards
    ]
    return StudyPackResponse(
        id=pack.id,
        generated_at=pack.generated_at,
        budget_cards=pack.budget_cards,
        budget_prompts=pack.budget_prompts,
        generator=pack.generator,
        cards=cards,
        speaking_prompts=prompts,
    )


def generate_study_pack(
    db: Session,
    *,
    budget_cards: int | None = None,
    budget_prompts: int = 3,
    due_only: bool = False,
    stretch_only: bool = False,
    now: datetime | None = None,
) -> StudyPack:
    now = now or mem.utcnow()
    ranked = _rank_units(db, now)
    if due_only:
        ranked = [unit for unit in ranked if unit.due]
    elif stretch_only:
        ranked = [unit for unit in ranked if not unit.due]
    allowed = remaining_daily_budget(db, budget_cards, now)
    if allowed is None:
        allowed = len(ranked)
    if ranked:
        budget_cards = min(max(0, allowed), len(ranked))
    else:
        budget_cards = 0
        budget_prompts = 0
    if budget_cards == 0:
        budget_prompts = 0
    draft = generate_pack(ranked, budget_cards=budget_cards, budget_prompts=budget_prompts)
    pack = StudyPack(
        generated_at=now,
        budget_cards=budget_cards,
        budget_prompts=budget_prompts,
        generator=draft.generator,
        speaking_prompts=[
            {"prompt": item.prompt, "unit_keys": item.unit_keys, "why": item.why}
            for item in draft.speaking_prompts
        ],
    )
    db.add(pack)
    db.flush()
    for index, card in enumerate(draft.cards):
        db.add(
            StudyCard(
                study_pack_id=pack.id,
                card_type=card.card_type,
                prompt=card.prompt,
                answer=card.answer,
                why=card.why,
                unit_keys=card.unit_keys,
                skill_tags=card.skill_tags,
                queue=card.queue,
                order_index=index,
            )
        )
    db.commit()
    pack = db.scalar(
        select(StudyPack)
        .options(selectinload(StudyPack.cards))
        .where(StudyPack.id == pack.id)
    )
    assert pack is not None
    return pack


def latest_study_pack(db: Session) -> StudyPack | None:
    return db.scalar(
        select(StudyPack)
        .options(selectinload(StudyPack.cards))
        .order_by(StudyPack.generated_at.desc(), StudyPack.id.desc())
    )


def list_units(db: Session, now: datetime | None = None) -> UnitsResponse:
    now = now or mem.utcnow()
    ranked = _rank_units(db, now)
    units_by_key = {unit.key: unit for unit in db.scalars(select(Unit)).all()}
    memories = {row.unit_id: row for row in db.scalars(select(UnitMemory)).all()}
    out: list[UnitMemoryOut] = []
    for item in ranked:
        unit = units_by_key[item.key]
        memory = memories.get(unit.id)
        snap = _snapshot(memory)
        out.append(
            UnitMemoryOut(
                key=item.key,
                label=item.label,
                kind=item.kind,
                skill_tags=item.skill_tags,
                is_structural=unit.is_structural,
                stability_days=item.stability_days,
                last_seen_at=snap.last_seen_at,
                p_k=item.p_k,
                urgency=item.urgency,
                last_p=snap.last_p,
                last_outcome=snap.last_outcome,
                error_count=snap.error_count,
                success_count=snap.success_count,
                is_recurring=item.is_recurring,
                is_focus=item.is_focus,
                is_tracking=item.is_tracking,
                due=item.due,
                next_review_at=item.next_review_at,
                queue=item.queue,
            )
        )
    return UnitsResponse(
        units=out,
        now=now,
        due_count=sum(1 for item in out if item.due),
        stats=deck_stats(db, now),
    )


def submit_review(db: Session, card_id: int, result: ReviewResult) -> Review:
    card = db.get(StudyCard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    now = mem.utcnow()
    p_before: dict[str, float] = {}
    s_before: dict[str, float] = {}
    s_after: dict[str, float] = {}
    for key in card.unit_keys or []:
        unit = db.scalar(select(Unit).where(Unit.key == key))
        if unit is None:
            continue
        row = _memory_row(db, unit.id)
        snap = _snapshot(row)
        update = mem.apply_outcome(snap, now, result, touch_last_seen=True)
        _persist_memory(db, unit, update)
        p_before[key] = update.p_before
        s_before[key] = update.s_before
        s_after[key] = update.stability_days
    review = Review(
        card_id=card.id,
        result=result,
        submitted_at=now,
        p_before=p_before,
        s_before=s_before,
        s_after=s_after,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review
