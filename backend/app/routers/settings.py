from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.schemas.settings import SettingsResponse, SettingsUpdate
from app.services.study import count_reviews_today, get_app_settings

router = APIRouter(tags=["settings"])


def _payload(db: Session) -> SettingsResponse:
    configured = get_settings().openai_configured
    row = get_app_settings(db)
    remaining = None
    if row.daily_limit is not None:
        remaining = max(0, int(row.daily_limit) - count_reviews_today(db)["total"])
    return SettingsResponse(
        openai_configured=configured,
        has_personal_key=False,
        has_hosted_key=configured,
        api_key_set=configured,
        daily_limit=row.daily_limit,
        remaining_today=remaining,
    )


@router.get("/api/settings", response_model=SettingsResponse)
def read_settings(db: Session = Depends(get_db)) -> SettingsResponse:
    return _payload(db)


@router.put("/api/settings", response_model=SettingsResponse)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)) -> SettingsResponse:
    row = get_app_settings(db)
    row.daily_limit = payload.daily_limit
    db.commit()
    return _payload(db)
