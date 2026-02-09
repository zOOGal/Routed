"""
Place canonicalization: match extracted candidates to real places via Places API.
"""
import logging
import math
from collections import Counter
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models import (
    SocialPost, SocialExtraction, POI, POISignal, POIAggregate,
    POIProvider, SocialSource,
)
from app.places.client import get_places_client, PlaceCandidate

logger = logging.getLogger(__name__)

# Category mapping: our categories -> Google types substrings
CATEGORY_TYPE_MAP = {
    "food": ["restaurant", "meal_delivery", "meal_takeaway", "food"],
    "cafe": ["cafe", "coffee"],
    "bar": ["bar", "night_club", "pub"],
    "dessert": ["bakery", "ice_cream", "dessert", "cafe"],
    "viewpoint": ["tourist_attraction", "park", "point_of_interest", "natural_feature"],
    "shop": ["store", "shop", "shopping_mall", "market"],
}


def name_similarity(a: str, b: str) -> float:
    """
    Compute name similarity between two place names.
    Uses SequenceMatcher ratio on lowercased, stripped strings.
    """
    a_clean = a.lower().strip()
    b_clean = b.lower().strip()
    if not a_clean or not b_clean:
        return 0.0
    return SequenceMatcher(None, a_clean, b_clean).ratio()


def category_match_score(candidate_category: str, google_types: List[str]) -> float:
    """
    Score how well a candidate's category matches Google place types.
    Returns 0.0 - 1.0.
    """
    expected_types = CATEGORY_TYPE_MAP.get(candidate_category, [])
    if not expected_types:
        return 0.5  # "other" category gets neutral score

    for gtype in google_types:
        for expected in expected_types:
            if expected in gtype.lower():
                return 1.0
    return 0.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance between two points in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def score_match(
    candidate_name: str,
    candidate_category: str,
    place: PlaceCandidate,
    location_bias: Optional[Dict[str, float]] = None,
) -> float:
    """
    Score a Places API result against an extraction candidate.

    Returns a score 0.0 - 1.0 combining:
    - name similarity (weight: 0.5)
    - category match (weight: 0.3)
    - proximity bonus (weight: 0.2)
    """
    ns = name_similarity(candidate_name, place.name)
    cs = category_match_score(candidate_category, place.types)

    proximity = 0.5  # neutral default
    if location_bias and place.lat and place.lng:
        dist = haversine_km(location_bias["lat"], location_bias["lng"], place.lat, place.lng)
        # Within 5km = 1.0, at 50km = 0.0
        proximity = max(0.0, 1.0 - dist / 50.0)

    return ns * 0.5 + cs * 0.3 + proximity * 0.2


def canonicalize_post(
    db: Session,
    social_post_id: UUID,
    match_threshold: float = 0.55,
) -> Dict[str, Any]:
    """
    Canonicalize extracted candidates from a social post to real POIs.

    Args:
        db: Database session.
        social_post_id: ID of the social post.
        match_threshold: Minimum match score to accept.

    Returns:
        Dict with created_or_linked_pois and unmatched_candidates.
    """
    # Load latest extraction
    extraction = db.execute(
        select(SocialExtraction)
        .where(SocialExtraction.social_post_id == social_post_id)
        .order_by(SocialExtraction.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if not extraction:
        return {"created_or_linked_pois": [], "unmatched_candidates": [], "error": "No extraction found"}

    post = db.get(SocialPost, social_post_id)
    candidates = extraction.extracted_json.get("candidates", [])
    places_client = get_places_client()

    linked_pois = []
    unmatched = []

    for candidate in candidates:
        place_name = candidate.get("place_name", "")
        if not place_name:
            continue

        # Build search query
        query_parts = [place_name]
        if candidate.get("city_hint"):
            query_parts.append(candidate["city_hint"])
        elif candidate.get("landmark_hint"):
            query_parts.append(candidate["landmark_hint"])
        elif candidate.get("address_hint"):
            query_parts.append(candidate["address_hint"])

        query = " ".join(query_parts)

        # Location bias from city hint (basic geocoding not implemented,
        # rely on Places API text search to handle city names in query)
        location_bias = None

        # Search Places API
        try:
            search_results = places_client.search_text(
                query=query,
                location_bias=location_bias,
                max_results=3,
            )
        except Exception as e:
            logger.error(f"Places search failed for '{query}': {e}")
            unmatched.append({"candidate": candidate, "reason": f"search_error: {e}"})
            continue

        if not search_results:
            unmatched.append({"candidate": candidate, "reason": "no_results"})
            continue

        # Score and pick best match
        best_place = None
        best_score = 0.0
        for sr in search_results:
            s = score_match(
                candidate_name=place_name,
                candidate_category=candidate.get("category", "other"),
                place=sr,
                location_bias=location_bias,
            )
            if s > best_score:
                best_score = s
                best_place = sr

        if best_score < match_threshold or best_place is None:
            unmatched.append({
                "candidate": candidate,
                "reason": "below_threshold",
                "best_score": best_score,
            })
            continue

        # Find or create POI
        poi = db.execute(
            select(POI).where(
                POI.provider == POIProvider.google,
                POI.provider_place_id == best_place.place_id,
            )
        ).scalar_one_or_none()

        if not poi:
            poi = POI(
                provider=POIProvider.google,
                provider_place_id=best_place.place_id,
                name=best_place.name,
                lat=best_place.lat,
                lng=best_place.lng,
                address=best_place.address,
                categories=best_place.types,
                price_level=best_place.price_level,
                rating=best_place.rating,
                user_ratings_total=best_place.user_ratings_total,
            )
            db.add(poi)
            db.flush()

        # Create POI signal
        signal = POISignal(
            poi_id=poi.id,
            source=post.source if post else SocialSource.manual,
            social_post_id=social_post_id,
            signal_json={
                "vibe_tags": candidate.get("vibe_tags", []),
                "what_to_order": candidate.get("what_to_order", []),
                "why_special": candidate.get("why_special", ""),
                "warnings": candidate.get("warnings", []),
                "best_time_windows": candidate.get("best_time_windows", []),
                "price_level_hint": candidate.get("price_level_hint"),
                "category": candidate.get("category", "other"),
            },
            confidence=candidate.get("confidence", 0.5),
        )
        db.add(signal)
        db.flush()

        # Update aggregate
        _update_aggregate(db, poi.id)

        linked_pois.append({
            "poi_id": str(poi.id),
            "provider_place_id": best_place.place_id,
            "match_confidence": round(best_score, 3),
            "name": best_place.name,
        })

    db.commit()

    logger.info(
        "places.canonicalize_post",
        extra={
            "social_post_id": str(social_post_id),
            "total_candidates": len(candidates),
            "linked_count": len(linked_pois),
            "unmatched_count": len(unmatched),
            "unmatched_reasons": [u.get("reason", "unknown") for u in unmatched],
        },
    )

    return {
        "created_or_linked_pois": linked_pois,
        "unmatched_candidates": unmatched,
    }


def _update_aggregate(db: Session, poi_id: UUID) -> None:
    """Recompute and upsert the POI aggregate from all signals."""
    signals = db.execute(
        select(POISignal).where(POISignal.poi_id == poi_id)
    ).scalars().all()

    aggregate_json = compute_aggregate(signals)
    score = compute_score(signals, aggregate_json)

    existing = db.get(POIAggregate, poi_id)
    if existing:
        existing.aggregate_json = aggregate_json
        existing.score = score
        existing.updated_at = datetime.utcnow()
    else:
        agg = POIAggregate(
            poi_id=poi_id,
            aggregate_json=aggregate_json,
            score=score,
        )
        db.add(agg)


def compute_aggregate(signals: List[POISignal]) -> Dict[str, Any]:
    """Merge all signals into a single aggregate JSON."""
    vibe_counter: Counter = Counter()
    order_counter: Counter = Counter()
    warnings_set: set = set()
    why_snippets: List[str] = []
    sources_count: Counter = Counter()
    time_windows: Counter = Counter()

    for s in signals:
        sj = s.signal_json or {}
        sources_count[s.source.value] += 1

        for tag in sj.get("vibe_tags", []):
            vibe_counter[tag] += 1
        for item in sj.get("what_to_order", []):
            order_counter[item] += 1
        for w in sj.get("warnings", []):
            warnings_set.add(w)
        why = sj.get("why_special", "")
        if why and why not in why_snippets:
            why_snippets.append(why)
        for tw in sj.get("best_time_windows", []):
            time_windows[tw] += 1

    return {
        "top_vibe_tags": [t for t, _ in vibe_counter.most_common(10)],
        "top_what_to_order": [t for t, _ in order_counter.most_common(10)],
        "warnings": list(warnings_set),
        "why_special_snippets": why_snippets[:5],
        "best_time_windows": [t for t, _ in time_windows.most_common(5)],
        "sources_count": dict(sources_count),
        "total_mentions": len(signals),
    }


def compute_score(signals: List[POISignal], aggregate: Dict[str, Any]) -> float:
    """
    Compute a deterministic score for ranking POIs.

    Formula:
    - log(1 + mentions) * 2.0
    - + avg_confidence * 1.0
    - + recency_bonus (0-1 based on newest signal)
    """
    if not signals:
        return 0.0

    mentions = len(signals)
    mention_score = math.log(1 + mentions) * 2.0

    avg_confidence = sum(s.confidence for s in signals) / mentions

    # Recency: newest signal age in days
    newest = max(s.created_at for s in signals)
    age_days = (datetime.utcnow() - newest).days
    recency_bonus = max(0.0, 1.0 - age_days / 365.0)

    return mention_score + avg_confidence + recency_bonus
