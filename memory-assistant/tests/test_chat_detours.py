"""
Tests for chat service POI/detour integration.

Verifies that process_chat correctly:
1. Passes location context to suggest_detours
2. Includes POI data in the LLM prompt
3. Returns detour metadata in the response contract
"""
import pytest
from unittest.mock import MagicMock, patch
from uuid import uuid4
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.schemas import ChatLocationContext


# ---- Lightweight stubs (no SQLAlchemy instrumentation) ----

@dataclass
class FakeMessage:
    id: object
    conversation_id: object
    role: object
    content: str
    created_at: object = None


@dataclass
class FakeDetourSuggestion:
    poi_id: str
    name: str
    lat: float = 40.73
    lng: float = -73.99
    address: Optional[str] = "123 Main St"
    category: Optional[str] = "food"
    adds_minutes: float = 5.0
    corridor_distance_km: float = 0.3
    social_score: float = 4.2
    why_special: str = "Famous for handmade noodles"
    what_to_order: List[str] = field(default_factory=lambda: ["spicy noodles", "dumplings"])
    warnings: List[str] = field(default_factory=list)
    vibe_tags: List[str] = field(default_factory=lambda: ["cozy", "authentic"])
    confidence: float = 0.8
    sources_count: Dict[str, int] = field(default_factory=lambda: {"xhs": 3, "reddit": 1})
    is_open: Optional[bool] = True


class TestFetchDetourCandidates:
    """Test _fetch_detour_candidates helper."""

    def test_returns_empty_when_no_location(self):
        from app.chat.service import _fetch_detour_candidates
        db = MagicMock()
        user_id = uuid4()
        results, reason = _fetch_detour_candidates(db, user_id, None)
        assert results == []
        assert "no location" in reason.lower()

    @patch("app.chat.service.suggest_detours")
    def test_returns_candidates_with_location(self, mock_suggest):
        from app.chat.service import _fetch_detour_candidates

        fake_poi = FakeDetourSuggestion(poi_id="poi-1", name="Xian Famous Foods")
        mock_suggest.return_value = [fake_poi]

        db = MagicMock()
        user_id = uuid4()
        location = ChatLocationContext(
            origin_lat=40.7128, origin_lng=-74.0060,
            dest_lat=40.7580, dest_lng=-73.9855,
            category="food",
        )

        results, reason = _fetch_detour_candidates(db, user_id, location)
        assert len(results) == 1
        assert results[0].name == "Xian Famous Foods"
        assert reason is None

        # Verify suggest_detours was called with correct args
        mock_suggest.assert_called_once()
        call_kwargs = mock_suggest.call_args[1]
        assert call_kwargs["origin_lat"] == 40.7128
        assert call_kwargs["dest_lat"] == 40.7580
        assert call_kwargs["category_filter"] == "food"

    @patch("app.chat.service.suggest_detours")
    def test_returns_empty_reason_when_no_pois(self, mock_suggest):
        from app.chat.service import _fetch_detour_candidates

        mock_suggest.return_value = []

        db = MagicMock()
        user_id = uuid4()
        location = ChatLocationContext(
            origin_lat=40.7128, origin_lng=-74.0060,
            dest_lat=40.7580, dest_lng=-73.9855,
        )

        results, reason = _fetch_detour_candidates(db, user_id, location)
        assert results == []
        assert reason is not None
        assert "no POIs" in reason.lower() or "no pois" in reason.lower()

    @patch("app.chat.service.suggest_detours")
    def test_handles_exception_gracefully(self, mock_suggest):
        from app.chat.service import _fetch_detour_candidates

        mock_suggest.side_effect = Exception("DB connection lost")

        db = MagicMock()
        user_id = uuid4()
        location = ChatLocationContext(
            origin_lat=40.7128, origin_lng=-74.0060,
            dest_lat=40.7580, dest_lng=-73.9855,
        )

        results, reason = _fetch_detour_candidates(db, user_id, location)
        assert results == []
        assert "failed" in reason.lower()


class TestFormatDetourCandidatesForPrompt:
    """Test _format_detour_candidates_for_prompt helper."""

    def test_empty_candidates_returns_empty(self):
        from app.chat.service import _format_detour_candidates_for_prompt
        assert _format_detour_candidates_for_prompt([]) == ""

    def test_formats_candidates_with_names(self):
        from app.chat.service import _format_detour_candidates_for_prompt

        candidates = [
            FakeDetourSuggestion(poi_id="1", name="Joe's Pizza", adds_minutes=3.0,
                                 why_special="Classic NY slice", what_to_order=["cheese slice"]),
            FakeDetourSuggestion(poi_id="2", name="Xi'an Famous Foods", adds_minutes=7.0,
                                 why_special="Hand-pulled noodles", what_to_order=["spicy cumin lamb"]),
        ]
        result = _format_detour_candidates_for_prompt(candidates)

        assert "Joe's Pizza" in result
        assert "Xi'an Famous Foods" in result
        assert "NEARBY PLACES" in result
        assert "Do NOT invent" in result

    def test_limits_to_three_candidates(self):
        from app.chat.service import _format_detour_candidates_for_prompt

        candidates = [
            FakeDetourSuggestion(poi_id=str(i), name=f"Place {i}")
            for i in range(5)
        ]
        result = _format_detour_candidates_for_prompt(candidates)

        # Should only include first 3
        assert "Place 0" in result
        assert "Place 1" in result
        assert "Place 2" in result
        assert "Place 3" not in result
        assert "Place 4" not in result


class TestProcessChatDetourContract:
    """Test that process_chat returns correct detour metadata."""

    @patch("app.chat.service.get_llm_client")
    @patch("app.chat.service.retrieve_hybrid")
    @patch("app.chat.service.evaluate_candidates")
    @patch("app.chat.service.extract_memories")
    @patch("app.chat.service.suggest_detours")
    def test_chat_response_includes_detour_fields(
        self, mock_suggest, mock_extract, mock_gate, mock_retrieve, mock_llm
    ):
        from app.chat.service import process_chat
        from app.models import MessageRole

        # Setup mocks
        mock_extract.return_value = []
        mock_gate.return_value = ([], [])
        mock_retrieve.return_value = []

        fake_poi = FakeDetourSuggestion(poi_id="poi-abc", name="Tatsu Ramen")
        mock_suggest.return_value = [fake_poi]

        # LLM client mock — reply mentions the POI name
        llm_client = MagicMock()
        llm_client.chat.return_value = "I'd suggest stopping at Tatsu Ramen — famous for handmade noodles."
        llm_client.embed.return_value = [0.0] * 768
        mock_llm.return_value = llm_client

        # DB mock
        db = MagicMock()
        msg_mock = MagicMock()
        msg_mock.id = uuid4()
        msg_mock.role = MessageRole.user
        msg_mock.content = "recommend me a food stop"
        msg_mock.created_at = None
        db.execute.return_value.scalars.return_value.all.return_value = [msg_mock]

        user_id = uuid4()
        conv_id = uuid4()
        location = ChatLocationContext(
            origin_lat=40.7128, origin_lng=-74.0060,
            dest_lat=40.7580, dest_lng=-73.9855,
            category="food",
        )

        response = process_chat(
            db=db,
            user_id=user_id,
            conversation_id=conv_id,
            user_message="recommend me a food stop",
            location=location,
        )

        # Verify response contract
        assert response.detour_candidates_returned == 1
        assert "poi-abc" in response.detour_candidates_used
        assert response.detour_reason_if_empty is None
        assert "Tatsu Ramen" in response.reply

    @patch("app.chat.service.get_llm_client")
    @patch("app.chat.service.retrieve_hybrid")
    @patch("app.chat.service.evaluate_candidates")
    @patch("app.chat.service.extract_memories")
    def test_chat_response_without_location(
        self, mock_extract, mock_gate, mock_retrieve, mock_llm
    ):
        from app.chat.service import process_chat
        from app.models import MessageRole

        mock_extract.return_value = []
        mock_gate.return_value = ([], [])
        mock_retrieve.return_value = []

        llm_client = MagicMock()
        llm_client.chat.return_value = "Hello! How can I help?"
        llm_client.embed.return_value = [0.0] * 768
        mock_llm.return_value = llm_client

        db = MagicMock()
        msg_mock = MagicMock()
        msg_mock.id = uuid4()
        msg_mock.role = MessageRole.user
        msg_mock.content = "hello"
        msg_mock.created_at = None
        db.execute.return_value.scalars.return_value.all.return_value = [msg_mock]

        response = process_chat(
            db=db,
            user_id=uuid4(),
            conversation_id=uuid4(),
            user_message="hello",
        )

        assert response.detour_candidates_returned == 0
        assert response.detour_candidates_used == []
        assert "no location" in response.detour_reason_if_empty.lower()
