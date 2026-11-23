from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.study import StudyPackGenerateRequest, StudyPackResponse
from app.services.study import generate_study_pack, latest_study_pack, pack_to_response

router = APIRouter(tags=["study-pack"])


@router.get("/api/study-pack/latest", response_model=StudyPackResponse)
def get_latest(db: Session = Depends(get_db)) -> StudyPackResponse:
    pack = latest_study_pack(db)
    if pack is None:
        raise HTTPException(status_code=404, detail="no study pack yet")
    return pack_to_response(pack)


@router.post("/api/study-pack/generate", response_model=StudyPackResponse)
def generate(
    payload: StudyPackGenerateRequest | None = None,
    db: Session = Depends(get_db),
) -> StudyPackResponse:
    body = payload or StudyPackGenerateRequest()
    pack = generate_study_pack(
        db,
        budget_cards=body.budget_cards,
        budget_prompts=body.budget_prompts,
        due_only=body.due_only,
        stretch_only=body.stretch_only,
    )
    return pack_to_response(pack)
