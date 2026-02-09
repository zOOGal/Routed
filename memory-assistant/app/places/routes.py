"""
API routes for POI canonicalization.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.places.schemas import CanonicalizeRequest, CanonicalizeResponse
from app.places.canonicalize import canonicalize_post

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/poi", tags=["poi"])


@router.post("/canonicalize", response_model=CanonicalizeResponse)
def canonicalize(
    body: CanonicalizeRequest,
    db: Session = Depends(get_db),
):
    """
    Canonicalize extracted place candidates from a social post
    to real POIs via Places API.

    For each candidate in the latest extraction:
    1. Searches Places API using name + city/address hints
    2. Scores matches by name similarity + category + proximity
    3. Creates or links POI records for matches above threshold
    4. Writes POI signals and updates aggregates
    """
    result = canonicalize_post(db, body.social_post_id)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return CanonicalizeResponse(**result)
