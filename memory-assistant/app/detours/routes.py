"""
API routes for detour suggestions.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.config import get_settings
from app.detours.schemas import (
    DetourSuggestRequest,
    DetourSuggestResponse,
    DetourSuggestionResponse,
)
from app.detours.ranker import suggest_detours

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/v1/detours", tags=["detours"])


@router.post("/suggest", response_model=DetourSuggestResponse)
def suggest(
    body: DetourSuggestRequest,
    db: Session = Depends(get_db),
):
    """
    Suggest 1-5 route-compatible stops based on POI knowledge base.

    Uses a straight-line corridor approximation between origin and destination,
    filters POIs by category/price/openness, and ranks by social signal score
    combined with corridor proximity and user memory preferences.

    This is NOT full trip planning — it suggests a single stop set.
    """
    suggestions = suggest_detours(
        db=db,
        user_id=body.user_id,
        origin_lat=body.origin.lat,
        origin_lng=body.origin.lng,
        dest_lat=body.destination.lat,
        dest_lng=body.destination.lng,
        max_detour_minutes=body.max_detour_minutes,
        time_budget_minutes=body.time_budget_minutes,
        intent=body.intent,
        category_filter=body.filters.category,
        price_level_max=body.filters.price_level_max,
        must_be_open=body.filters.must_be_open,
        max_results=5,
    )

    response_suggestions = []
    for s in suggestions:
        response_suggestions.append(DetourSuggestionResponse(
            poi_id=s.poi_id,
            name=s.name,
            lat=s.lat,
            lng=s.lng,
            address=s.address,
            category=s.category,
            adds_minutes=s.adds_minutes,
            corridor_distance_km=s.corridor_distance_km,
            social_score=s.social_score,
            why_special=s.why_special,
            what_to_order=s.what_to_order,
            warnings=s.warnings,
            vibe_tags=s.vibe_tags,
            confidence=s.confidence,
            sources_count=s.sources_count,
            is_open=s.is_open,
            insert_stop={
                "poi_id": s.poi_id,
                "lat": s.lat,
                "lng": s.lng,
            },
        ))

    return DetourSuggestResponse(
        suggestions=response_suggestions,
        corridor_buffer_km=settings.corridor_buffer_km,
    )
