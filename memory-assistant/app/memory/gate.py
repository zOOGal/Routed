"""
Write gate logic for memory storage decisions.
"""
from app.schemas import MemoryCandidate
from app.models import Sensitivity


def normalize_text(text: str) -> str:
    """Normalize text for duplicate comparison."""
    return text.lower().strip()


def is_duplicate(candidate: MemoryCandidate, existing_texts: list[str]) -> bool:
    """
    Check if a candidate is a duplicate of existing memories.

    Args:
        candidate: The memory candidate to check
        existing_texts: List of existing memory texts

    Returns:
        True if duplicate found
    """
    normalized_candidate = normalize_text(candidate.text)
    for existing in existing_texts:
        if normalize_text(existing) == normalized_candidate:
            return True
    return False


def should_store(candidate: MemoryCandidate) -> bool:
    """
    Determine if a memory candidate should be stored.

    Write gate rules:
    - Store if confidence >= 0.75 AND sensitivity == low
    - Store if confidence >= 0.85 AND sensitivity == med
    - Never auto-store sensitivity == high unless explicit consent

    Args:
        candidate: The memory candidate to evaluate

    Returns:
        True if should be stored
    """
    # Check for explicit user consent in structured_json
    has_explicit_consent = (
        candidate.structured_json is not None
        and candidate.structured_json.get("explicit_user_consent", False)
    )

    if candidate.sensitivity == Sensitivity.high:
        # Only store high sensitivity with explicit consent
        return has_explicit_consent and candidate.confidence >= 0.75

    if candidate.sensitivity == Sensitivity.med:
        # Medium sensitivity requires higher confidence
        return candidate.confidence >= 0.85

    if candidate.sensitivity == Sensitivity.low:
        # Low sensitivity has standard threshold
        return candidate.confidence >= 0.75

    return False


def evaluate_candidates(
    candidates: list[MemoryCandidate],
    existing_texts: list[str],
) -> tuple[list[MemoryCandidate], list[MemoryCandidate]]:
    """
    Evaluate all candidates and split into approved/rejected.

    Args:
        candidates: List of memory candidates
        existing_texts: List of existing memory texts for duplicate check

    Returns:
        Tuple of (approved_candidates, rejected_candidates)
    """
    approved: list[MemoryCandidate] = []
    rejected: list[MemoryCandidate] = []

    for candidate in candidates:
        # Check duplicate first
        if is_duplicate(candidate, existing_texts):
            rejected.append(candidate)
            continue

        # Apply write gate
        if should_store(candidate):
            approved.append(candidate)
            # Add to existing texts to prevent duplicates within batch
            existing_texts.append(candidate.text)
        else:
            rejected.append(candidate)

    return approved, rejected
