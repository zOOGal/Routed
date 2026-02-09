"""
Tests for place canonicalization scoring functions.
"""
import pytest
from dataclasses import dataclass, field
from app.places.canonicalize import (
    name_similarity,
    category_match_score,
    score_match,
    compute_aggregate,
    compute_score,
    haversine_km,
)
from app.places.client import PlaceCandidate
from app.models import SocialSource
from datetime import datetime, timedelta
import uuid


@dataclass
class FakeSignal:
    """Test stand-in for POISignal without SQLAlchemy instrumentation."""
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    poi_id: uuid.UUID = field(default_factory=uuid.uuid4)
    source: SocialSource = SocialSource.reddit
    signal_json: dict = field(default_factory=dict)
    confidence: float = 0.8
    created_at: datetime = field(default_factory=datetime.utcnow)


class TestNameSimilarity:
    def test_exact_match(self):
        assert name_similarity("Ramen Nagi", "Ramen Nagi") == 1.0

    def test_case_insensitive(self):
        assert name_similarity("ramen nagi", "RAMEN NAGI") == 1.0

    def test_partial_match(self):
        score = name_similarity("Ramen Nagi", "Ramen Nagi Shinjuku")
        assert 0.5 < score < 1.0

    def test_no_match(self):
        score = name_similarity("Pizza Hut", "Ramen Nagi")
        assert score < 0.4

    def test_empty_strings(self):
        assert name_similarity("", "Ramen Nagi") == 0.0
        assert name_similarity("Ramen Nagi", "") == 0.0
        assert name_similarity("", "") == 0.0

    def test_similar_names(self):
        score = name_similarity("Ichiran Ramen", "Ichiran")
        assert score > 0.5


class TestCategoryMatchScore:
    def test_food_match(self):
        score = category_match_score("food", ["restaurant", "point_of_interest"])
        assert score == 1.0

    def test_cafe_match(self):
        score = category_match_score("cafe", ["cafe", "food", "point_of_interest"])
        assert score == 1.0

    def test_bar_match(self):
        score = category_match_score("bar", ["bar", "night_club"])
        assert score == 1.0

    def test_no_match(self):
        score = category_match_score("food", ["park", "tourist_attraction"])
        assert score == 0.0

    def test_other_category(self):
        score = category_match_score("other", ["anything"])
        assert score == 0.5

    def test_dessert_match(self):
        score = category_match_score("dessert", ["bakery", "food"])
        assert score == 1.0


class TestScoreMatch:
    def _make_candidate(self, name="Test Place", types=None, lat=35.6, lng=139.7):
        return PlaceCandidate(
            place_id="test_id",
            name=name,
            lat=lat,
            lng=lng,
            types=types or [],
        )

    def test_perfect_match(self):
        candidate = self._make_candidate(
            name="Ramen Nagi",
            types=["restaurant", "food"],
        )
        score = score_match("Ramen Nagi", "food", candidate)
        assert score > 0.8

    def test_poor_match(self):
        candidate = self._make_candidate(
            name="Tokyo Tower",
            types=["tourist_attraction"],
        )
        score = score_match("Ramen Nagi", "food", candidate)
        assert score < 0.4

    def test_location_bias_close(self):
        candidate = self._make_candidate(lat=35.6, lng=139.7)
        score_close = score_match(
            "Test", "food", candidate,
            location_bias={"lat": 35.6, "lng": 139.7},
        )
        score_far = score_match(
            "Test", "food", candidate,
            location_bias={"lat": 40.0, "lng": 140.0},
        )
        assert score_close > score_far

    def test_score_range(self):
        candidate = self._make_candidate()
        score = score_match("anything", "other", candidate)
        assert 0.0 <= score <= 1.0


class TestComputeAggregate:
    def _make_signal(self, vibe_tags=None, what_to_order=None, warnings=None,
                     why_special="", source=SocialSource.reddit):
        return FakeSignal(
            source=source,
            signal_json={
                "vibe_tags": vibe_tags or [],
                "what_to_order": what_to_order or [],
                "warnings": warnings or [],
                "why_special": why_special,
                "best_time_windows": [],
            },
        )

    def test_empty_signals(self):
        result = compute_aggregate([])
        assert result["total_mentions"] == 0
        assert result["top_vibe_tags"] == []

    def test_single_signal(self):
        signal = self._make_signal(
            vibe_tags=["cozy", "hidden gem"],
            what_to_order=["tonkotsu ramen"],
            warnings=["cash only"],
            why_special="Best ramen in town",
        )
        result = compute_aggregate([signal])
        assert "cozy" in result["top_vibe_tags"]
        assert "hidden gem" in result["top_vibe_tags"]
        assert "tonkotsu ramen" in result["top_what_to_order"]
        assert "cash only" in result["warnings"]
        assert result["total_mentions"] == 1

    def test_multiple_signals_dedup(self):
        s1 = self._make_signal(
            warnings=["cash only"],
            why_special="Amazing",
            source=SocialSource.reddit,
        )
        s2 = self._make_signal(
            warnings=["cash only", "long lines"],
            why_special="Best ever",
            source=SocialSource.xhs,
        )
        result = compute_aggregate([s1, s2])
        # Warnings should be deduped
        assert result["warnings"].count("cash only") == 1
        assert "long lines" in result["warnings"]
        assert result["sources_count"]["reddit"] == 1
        assert result["sources_count"]["xhs"] == 1

    def test_vibe_tag_counting(self):
        s1 = self._make_signal(vibe_tags=["cozy", "romantic"])
        s2 = self._make_signal(vibe_tags=["cozy", "hidden gem"])
        s3 = self._make_signal(vibe_tags=["cozy"])
        result = compute_aggregate([s1, s2, s3])
        # "cozy" should be first (most common)
        assert result["top_vibe_tags"][0] == "cozy"


class TestComputeScore:
    def _make_signal(self, confidence=0.8, days_ago=0):
        return FakeSignal(
            confidence=confidence,
            created_at=datetime.utcnow() - timedelta(days=days_ago),
        )

    def test_no_signals(self):
        assert compute_score([], {}) == 0.0

    def test_single_signal(self):
        signals = [self._make_signal()]
        score = compute_score(signals, {})
        assert score > 0.0

    def test_more_mentions_higher_score(self):
        few = [self._make_signal() for _ in range(2)]
        many = [self._make_signal() for _ in range(10)]
        score_few = compute_score(few, {})
        score_many = compute_score(many, {})
        assert score_many > score_few

    def test_recency_bonus(self):
        recent = [self._make_signal(days_ago=0)]
        old = [self._make_signal(days_ago=300)]
        score_recent = compute_score(recent, {})
        score_old = compute_score(old, {})
        assert score_recent > score_old

    def test_score_deterministic(self):
        signals = [self._make_signal(), self._make_signal()]
        s1 = compute_score(signals, {})
        s2 = compute_score(signals, {})
        assert s1 == s2


class TestHaversineKm:
    def test_same_point(self):
        assert haversine_km(35.6, 139.7, 35.6, 139.7) == 0.0

    def test_known_distance(self):
        # Tokyo to Yokohama ~ 27km
        dist = haversine_km(35.6762, 139.6503, 35.4437, 139.6380)
        assert 20.0 < dist < 35.0

    def test_symmetry(self):
        d1 = haversine_km(35.6, 139.7, 34.7, 135.5)
        d2 = haversine_km(34.7, 135.5, 35.6, 139.7)
        assert abs(d1 - d2) < 0.001
