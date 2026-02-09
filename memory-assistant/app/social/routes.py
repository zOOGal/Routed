"""
API routes for social post ingestion.
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.social.schemas import SocialPostCreate, SocialPostResponse, ExtractionResponse
from app.social.service import ingest_post, run_extraction

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/social", tags=["social"])


@router.post("/posts", response_model=SocialPostResponse)
def create_social_post(
    body: SocialPostCreate,
    db: Session = Depends(get_db),
):
    """
    Ingest a social post.

    - Reddit: fetches content from public JSON endpoint if URL provided.
    - XHS/TikTok/Instagram: link-only; requires raw_text from user.
    - Manual: accepts raw_text directly.
    """
    try:
        result = ingest_post(
            db=db,
            source=body.source,
            url=body.url,
            raw_text=body.raw_text,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(result["post"])

    response = SocialPostResponse.model_validate(result["post"])
    response.status = result["status"]
    return response


@router.post("/posts/{post_id}/extract", response_model=ExtractionResponse)
def extract_social_post(
    post_id: UUID,
    city_hint: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Run LLM extraction on a social post to extract place candidates.
    """
    try:
        result = run_extraction(db=db, post_id=post_id, city_hint=city_hint)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(result["extraction"])

    return ExtractionResponse.model_validate(result["extraction"])
