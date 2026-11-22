from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Review, StudyCard, StudyPack, Unit, UnitMemory
from app.schemas.reviews import ReviewResult
from app.schemas.study import (
    SpeakingPromptOut,
    StudyCardOut,
    StudyPackResponse,
)
from app.schemas.units import UnitMemoryOut, UnitsResponse
from app.services import memory_engine as mem
from app.services.ingest import _memory_row, _persist_memory, _snapshot
from app.services.material_generator import generate_pack
from app.services.memory_engine import RankedUnit


def _rank_units(db: Session, now: datetime) -> list[RankedUnit]:
    rows = db.execute(select(Unit, UnitMemory).join(UnitMemory, isouter=True)).all()
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
            )
        )
    ranked.sort(
        key=lambda item: (
            {"due": 0, "stretch": 1, "upcoming": 2}.get(item.queue, 9),
            -item.urgency if item.queue == "due" else 0,
        )
    )
    return ranked


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
    budget_cards: int = 8,
    budget_prompts: int = 3,
    now: datetime | None = None,
) -> StudyPack:
    now = now or mem.utcnow()
    ranked = _rank_units(db, now)
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
    return UnitsResponse(units=out, now=now)


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
