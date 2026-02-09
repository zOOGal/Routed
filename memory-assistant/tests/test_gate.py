"""
Unit tests for the write gate logic.
"""
import pytest
from app.memory.gate import should_store, is_duplicate, evaluate_candidates, normalize_text
from app.schemas import MemoryCandidate
from app.models import MemoryType, Sensitivity


class TestNormalizeText:
    def test_lowercase_and_strip(self):
        assert normalize_text("  Hello World  ") == "hello world"

    def test_already_normalized(self):
        assert normalize_text("hello") == "hello"


class TestIsDuplicate:
    def test_exact_duplicate(self):
        candidate = MemoryCandidate(
            type=MemoryType.preference,
            text="Prefers dark mode",
            confidence=0.9,
            sensitivity=Sensitivity.low,
        )
        existing = ["prefers dark mode", "likes coffee"]
        assert is_duplicate(candidate, existing) is True

    def test_case_insensitive_duplicate(self):
        candidate = MemoryCandidate(
            type=MemoryType.preference,
            text="PREFERS DARK MODE",
            confidence=0.9,
            sensitivity=Sensitivity.low,
        )
        existing = ["prefers dark mode"]
        assert is_duplicate(candidate, existing) is True

    def test_not_duplicate(self):
        candidate = MemoryCandidate(
            type=MemoryType.preference,
            text="Prefers light mode",
            confidence=0.9,
            sensitivity=Sensitivity.low,
        )
        existing = ["prefers dark mode"]
        assert is_duplicate(candidate, existing) is False


class TestShouldStore:
    def test_low_sensitivity_high_confidence(self):
        """Low sensitivity with confidence >= 0.75 should be stored."""
        candidate = MemoryCandidate(
            type=MemoryType.preference,
            text="Likes coffee",
            confidence=0.8,
            sensitivity=Sensitivity.low,
        )
        assert should_store(candidate) is True

    def test_low_sensitivity_low_confidence(self):
        """Low sensitivity with confidence < 0.75 should not be stored."""
        candidate = MemoryCandidate(
            type=MemoryType.preference,
            text="Maybe likes tea",
            confidence=0.6,
            sensitivity=Sensitivity.low,
        )
        assert should_store(candidate) is False

    def test_med_sensitivity_high_confidence(self):
        """Medium sensitivity with confidence >= 0.85 should be stored."""
        candidate = MemoryCandidate(
            type=MemoryType.profile,
            text="Works at Acme Corp",
            confidence=0.9,
            sensitivity=Sensitivity.med,
        )
        assert should_store(candidate) is True

    def test_med_sensitivity_medium_confidence(self):
        """Medium sensitivity with confidence < 0.85 should not be stored."""
        candidate = MemoryCandidate(
            type=MemoryType.profile,
            text="Might work at Acme",
            confidence=0.8,
            sensitivity=Sensitivity.med,
        )
        assert should_store(candidate) is False

    def test_high_sensitivity_no_consent(self):
        """High sensitivity without explicit consent should not be stored."""
        candidate = MemoryCandidate(
            type=MemoryType.profile,
            text="Has diabetes",
            confidence=0.95,
            sensitivity=Sensitivity.high,
        )
        assert should_store(candidate) is False

    def test_high_sensitivity_with_consent(self):
        """High sensitivity with explicit consent should be stored."""
        candidate = MemoryCandidate(
            type=MemoryType.profile,
            text="Has diabetes",
            confidence=0.9,
            sensitivity=Sensitivity.high,
            structured_json={"explicit_user_consent": True},
        )
        assert should_store(candidate) is True

    def test_high_sensitivity_with_consent_low_confidence(self):
        """High sensitivity with consent but low confidence should not be stored."""
        candidate = MemoryCandidate(
            type=MemoryType.profile,
            text="Might have condition",
            confidence=0.6,
            sensitivity=Sensitivity.high,
            structured_json={"explicit_user_consent": True},
        )
        assert should_store(candidate) is False


class TestEvaluateCandidates:
    def test_approve_valid_candidates(self):
        candidates = [
            MemoryCandidate(
                type=MemoryType.preference,
                text="Likes morning meetings",
                confidence=0.85,
                sensitivity=Sensitivity.low,
            ),
            MemoryCandidate(
                type=MemoryType.goal,
                text="Wants to learn Python",
                confidence=0.9,
                sensitivity=Sensitivity.low,
            ),
        ]
        approved, rejected = evaluate_candidates(candidates, [])
        assert len(approved) == 2
        assert len(rejected) == 0

    def test_reject_low_confidence(self):
        candidates = [
            MemoryCandidate(
                type=MemoryType.preference,
                text="Maybe likes something",
                confidence=0.5,
                sensitivity=Sensitivity.low,
            ),
        ]
        approved, rejected = evaluate_candidates(candidates, [])
        assert len(approved) == 0
        assert len(rejected) == 1

    def test_reject_duplicates(self):
        candidates = [
            MemoryCandidate(
                type=MemoryType.preference,
                text="Likes coffee",
                confidence=0.9,
                sensitivity=Sensitivity.low,
            ),
        ]
        existing = ["likes coffee"]
        approved, rejected = evaluate_candidates(candidates, existing)
        assert len(approved) == 0
        assert len(rejected) == 1

    def test_dedupe_within_batch(self):
        """Should not add duplicates even within the same batch."""
        candidates = [
            MemoryCandidate(
                type=MemoryType.preference,
                text="Likes coffee",
                confidence=0.9,
                sensitivity=Sensitivity.low,
            ),
            MemoryCandidate(
                type=MemoryType.preference,
                text="likes coffee",  # Same, different case
                confidence=0.85,
                sensitivity=Sensitivity.low,
            ),
        ]
        approved, rejected = evaluate_candidates(candidates, [])
        assert len(approved) == 1
        assert len(rejected) == 1
