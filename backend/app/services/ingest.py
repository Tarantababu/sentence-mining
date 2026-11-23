from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SessionError, SessionRecord, SessionTracking, SessionVocab, Unit, UnitMemory
from app.schemas.openai_payloads import ParsedLogLLM
from app.services import memory_engine as mem
from app.services.memory_engine import MemorySnapshot
from app.services.openai_client import complete_json
from app.services.parser import (
    ParsedSession,
    needs_enrichment,
    parse_session_log,
    parsed_session_from_llm,
)
from app.services.unit_catalog import get_or_create_unit


def _snapshot(row: UnitMemory | None) -> MemorySnapshot:
    if row is None:
        return MemorySnapshot(
            stability_days=mem.S_INIT,
            last_seen_at=None,
            last_p=None,
            last_outcome=None,
            error_count=0,
            success_count=0,
            is_recurring=False,
            is_focus=False,
            is_tracking=False,
        )
    return MemorySnapshot(
        stability_days=row.stability_days,
        last_seen_at=row.last_seen_at,
        last_p=row.last_p,
        last_outcome=row.last_outcome,
        error_count=row.error_count,
        success_count=row.success_count,
        is_recurring=row.is_recurring,
        is_focus=row.is_focus,
        is_tracking=row.is_tracking,
    )


def _memory_row(db: Session, unit_id: int) -> UnitMemory | None:
    row = db.get(UnitMemory, unit_id)
    if row is not None:
        return row
    for pending in db.new:
        if isinstance(pending, UnitMemory) and pending.unit_id == unit_id:
            return pending
    return None


def _persist_memory(db: Session, unit: Unit, update: mem.MemoryUpdate) -> UnitMemory:
    row = _memory_row(db, unit.id)
    if row is None:
        row = UnitMemory(unit_id=unit.id, stability_days=update.stability_days)
        db.add(row)
        db.flush()
    row.stability_days = update.stability_days
    row.last_seen_at = update.last_seen_at
    row.last_p = update.last_p
    row.last_outcome = update.last_outcome
    row.error_count = update.error_count
    row.success_count = update.success_count
    row.is_recurring = update.is_recurring
    row.is_focus = update.is_focus
    row.is_tracking = update.is_tracking
    row.updated_at = mem.utcnow()
    return row


def _enrich(raw_log: str) -> ParsedSession | None:
    system = (
        "Extract language-session notes as JSON with keys errors, vocab, tracking, focus. "
        "errors: [{raw_utterance, corrected_utterance, explanation, is_recurring}]. "
        "vocab: [{item, example_usage, used_well}]. tracking and focus are string arrays."
    )
    payload = complete_json(system, raw_log, ParsedLogLLM)
    if payload is None:
        return None
    parsed = parsed_session_from_llm(payload)
    if not parsed.errors and not parsed.vocab:
        return None
    return parsed


def parse_with_optional_enrichment(raw_log: str) -> ParsedSession:
    parsed = parse_session_log(raw_log)
    if needs_enrichment(parsed, raw_log):
        enriched = _enrich(raw_log)
        if enriched is not None:
            return enriched
    return parsed


def ingest_session(
    db: Session,
    raw_log: str,
    *,
    source: str = "paste",
    now: datetime | None = None,
) -> tuple[SessionRecord, ParsedSession]:
    now = now or mem.utcnow()
    parsed = parse_with_optional_enrichment(raw_log)

    session = SessionRecord(
        raw_log=raw_log,
        source=source,
        focus_next_lesson="\n".join(parsed.focus_lines) or None,
        parsed_payload={
            "parser": parsed.parser,
            "errors": [item.__dict__ for item in parsed.errors],
            "vocab": [item.__dict__ for item in parsed.vocab],
            "tracking": [
                {"text": item.text, "unit_keys": item.unit_keys} for item in parsed.tracking
            ],
            "focus": parsed.focus_lines,
        },
        ingested_at=now,
    )
    db.add(session)
    db.flush()

    for memory in db.scalars(select(UnitMemory)).all():
        memory.is_focus = False
        memory.is_tracking = False

    touched: dict[str, Unit] = {}

    for error in parsed.errors:
        unit = get_or_create_unit(db, error.unit_key, label=error.corrected_utterance)
        touched[unit.key] = unit
        db.add(
            SessionError(
                session_id=session.id,
                unit_id=unit.id,
                raw_utterance=error.raw_utterance,
                corrected_utterance=error.corrected_utterance,
                explanation=error.explanation,
                is_recurring=error.is_recurring,
            )
        )
        row = _memory_row(db, unit.id)
        snap = _snapshot(row)
        update = mem.apply_outcome(
            snap,
            now,
            "error",
            mark_recurring=error.is_recurring or unit.is_structural,
            touch_last_seen=False,
        )
        _persist_memory(db, unit, update)

    for vocab in parsed.vocab:
        unit = get_or_create_unit(db, vocab.unit_key, label=vocab.item)
        touched[unit.key] = unit
        db.add(
            SessionVocab(
                session_id=session.id,
                unit_id=unit.id,
                item=vocab.item,
                example_usage=vocab.example_usage,
                used_well=vocab.used_well,
            )
        )
        if vocab.used_well:
            row = _memory_row(db, unit.id)
            snap = _snapshot(row)
            update = mem.apply_outcome(snap, now, "used_well", touch_last_seen=True)
            _persist_memory(db, unit, update)

    tracking_keys: set[str] = set()
    for item in parsed.tracking:
        unit = get_or_create_unit(db, item.unit_keys[0], label=item.text)
        tracking_keys.add(unit.key)
        touched[unit.key] = unit
        db.add(
            SessionTracking(
                session_id=session.id,
                unit_id=unit.id,
                text=item.text,
            )
        )
        for key in item.unit_keys:
            tracking_keys.add(key)
    for vocab in parsed.vocab:
        if not vocab.used_well:
            tracking_keys.add(vocab.unit_key)

    focus_keys = set(parsed.focus_unit_keys)
    flag_keys = tracking_keys | focus_keys
    for key in flag_keys:
        unit = get_or_create_unit(db, key, label=key.removeprefix("item_").replace("_", " "))
        touched[unit.key] = unit
        row = _memory_row(db, unit.id)
        if row is None:
            row = UnitMemory(
                unit_id=unit.id,
                stability_days=mem.S_INIT,
                last_seen_at=None,
            )
            db.add(row)
            db.flush()
        row.is_tracking = key in tracking_keys
        row.is_focus = key in focus_keys

    db.commit()
    db.refresh(session)
    return session, parsed
