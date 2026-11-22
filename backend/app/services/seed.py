from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import SessionRecord
from app.services.ingest import ingest_session
from app.services.study import generate_study_pack
from app.services.unit_catalog import ensure_catalog

SAMPLE_PATH = Path(__file__).resolve().parents[1] / "data" / "sample_session.txt"


def sample_log() -> str:
    return SAMPLE_PATH.read_text(encoding="utf-8")


def seed_if_needed(db: Session) -> None:
    ensure_catalog(db)
    count = db.scalar(select(func.count()).select_from(SessionRecord)) or 0
    if count:
        return
    ingest_session(db, sample_log(), source="seed")
    generate_study_pack(db)
