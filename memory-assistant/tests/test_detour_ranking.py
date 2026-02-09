"""
Tests for detour corridor filtering and ranking.
"""
import pytest

from app.detours.corridor import (
    is_within_corridor,
    estimate_detour_minutes,
    point_to_segment_distance_km,
)


class TestCorridorFilter:
    # Route: roughly Tokyo Station (35.6812, 139.7671) to Shibuya (35.6580, 139.7016)

    def test_point_on_route(self):
        """A point near the midpoint of the route should be within corridor."""
        within, dist = is_within_corridor(
            poi_lat=35.6700, poi_lng=139.7350,
            origin_lat=35.6812, origin_lng=139.7671,
            dest_lat=35.6580, dest_lng=139.7016,
            buffer_km=2.0,
        )
        assert within is True
        assert dist < 2.0

    def test_point_far_away(self):
        """A point far from the route should be outside corridor."""
        within, dist = is_within_corridor(
            poi_lat=35.7500, poi_lng=139.8000,  # well north of route
            origin_lat=35.6812, origin_lng=139.7671,
            dest_lat=35.6580, dest_lng=139.7016,
            buffer_km=2.0,
        )
        assert within is False
        assert dist > 2.0

    def test_point_at_origin(self):
        """A point at the origin should be within corridor."""
        within, dist = is_within_corridor(
            poi_lat=35.6812, poi_lng=139.7671,
            origin_lat=35.6812, origin_lng=139.7671,
            dest_lat=35.6580, dest_lng=139.7016,
            buffer_km=2.0,
        )
        assert within is True
        assert dist < 0.01

    def test_point_at_destination(self):
        """A point at the destination should be within corridor."""
        within, dist = is_within_corridor(
            poi_lat=35.6580, poi_lng=139.7016,
            origin_lat=35.6812, origin_lng=139.7671,
            dest_lat=35.6580, dest_lng=139.7016,
            buffer_km=2.0,
        )
        assert within is True
        assert dist < 0.01

    def test_wider_buffer_includes_more(self):
        """Wider buffer should include more points."""
        kwargs = dict(
            poi_lat=35.6900, poi_lng=139.7600,
            origin_lat=35.6812, origin_lng=139.7671,
            dest_lat=35.6580, dest_lng=139.7016,
        )
        within_narrow, _ = is_within_corridor(**kwargs, buffer_km=0.5)
        within_wide, _ = is_within_corridor(**kwargs, buffer_km=5.0)
        assert within_wide is True
        # Narrow may or may not include it — the point is wide always includes


class TestEstimateDetourMinutes:
    def test_zero_detour(self):
        """A POI on the direct route adds ~0 minutes."""
        # POI on midpoint of direct route
        mins = estimate_detour_minutes(
            origin_lat=35.6812, origin_lng=139.7671,
            poi_lat=35.6696, poi_lng=139.7344,
            dest_lat=35.6580, dest_lng=139.7016,
        )
        # Should be close to 0 (direct line through midpoint)
        assert mins < 2.0

    def test_detour_adds_time(self):
        """A POI off the route should add some time."""
        mins = estimate_detour_minutes(
            origin_lat=35.6812, origin_lng=139.7671,
            poi_lat=35.7000, poi_lng=139.7800,  # slightly north
            dest_lat=35.6580, dest_lng=139.7016,
        )
        assert mins > 0.0

    def test_far_detour_adds_more_time(self):
        """A farther POI should add more time."""
        mins_close = estimate_detour_minutes(
            origin_lat=35.6812, origin_lng=139.7671,
            poi_lat=35.6700, poi_lng=139.7500,
            dest_lat=35.6580, dest_lng=139.7016,
        )
        mins_far = estimate_detour_minutes(
            origin_lat=35.6812, origin_lng=139.7671,
            poi_lat=35.7200, poi_lng=139.8000,
            dest_lat=35.6580, dest_lng=139.7016,
        )
        assert mins_far > mins_close


class TestPointToSegmentDistance:
    def test_point_on_segment(self):
        """Point directly on segment should have ~0 distance."""
        dist = point_to_segment_distance_km(
            35.67, 139.73,
            35.68, 139.77,
            35.66, 139.70,
        )
        # Should be very small (point near the line)
        assert dist < 1.0

    def test_point_perpendicular(self):
        """Point perpendicular to segment midpoint."""
        # Segment: (0,0) to (0,1) — point at (1, 0.5) is 1 degree away perpendicularly
        dist = point_to_segment_distance_km(
            1.0, 0.5,
            0.0, 0.0,
            0.0, 1.0,
        )
        assert dist > 100.0  # ~111km per degree of latitude

    def test_same_point_segment(self):
        """When A == B, distance is to that point."""
        dist = point_to_segment_distance_km(
            35.68, 139.77,
            35.68, 139.77,
            35.68, 139.77,
        )
        assert dist == 0.0

    def test_distance_nonnegative(self):
        dist = point_to_segment_distance_km(
            35.7, 139.8,
            35.68, 139.77,
            35.66, 139.70,
        )
        assert dist >= 0.0
