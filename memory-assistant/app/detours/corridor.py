"""
Route corridor approximation for detour suggestions.

MVP: Uses a straight-line corridor between origin and destination,
with a configurable buffer radius.
"""
import math
from typing import List, Tuple

from app.places.canonicalize import haversine_km


def point_to_segment_distance_km(
    px: float, py: float,
    ax: float, ay: float,
    bx: float, by: float,
) -> float:
    """
    Approximate distance from point P(px,py) to line segment A(ax,ay)-B(bx,by)
    in kilometers. Uses lat/lng coordinates with haversine for final distance.

    Projects point onto segment, finds closest point on segment, then
    computes haversine distance.
    """
    # Vector AB
    dx = bx - ax
    dy = by - ay
    seg_len_sq = dx * dx + dy * dy

    if seg_len_sq < 1e-12:
        # A and B are the same point
        return haversine_km(px, py, ax, ay)

    # Parameter t of projection of P onto line AB, clamped to [0,1]
    t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))

    # Closest point on segment
    closest_lat = ax + t * dx
    closest_lng = ay + t * dy

    return haversine_km(px, py, closest_lat, closest_lng)


def is_within_corridor(
    poi_lat: float,
    poi_lng: float,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    buffer_km: float,
) -> Tuple[bool, float]:
    """
    Check if a POI is within the route corridor buffer.

    Returns:
        Tuple of (is_within, distance_km from corridor centerline).
    """
    dist = point_to_segment_distance_km(
        poi_lat, poi_lng,
        origin_lat, origin_lng,
        dest_lat, dest_lng,
    )
    return dist <= buffer_km, dist


def estimate_detour_minutes(
    origin_lat: float, origin_lng: float,
    poi_lat: float, poi_lng: float,
    dest_lat: float, dest_lng: float,
) -> float:
    """
    Estimate extra travel time (in minutes) for a detour through a POI.

    Uses straight-line distances with an assumed average speed of 30 km/h
    (urban driving). This is a rough approximation for MVP.

    Detour time = (origin->POI + POI->dest) - (origin->dest)
    """
    direct_km = haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    via_poi_km = (
        haversine_km(origin_lat, origin_lng, poi_lat, poi_lng)
        + haversine_km(poi_lat, poi_lng, dest_lat, dest_lng)
    )
    extra_km = max(0.0, via_poi_km - direct_km)

    avg_speed_kmh = 30.0
    return (extra_km / avg_speed_kmh) * 60.0
