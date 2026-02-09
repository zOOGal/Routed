"""
Detour suggestion ranking logic.

Ranks POI candidates based on:
- Social signal score (from poi_aggregates)
- Proximity to route corridor
- User memory preferences (reranking)
"""
import logging
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.models import POI, POIAggregate, POISignal, Memory, MemoryType
from app.places.client import get_places_client
from app.detours.corridor import (
    is_within_corridor,
    estimate_detour_minutes,
)
from app.memory.retrieval import retrieve_hybrid
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Map filter categories to Google place types
CATEGORY_FILTER_MAP = {
    "food": ["restaurant", "food", "meal"],
    "cafe": ["cafe", "coffee"],
    "bar": ["bar", "pub", "night_club"],
    "dessert": ["bakery", "ice_cream", "dessert", "cafe"],
    "any": [],
}


@dataclass
class DetourSuggestion:
    """A ranked detour suggestion."""
    poi_id: str
    name: str
    lat: float
    lng: float
    address: Optional[str]
    category: Optional[str]
    adds_minutes: float
    corridor_distance_km: float
    social_score: float
    why_special: str
    what_to_order: List[str]
    warnings: List[str]
    vibe_tags: List[str]
    confidence: float
    sources_count: Dict[str, int]
    is_open: Optional[bool] = None


def suggest_detours(
    db: Session,
    user_id: Optional[UUID],
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    max_detour_minutes: float = 15.0,
    time_budget_minutes: float = 30.0,
    intent: str = "",
    category_filter: str = "any",
    price_level_max: Optional[int] = None,
    must_be_open: bool = False,
    max_results: int = 5,
) -> List[DetourSuggestion]:
    """
    Suggest POIs along a route corridor.

    1. Query POIs within corridor buffer.
    2. Filter by category and price.
    3. Rank by social score + corridor proximity + user preferences.
    4. Optionally check open hours for top candidates.
    5. Return top N suggestions.
    """
    buffer_km = settings.corridor_buffer_km

    # Step 1: Query POIs with aggregates, within a bounding box first (fast filter)
    bbox = _bounding_box(origin_lat, origin_lng, dest_lat, dest_lng, buffer_km)

    query = (
        select(POI, POIAggregate)
        .outerjoin(POIAggregate, POI.id == POIAggregate.poi_id)
        .where(
            POI.lat >= bbox["min_lat"],
            POI.lat <= bbox["max_lat"],
            POI.lng >= bbox["min_lng"],
            POI.lng <= bbox["max_lng"],
        )
    )

    # Category filter on POI categories (JSONB)
    # We filter in Python since JSONB array containment varies
    rows = db.execute(query).all()

    # Step 2: Filter by corridor, category, and price
    candidates: List[Dict[str, Any]] = []

    for poi, aggregate in rows:
        # Corridor check
        within, corridor_dist = is_within_corridor(
            poi.lat, poi.lng,
            origin_lat, origin_lng,
            dest_lat, dest_lng,
            buffer_km,
        )
        if not within:
            continue

        # Category filter
        if category_filter != "any":
            type_keywords = CATEGORY_FILTER_MAP.get(category_filter, [])
            poi_categories = poi.categories or []
            if type_keywords and not any(
                kw in cat.lower()
                for cat in poi_categories
                for kw in type_keywords
            ):
                continue

        # Price filter
        if price_level_max is not None and poi.price_level is not None:
            if poi.price_level > price_level_max:
                continue

        # Detour time estimate
        detour_mins = estimate_detour_minutes(
            origin_lat, origin_lng,
            poi.lat, poi.lng,
            dest_lat, dest_lng,
        )
        if detour_mins > max_detour_minutes:
            continue

        agg_json = aggregate.aggregate_json if aggregate else {}
        social_score = aggregate.score if aggregate else 0.0

        candidates.append({
            "poi": poi,
            "aggregate": aggregate,
            "corridor_dist": corridor_dist,
            "detour_mins": detour_mins,
            "social_score": social_score,
            "agg_json": agg_json,
        })

    if not candidates:
        logger.info(
            "detours.suggest_detours",
            extra={
                "user_id": str(user_id) if user_id else None,
                "category_filter": category_filter,
                "bbox_pois_count": len(rows),
                "corridor_candidates": 0,
                "result_count": 0,
                "reason_if_empty": "no POIs within corridor after filtering",
            },
        )
        return []

    # Step 3: Rank candidates
    # Base ranking by social score and corridor proximity
    for c in candidates:
        proximity_score = max(0.0, 1.0 - c["corridor_dist"] / buffer_km)
        c["rank_score"] = c["social_score"] * 0.6 + proximity_score * 0.4

    # Apply user memory reranking if user_id is provided
    if user_id:
        _apply_memory_reranking(db, user_id, intent, candidates)

    # Sort by rank score descending
    candidates.sort(key=lambda c: c["rank_score"], reverse=True)

    # Take top candidates (more than needed for open-hours check)
    top_k = candidates[: max_results * 2]

    # Step 4: Check open hours if required
    if must_be_open:
        places_client = get_places_client()
        open_candidates = []
        for c in top_k:
            poi = c["poi"]
            try:
                details = places_client.get_details(poi.provider_place_id)
                if details and details.is_open_now is not None:
                    c["is_open"] = details.is_open_now
                    if details.is_open_now:
                        open_candidates.append(c)
                else:
                    # Unknown hours — include with caveat
                    c["is_open"] = None
                    open_candidates.append(c)
            except Exception as e:
                logger.warning(f"Failed to check hours for {poi.name}: {e}")
                open_candidates.append(c)

            if len(open_candidates) >= max_results:
                break

        top_k = open_candidates

    # Step 5: Build response
    results = []
    for c in top_k[:max_results]:
        poi = c["poi"]
        agg = c["agg_json"]

        # Determine primary category from aggregate signals or POI types
        category = _infer_category(poi.categories or [])

        results.append(DetourSuggestion(
            poi_id=str(poi.id),
            name=poi.name,
            lat=poi.lat,
            lng=poi.lng,
            address=poi.address,
            category=category,
            adds_minutes=round(c["detour_mins"], 1),
            corridor_distance_km=round(c["corridor_dist"], 2),
            social_score=round(c["social_score"], 2),
            why_special=_first_snippet(agg.get("why_special_snippets", [])),
            what_to_order=agg.get("top_what_to_order", [])[:3],
            warnings=agg.get("warnings", []),
            vibe_tags=agg.get("top_vibe_tags", [])[:5],
            confidence=min(1.0, c["rank_score"] / 5.0),
            sources_count=agg.get("sources_count", {}),
            is_open=c.get("is_open"),
        ))

    logger.info(
        "detours.suggest_detours",
        extra={
            "user_id": str(user_id) if user_id else None,
            "category_filter": category_filter,
            "bbox_pois_count": len(rows),
            "corridor_candidates": len(candidates),
            "result_count": len(results),
            "top_scores": [round(c["rank_score"], 2) for c in top_k[:max_results]],
        },
    )

    return results


def _apply_memory_reranking(
    db: Session,
    user_id: UUID,
    intent: str,
    candidates: List[Dict[str, Any]],
) -> None:
    """
    Rerank candidates based on user memories (preferences, constraints).
    """
    query_text = intent or "food preferences travel dining"

    try:
        memories = retrieve_hybrid(db, user_id, query_text, max_memories=5)
    except Exception as e:
        logger.warning(f"Memory retrieval failed for user {user_id}: {e}")
        return

    if not memories:
        return

    # Extract simple preference signals from memory text
    positive_signals: List[str] = []
    negative_signals: List[str] = []

    for m in memories:
        text_lower = m.text.lower()
        if m.type == MemoryType.preference:
            positive_signals.append(text_lower)
        elif m.type == MemoryType.constraint:
            negative_signals.append(text_lower)

    for c in candidates:
        agg = c["agg_json"]
        tags = " ".join(agg.get("top_vibe_tags", []) + agg.get("top_what_to_order", [])).lower()
        warnings_text = " ".join(agg.get("warnings", [])).lower()
        name_lower = c["poi"].name.lower()
        combined = f"{tags} {name_lower}"

        # Boost for matching positive preferences
        for pref in positive_signals:
            # Check if any keyword from the preference appears in POI tags
            pref_words = [w for w in pref.split() if len(w) > 3]
            for word in pref_words:
                if word in combined:
                    c["rank_score"] += 0.3
                    break

        # Penalize for matching constraints/dislikes
        for constraint in negative_signals:
            constraint_words = [w for w in constraint.split() if len(w) > 3]
            for word in constraint_words:
                if word in combined or word in warnings_text:
                    c["rank_score"] -= 0.5
                    break


def _bounding_box(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
    buffer_km: float,
) -> Dict[str, float]:
    """Compute a bounding box around two points with a buffer."""
    # Rough conversion: 1 degree lat ≈ 111km
    lat_buffer = buffer_km / 111.0
    # Rough conversion: 1 degree lng varies by latitude
    avg_lat = (lat1 + lat2) / 2
    lng_buffer = buffer_km / (111.0 * math.cos(math.radians(avg_lat)))

    return {
        "min_lat": min(lat1, lat2) - lat_buffer,
        "max_lat": max(lat1, lat2) + lat_buffer,
        "min_lng": min(lng1, lng2) - lng_buffer,
        "max_lng": max(lng1, lng2) + lng_buffer,
    }


def _infer_category(types: List[str]) -> Optional[str]:
    """Infer a simple category from Google place types."""
    types_lower = [t.lower() for t in types]
    for t in types_lower:
        if any(k in t for k in ["restaurant", "food", "meal"]):
            return "food"
        if any(k in t for k in ["cafe", "coffee"]):
            return "cafe"
        if any(k in t for k in ["bar", "pub", "night_club"]):
            return "bar"
        if any(k in t for k in ["bakery", "ice_cream", "dessert"]):
            return "dessert"
        if any(k in t for k in ["tourist_attraction", "park", "viewpoint"]):
            return "viewpoint"
        if any(k in t for k in ["store", "shop", "market"]):
            return "shop"
    return "other"


def _first_snippet(snippets: List[str]) -> str:
    """Get the first non-empty snippet."""
    for s in snippets:
        if s and s.strip():
            return s.strip()
    return ""
