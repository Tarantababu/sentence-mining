from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import SessionError, SessionRecord
from app.schemas.sessions import (
    IngestRequest,
    IngestResponse,
    ParsedErrorOut,
    SessionListResponse,
    SessionLogOut,
)
from app.services.ingest import ingest_session

router = APIRouter(tags=["sessions"])


@router.post("/api/sessions/ingest", response_model=IngestResponse)
def ingest(payload: IngestRequest, db: Session = Depends(get_db)) -> IngestResponse:
    session, parsed = ingest_session(db, payload.raw_log, source="paste")
    return IngestResponse(
        session_id=session.id,
        error_count=len(parsed.errors),
        vocab_count=len(parsed.vocab),
        tracking_count=len(parsed.tracking),
        focus_next_lesson=session.focus_next_lesson,
        units_touched=sorted({item.unit_key for item in parsed.errors}),
        errors=[
            ParsedErrorOut(
                raw_utterance=item.raw_utterance,
                corrected_utterance=item.corrected_utterance,
                explanation=item.explanation,
                is_recurring=item.is_recurring,
                unit_key=item.unit_key,
            )
            for item in parsed.errors
        ],
        parser=parsed.parser,
    )


def _preview(raw_log: str) -> str:
    return " ".join(raw_log.split()).strip()[:180]


@router.get("/api/sessions", response_model=SessionListResponse)
def list_sessions(db: Session = Depends(get_db)) -> SessionListResponse:
    counts = {
        session_id: n
        for session_id, n in db.execute(
            select(SessionError.session_id, func.count()).group_by(SessionError.session_id)
        )
    }
    rows = db.scalars(
        select(SessionRecord).order_by(SessionRecord.ingested_at.desc(), SessionRecord.id.desc())
    ).all()
    return SessionListResponse(
        sessions=[
            SessionLogOut(
                id=row.id,
                ingested_at=row.ingested_at,
                source=row.source,
                error_count=int(counts.get(row.id, 0)),
                preview=_preview(row.raw_log),
            )
            for row in rows
        ]
    )


@router.get("/api/sessions/{session_id}", response_model=SessionLogOut)
def get_session(session_id: int, db: Session = Depends(get_db)) -> SessionLogOut:
    row = db.get(SessionRecord, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    error_count = db.scalar(
        select(func.count()).select_from(SessionError).where(SessionError.session_id == row.id)
    )
    return SessionLogOut(
        id=row.id,
        ingested_at=row.ingested_at,
        source=row.source,
        error_count=int(error_count or 0),
        preview=_preview(row.raw_log),
        raw_log=row.raw_log,
    )
