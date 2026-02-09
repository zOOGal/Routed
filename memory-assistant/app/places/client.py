"""
Places API client abstraction.

Currently implements Google Places (New) text search and details.
Swappable via PLACES_PROVIDER env var.
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class PlaceCandidate:
    """A place candidate from a search result."""
    place_id: str
    name: str
    lat: float
    lng: float
    address: Optional[str] = None
    types: List[str] = field(default_factory=list)
    rating: Optional[float] = None
    user_ratings_total: Optional[int] = None
    price_level: Optional[int] = None


@dataclass
class PlaceDetails:
    """Detailed info about a place."""
    place_id: str
    name: str
    lat: float
    lng: float
    address: Optional[str] = None
    types: List[str] = field(default_factory=list)
    rating: Optional[float] = None
    user_ratings_total: Optional[int] = None
    price_level: Optional[int] = None
    opening_hours: Optional[Dict[str, Any]] = None
    is_open_now: Optional[bool] = None


class PlacesClient:
    """Abstract interface for places search and details."""

    def search_text(
        self,
        query: str,
        location_bias: Optional[Dict[str, float]] = None,
        max_results: int = 5,
    ) -> List[PlaceCandidate]:
        raise NotImplementedError

    def get_details(self, place_id: str) -> Optional[PlaceDetails]:
        raise NotImplementedError


class GooglePlacesClient(PlacesClient):
    """Google Places API (New) client using HTTP requests."""

    BASE_URL = "https://places.googleapis.com/v1/places"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.google_places_api_key
        if not self.api_key:
            logger.warning("GOOGLE_PLACES_API_KEY not set; Places calls will fail")
        self.timeout = 10.0

    def search_text(
        self,
        query: str,
        location_bias: Optional[Dict[str, float]] = None,
        max_results: int = 5,
    ) -> List[PlaceCandidate]:
        """
        Search for places using Google Places Text Search (New).

        Args:
            query: Search query string (e.g. "Ramen Nagi Tokyo")
            location_bias: Optional dict with "lat" and "lng" keys for bias
            max_results: Maximum results to return

        Returns:
            List of PlaceCandidate objects.
        """
        if not self.api_key:
            return []

        url = f"{self.BASE_URL}:searchText"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": (
                "places.id,places.displayName,places.location,"
                "places.formattedAddress,places.types,places.rating,"
                "places.userRatingCount,places.priceLevel"
            ),
        }
        body: Dict[str, Any] = {
            "textQuery": query,
            "maxResultCount": max_results,
        }

        if location_bias:
            body["locationBias"] = {
                "circle": {
                    "center": {
                        "latitude": location_bias["lat"],
                        "longitude": location_bias["lng"],
                    },
                    "radius": 50000.0,  # 50km radius
                }
            }

        try:
            resp = httpx.post(url, json=body, headers=headers, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"Google Places search error: {e}")
            return []

        results = []
        for place in data.get("places", []):
            loc = place.get("location", {})
            display_name = place.get("displayName", {})

            # Map Google price level enum to int
            price_level = _parse_price_level(place.get("priceLevel"))

            results.append(PlaceCandidate(
                place_id=place.get("id", ""),
                name=display_name.get("text", ""),
                lat=loc.get("latitude", 0.0),
                lng=loc.get("longitude", 0.0),
                address=place.get("formattedAddress"),
                types=place.get("types", []),
                rating=place.get("rating"),
                user_ratings_total=place.get("userRatingCount"),
                price_level=price_level,
            ))

        return results

    def get_details(self, place_id: str) -> Optional[PlaceDetails]:
        """
        Get detailed info about a place by its Google Place ID.
        """
        if not self.api_key:
            return None

        url = f"{self.BASE_URL}/{place_id}"
        headers = {
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": (
                "id,displayName,location,formattedAddress,types,"
                "rating,userRatingCount,priceLevel,"
                "currentOpeningHours,regularOpeningHours"
            ),
        }

        try:
            resp = httpx.get(url, headers=headers, timeout=self.timeout)
            resp.raise_for_status()
            place = resp.json()
        except Exception as e:
            logger.error(f"Google Places details error for {place_id}: {e}")
            return None

        loc = place.get("location", {})
        display_name = place.get("displayName", {})

        opening_hours = place.get("currentOpeningHours") or place.get("regularOpeningHours")
        is_open_now = None
        if opening_hours:
            is_open_now = opening_hours.get("openNow")

        return PlaceDetails(
            place_id=place.get("id", place_id),
            name=display_name.get("text", ""),
            lat=loc.get("latitude", 0.0),
            lng=loc.get("longitude", 0.0),
            address=place.get("formattedAddress"),
            types=place.get("types", []),
            rating=place.get("rating"),
            user_ratings_total=place.get("userRatingCount"),
            price_level=_parse_price_level(place.get("priceLevel")),
            opening_hours=opening_hours,
            is_open_now=is_open_now,
        )


def _parse_price_level(val: Any) -> Optional[int]:
    """Convert Google's price level enum string to int."""
    if val is None:
        return None
    mapping = {
        "PRICE_LEVEL_FREE": 0,
        "PRICE_LEVEL_INEXPENSIVE": 1,
        "PRICE_LEVEL_MODERATE": 2,
        "PRICE_LEVEL_EXPENSIVE": 3,
        "PRICE_LEVEL_VERY_EXPENSIVE": 4,
    }
    if isinstance(val, str):
        return mapping.get(val)
    if isinstance(val, (int, float)):
        return int(val)
    return None


# Singleton
_client: Optional[PlacesClient] = None


def get_places_client() -> PlacesClient:
    """Get or create the Places client singleton."""
    global _client
    if _client is None:
        if settings.places_provider == "google":
            _client = GooglePlacesClient()
        else:
            raise ValueError(f"Unknown places provider: {settings.places_provider}")
    return _client
