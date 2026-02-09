"""
Pydantic schemas for detour suggestion API.
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class LatLng(BaseModel):
    lat: float
    lng: float


class DetourFilters(BaseModel):
    category: str = "any"
    price_level_max: Optional[int] = Field(None, ge=1, le=4)
    must_be_open: bool = False


class DetourSuggestRequest(BaseModel):
    user_id: Optional[UUID] = None
    origin: LatLng
    destination: LatLng
    departure_time: Optional[str] = None  # ISO timestamp
    arrival_time: Optional[str] = None  # ISO timestamp
    time_budget_minutes: float = Field(30.0, ge=5, le=120)
    max_detour_minutes: float = Field(15.0, ge=1, le=60)
    intent: str = Field("", max_length=200)
    filters: DetourFilters = DetourFilters()


class DetourSuggestionResponse(BaseModel):
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
    insert_stop: Dict[str, Any] = {}


class DetourSuggestResponse(BaseModel):
    suggestions: List[DetourSuggestionResponse]
    corridor_buffer_km: float
    note: str = "Detour times are straight-line estimates. Actual driving time may vary."
