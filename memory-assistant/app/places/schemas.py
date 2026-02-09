"""
Pydantic schemas for POI canonicalization API.
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel


class CanonicalizeRequest(BaseModel):
    social_post_id: UUID


class LinkedPOI(BaseModel):
    poi_id: str
    provider_place_id: str
    match_confidence: float
    name: str


class UnmatchedCandidate(BaseModel):
    candidate: Dict[str, Any]
    reason: str
    best_score: Optional[float] = None


class CanonicalizeResponse(BaseModel):
    created_or_linked_pois: List[LinkedPOI]
    unmatched_candidates: List[Dict[str, Any]]
