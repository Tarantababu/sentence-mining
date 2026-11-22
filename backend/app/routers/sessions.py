from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.sessions import IngestRequest, IngestResponse, ParsedErrorOut
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
