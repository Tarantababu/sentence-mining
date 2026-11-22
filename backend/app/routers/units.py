from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.units import UnitsResponse
from app.services.study import list_units

router = APIRouter(tags=["units"])


@router.get("/api/units", response_model=UnitsResponse)
def units(db: Session = Depends(get_db)) -> UnitsResponse:
    return list_units(db)
