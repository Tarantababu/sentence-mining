from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.reviews import ReviewSubmitRequest, ReviewSubmitResponse
from app.services.study import submit_review

router = APIRouter(tags=["reviews"])


@router.post("/api/reviews/submit", response_model=ReviewSubmitResponse)
def submit(payload: ReviewSubmitRequest, db: Session = Depends(get_db)) -> ReviewSubmitResponse:
    review = submit_review(db, payload.card_id, payload.result)
    return ReviewSubmitResponse(
        review_id=review.id,
        card_id=review.card_id,
        result=payload.result,
        p_before=review.p_before,
        s_before=review.s_before,
        s_after=review.s_after,
        units=list(review.s_after.keys()),
    )
