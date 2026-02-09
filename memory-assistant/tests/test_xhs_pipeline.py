"""
Integration test for XHS social-post -> extraction -> canonicalization -> detour pipeline.

Mocks the LLM extractor, Google Places client, and DB session so the test runs
without external API keys or a PostgreSQL database. Verifies data flows
through all stages and the correct objects are created at each step.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from unittest.mock import patch, MagicMock, PropertyMock, call

import pytest

from app.models import (
    SocialPost, SocialExtraction, POI, POISignal, POIAggregate,
    SocialSource, POIProvider,
)
from app.places.client import PlaceCandidate
from app.social.service import ingest_post, run_extraction
from app.places.canonicalize import canonicalize_post
from app.detours.ranker import suggest_detours, DetourSuggestion


# ---------- Constants ----------

# In-corridor coordinates: Tokyo area
ORIGIN = (35.6812, 139.7671)   # Tokyo Station
DEST = (35.6580, 139.7016)     # Shibuya
POI_COORDS = (35.6700, 139.7350)  # Near corridor midpoint

FAKE_PLACE_ID = "ChIJ_fake_xhs_ramen_001"
FAKE_POST_ID = uuid.uuid4()
FAKE_POI_ID = uuid.uuid4()

XHS_RAW_TEXT = (
    "Tokyo hidden gem! Fuunji Tsukemen in Yoyogi is insane. "
    "The rich pork broth with thick noodles is perfection. "
    "Get there before 11am to avoid the 30 min queue. "
    "Must order: tsukemen with extra noodles. "
    "Definitely the best tsukemen in Tokyo. "
    "Located near Shinjuku station south exit. "
    "Price is around 1000 yen which is super reasonable."
)

FAKE_EXTRACTION_JSON = {
    "candidates": [
        {
            "place_name": "Fuunji Tsukemen",
            "place_aliases": [],
            "address_hint": "Yoyogi, Shibuya",
            "landmark_hint": None,
            "city_hint": "Tokyo",
            "country_hint": "Japan",
            "category": "food",
            "vibe_tags": ["hidden gem", "queue worth it"],
            "what_to_order": ["tsukemen", "extra noodles"],
            "why_special": "Best tsukemen in Tokyo, locals line up daily",
            "warnings": ["30 min queue at lunch"],
            "best_time_windows": ["weekday 11am"],
            "price_level_hint": 2,
            "confidence": 0.92,
        }
    ]
}

FAKE_PLACE_CANDIDATE = PlaceCandidate(
    place_id=FAKE_PLACE_ID,
    name="Fuunji",
    lat=POI_COORDS[0],
    lng=POI_COORDS[1],
    address="2-14-3 Yoyogi, Shibuya City, Tokyo",
    types=["restaurant", "food", "point_of_interest"],
    rating=4.3,
    user_ratings_total=5200,
    price_level=2,
)


# ---------- Helper: Tracked mock DB session ----------

class TrackedMockSession:
    """
    A mock DB session that tracks added objects and supports
    get/execute lookups against them. Allows verifying the full pipeline
    without a real database.
    """

    def __init__(self):
        self._objects = []  # type: List[Any]
        self._committed = False

    def add(self, obj):
        # Assign a UUID id if not set
        if hasattr(obj, "id") and obj.id is None:
            obj.id = uuid.uuid4()
        if hasattr(obj, "created_at") and obj.created_at is None:
            obj.created_at = datetime.utcnow()
        self._objects.append(obj)

    def flush(self):
        # Ensure all objects have IDs
        for obj in self._objects:
            if hasattr(obj, "id") and obj.id is None:
                obj.id = uuid.uuid4()

    def commit(self):
        self._committed = True

    def rollback(self):
        pass

    def refresh(self, obj):
        pass

    def get(self, model_class, pk):
        for obj in self._objects:
            if not isinstance(obj, model_class):
                continue
            # POIAggregate uses poi_id as primary key, not id
            if model_class is POIAggregate:
                if obj.poi_id == pk:
                    return obj
            elif hasattr(obj, "id") and obj.id == pk:
                return obj
        return None

    def execute(self, stmt):
        """
        Minimal execute() that returns a mock result object.
        Supports basic select() patterns used by the pipeline.
        """
        result = MagicMock()
        # Try to determine what's being queried from the compiled statement
        stmt_str = str(stmt)

        if "social_extractions" in stmt_str:
            # Return extractions matching the query
            extractions = [o for o in self._objects if isinstance(o, SocialExtraction)]
            if extractions:
                result.scalar_one_or_none.return_value = extractions[-1]
            else:
                result.scalar_one_or_none.return_value = None

        elif "poi_signals" in stmt_str and "pois" in stmt_str:
            # Join query: POISignal + POI — used by suggest_detours
            signals = [o for o in self._objects if isinstance(o, POISignal)]
            pois = {o.id: o for o in self._objects if isinstance(o, POI)}
            rows = []
            for s in signals:
                poi = pois.get(s.poi_id)
                if poi:
                    rows.append((s, poi))
            result.all.return_value = rows
            result.scalars.return_value.all.return_value = signals

        elif "poi_signals" in stmt_str:
            # Standalone POISignal query — used by _update_aggregate
            signals = [o for o in self._objects if isinstance(o, POISignal)]
            result.scalars.return_value.all.return_value = signals
            result.all.return_value = signals

        elif "pois" in stmt_str and "poi_aggregates" in stmt_str:
            # Join query: POI + POIAggregate — used by suggest_detours bounding box
            pois = [o for o in self._objects if isinstance(o, POI)]
            aggs = {o.poi_id: o for o in self._objects if isinstance(o, POIAggregate)}
            rows = []
            for p in pois:
                agg = aggs.get(p.id)
                rows.append((p, agg))
            result.all.return_value = rows

        elif "pois" in stmt_str:
            # POI lookup by provider + place_id
            pois = [o for o in self._objects if isinstance(o, POI)]
            if pois:
                result.scalar_one_or_none.return_value = pois[0]
            else:
                result.scalar_one_or_none.return_value = None

        else:
            result.scalar_one_or_none.return_value = None
            result.scalars.return_value.all.return_value = []
            result.all.return_value = []

        return result

    def get_added_objects(self, model_class):
        """Get all tracked objects of a given type."""
        return [o for o in self._objects if isinstance(o, model_class)]


# ---------- Tests ----------

class TestXhsPipeline:
    """End-to-end pipeline: ingest -> extract -> canonicalize -> detour suggest."""

    def test_full_pipeline(self):
        """
        Insert XHS post, mock extractor and Places client,
        run canonicalize, verify POI + signal created,
        then call detour suggest and verify results.
        """
        db = TrackedMockSession()

        # Step 1: Ingest an XHS post
        result = ingest_post(
            db=db,
            source=SocialSource.xhs,
            url="https://www.xiaohongshu.com/explore/abc123",
            raw_text=XHS_RAW_TEXT,
        )
        db.flush()

        post = result["post"]
        assert isinstance(post, SocialPost)
        assert post.source == SocialSource.xhs
        assert result["status"] == "stored"
        assert post.id is not None
        post_id = post.id

        # Step 2: Extract (mock the LLM)
        with patch("app.social.service.extract_places", return_value=FAKE_EXTRACTION_JSON):
            ext_result = run_extraction(db=db, post_id=post_id, city_hint="Tokyo")
        db.flush()

        extraction = ext_result["extraction"]
        assert isinstance(extraction, SocialExtraction)
        assert extraction.social_post_id == post_id
        candidates = ext_result["extracted_json"]["candidates"]
        assert len(candidates) == 1
        assert candidates[0]["place_name"] == "Fuunji Tsukemen"
        assert candidates[0]["confidence"] == 0.92

        # Step 3: Canonicalize (mock Places client)
        # First call: looking up existing POI by provider+place_id (none exists yet)
        # We need to handle this: canonicalize_post does select(POI).where(provider==, place_id==)
        # Our TrackedMockSession will return None on first POI lookup, then after add() the POI exists

        # Override execute to handle the "POI lookup by provider_place_id" returning None
        original_execute = db.execute

        call_count = [0]

        def patched_execute(stmt):
            stmt_str = str(stmt)
            call_count[0] += 1
            # The first POI select (looking for existing) should return None
            if "pois" in stmt_str and "poi_aggregates" not in stmt_str:
                pois = db.get_added_objects(POI)
                result = MagicMock()
                if "poiprovider" in stmt_str.lower() or "provider_place_id" in stmt_str:
                    # Looking for existing POI by provider+place_id — return None first time
                    result.scalar_one_or_none.return_value = None
                elif pois:
                    result.scalar_one_or_none.return_value = pois[0]
                else:
                    result.scalar_one_or_none.return_value = None
                return result
            return original_execute(stmt)

        db.execute = patched_execute

        mock_client = MagicMock()
        mock_client.search_text.return_value = [FAKE_PLACE_CANDIDATE]

        with patch("app.places.canonicalize.get_places_client", return_value=mock_client):
            canon_result = canonicalize_post(db=db, social_post_id=post_id)

        # Assertions on canonicalization output
        assert "error" not in canon_result
        linked = canon_result["created_or_linked_pois"]
        unmatched = canon_result["unmatched_candidates"]
        assert len(linked) == 1, f"Expected 1 linked POI, got {len(linked)}: {unmatched}"
        assert len(unmatched) == 0
        assert linked[0]["provider_place_id"] == FAKE_PLACE_ID
        assert linked[0]["match_confidence"] > 0.5

        # Step 4: Verify objects were created
        pois = db.get_added_objects(POI)
        assert len(pois) == 1, "Expected 1 POI to be created"
        assert pois[0].name == "Fuunji"
        assert pois[0].provider == POIProvider.google
        assert pois[0].provider_place_id == FAKE_PLACE_ID

        signals = db.get_added_objects(POISignal)
        xhs_signals = [s for s in signals if s.source == SocialSource.xhs]
        assert len(xhs_signals) == 1, "Expected 1 XHS POI signal"
        assert xhs_signals[0].confidence == 0.92
        sj = xhs_signals[0].signal_json
        assert "tsukemen" in sj.get("what_to_order", [])

        aggregates = db.get_added_objects(POIAggregate)
        assert len(aggregates) == 1, "Expected 1 POI aggregate"

        # Step 5: Detour suggest near the corridor
        # Restore normal execute for detour queries
        db.execute = original_execute

        with patch("app.detours.ranker.retrieve_hybrid", return_value=[]):
            suggestions = suggest_detours(
                db=db,
                user_id=None,
                origin_lat=ORIGIN[0],
                origin_lng=ORIGIN[1],
                dest_lat=DEST[0],
                dest_lng=DEST[1],
                max_detour_minutes=15.0,
                category_filter="food",
                max_results=5,
            )

        assert len(suggestions) >= 1, "Expected at least 1 detour suggestion"
        top = suggestions[0]
        assert top.name == "Fuunji"
        assert top.adds_minutes >= 0  # POI near corridor midpoint → near-zero detour
        assert "tsukemen" in top.what_to_order

    def test_extraction_no_candidates(self):
        """When LLM returns no candidates, canonicalize handles it gracefully."""
        db = TrackedMockSession()

        result = ingest_post(
            db=db,
            source=SocialSource.xhs,
            raw_text="Just a photo of my coffee, no place mentioned at all.",
        )
        db.flush()
        post_id = result["post"].id

        empty_extraction = {"candidates": []}
        with patch("app.social.service.extract_places", return_value=empty_extraction):
            ext_result = run_extraction(db=db, post_id=post_id)
        db.flush()

        assert len(ext_result["extracted_json"]["candidates"]) == 0

        mock_client = MagicMock()
        with patch("app.places.canonicalize.get_places_client", return_value=mock_client):
            canon_result = canonicalize_post(db=db, social_post_id=post_id)

        assert len(canon_result["created_or_linked_pois"]) == 0
        assert len(canon_result["unmatched_candidates"]) == 0
        # Places client should never be called with 0 candidates
        mock_client.search_text.assert_not_called()

    def test_canonicalize_below_threshold(self):
        """When Places result name is too different, candidate stays unmatched."""
        db = TrackedMockSession()

        result = ingest_post(
            db=db,
            source=SocialSource.xhs,
            raw_text="Check out the amazing sushi at Mystery Sushi Bar in Tokyo!",
        )
        db.flush()
        post_id = result["post"].id

        extraction_json = {
            "candidates": [
                {
                    "place_name": "Mystery Sushi Bar",
                    "category": "food",
                    "city_hint": "Tokyo",
                    "confidence": 0.6,
                }
            ]
        }
        with patch("app.social.service.extract_places", return_value=extraction_json):
            run_extraction(db=db, post_id=post_id)
        db.flush()

        # Return a completely different place name AND wrong category → low score
        bad_match = PlaceCandidate(
            place_id="ChIJ_totally_different",
            name="Zxy Qwv Municipal Parking Garage",
            lat=35.67,
            lng=139.73,
            types=["parking", "establishment"],
        )
        mock_client = MagicMock()
        mock_client.search_text.return_value = [bad_match]

        with patch("app.places.canonicalize.get_places_client", return_value=mock_client):
            canon_result = canonicalize_post(db=db, social_post_id=post_id)

        assert len(canon_result["created_or_linked_pois"]) == 0
        assert len(canon_result["unmatched_candidates"]) == 1
        assert canon_result["unmatched_candidates"][0]["reason"] == "below_threshold"

        # No POIs or signals should have been created
        assert len(db.get_added_objects(POI)) == 0
        assert len(db.get_added_objects(POISignal)) == 0
