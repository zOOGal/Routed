"""
Hybrid memory retrieval: structured + vector search.
"""
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, or_

from app.models import Memory, MemoryType, Sensitivity
from app.llm.client import get_llm_client
from app.utils.time import utc_now, format_date_short
from app.config import get_settings

settings = get_settings()


def normalize_for_dedupe(text: str) -> str:
    """Normalize text for deduplication."""
    return text.lower().strip()


def retrieve_structured(
    db: Session,
    user_id: UUID,
    types: Optional[List[MemoryType]] = None,
    limit: int = 5,
) -> List[Memory]:
    """
    Retrieve memories by structured query (type + recency).

    Args:
        db: Database session
        user_id: User ID
        types: Optional list of memory types to filter
        limit: Maximum memories to return

    Returns:
        List of Memory objects
    """
    query = select(Memory).where(
        Memory.user_id == user_id,
        or_(Memory.expires_at.is_(None), Memory.expires_at > utc_now()),
    )

    if types:
        query = query.where(Memory.type.in_(types))

    # Exclude high sensitivity by default
    query = query.where(Memory.sensitivity != Sensitivity.high)

    # Order by recency and confidence
    query = query.order_by(
        Memory.confidence.desc(),
        Memory.created_at.desc(),
    ).limit(limit)

    return list(db.execute(query).scalars().all())


def retrieve_vector(
    db: Session,
    user_id: UUID,
    query_text: str,
    limit: int = 10,
    exclude_high_sensitivity: bool = True,
) -> List[Memory]:
    """
    Retrieve memories by vector similarity search.

    Args:
        db: Database session
        user_id: User ID
        query_text: Query text to embed and search
        limit: Maximum memories to return
        exclude_high_sensitivity: Whether to exclude high sensitivity memories

    Returns:
        List of Memory objects ordered by similarity
    """
    client = get_llm_client()

    # Generate embedding for query
    query_embedding = client.embed(query_text)

    # Build the query with vector similarity
    query = select(Memory).where(
        Memory.user_id == user_id,
        Memory.embedding.isnot(None),
        or_(Memory.expires_at.is_(None), Memory.expires_at > utc_now()),
    )

    if exclude_high_sensitivity:
        query = query.where(Memory.sensitivity != Sensitivity.high)

    # Order by cosine distance (L2 for pgvector)
    query = query.order_by(
        Memory.embedding.cosine_distance(query_embedding)
    ).limit(limit)

    return list(db.execute(query).scalars().all())


def dedupe_memories(memories: List[Memory]) -> List[Memory]:
    """
    Deduplicate memories by normalized text.

    Args:
        memories: List of memories (may contain duplicates)

    Returns:
        Deduplicated list, keeping first occurrence
    """
    seen: set = set()
    unique: List[Memory] = []

    for memory in memories:
        normalized = normalize_for_dedupe(memory.text)
        if normalized not in seen:
            seen.add(normalized)
            unique.append(memory)

    return unique


def rank_memories(memories: List[Memory]) -> List[Memory]:
    """
    Rank memories by confidence and recency.

    Args:
        memories: List of memories to rank

    Returns:
        Sorted list with highest priority first
    """
    now = utc_now()

    def score(m: Memory) -> float:
        # Base score from confidence
        conf_score = m.confidence * 0.6

        # Recency score (0-0.4 based on age)
        age_days = (now - m.created_at).days
        recency_score = max(0, 0.4 - (age_days * 0.01))

        return conf_score + recency_score

    return sorted(memories, key=score, reverse=True)


def retrieve_hybrid(
    db: Session,
    user_id: UUID,
    query_text: str,
    max_memories: Optional[int] = None,
) -> List[Memory]:
    """
    Hybrid retrieval combining structured and vector search.

    Args:
        db: Database session
        user_id: User ID
        query_text: User's query/message
        max_memories: Maximum memories to return (defaults to config)

    Returns:
        Ranked, deduplicated list of relevant memories
    """
    if max_memories is None:
        max_memories = settings.memory_context_pack_size

    # Structured retrieval: get recent preferences, constraints, goals
    structured_memories = retrieve_structured(
        db=db,
        user_id=user_id,
        types=[MemoryType.preference, MemoryType.constraint, MemoryType.goal],
        limit=5,
    )

    # Vector retrieval: semantic similarity search
    vector_memories = retrieve_vector(
        db=db,
        user_id=user_id,
        query_text=query_text,
        limit=10,
    )

    # Combine, dedupe, and rank
    all_memories = structured_memories + vector_memories
    unique_memories = dedupe_memories(all_memories)
    ranked_memories = rank_memories(unique_memories)

    # Cap to max size
    return ranked_memories[:max_memories]


def sanitize_memory_text(text: str) -> str:
    """
    Sanitize memory text to prevent prompt injection attacks.

    Removes or escapes patterns that could be used to inject instructions
    into the LLM prompt.

    Args:
        text: Raw memory text

    Returns:
        Sanitized text safe for prompt inclusion
    """
    if not text:
        return ""

    # Truncate overly long memories
    max_length = 500
    if len(text) > max_length:
        text = text[:max_length] + "..."

    # Remove common prompt injection patterns
    dangerous_patterns = [
        "ignore previous instructions",
        "ignore above instructions",
        "disregard previous",
        "disregard above",
        "new instructions:",
        "system:",
        "assistant:",
        "user:",
        "[INST]",
        "[/INST]",
        "<<SYS>>",
        "<</SYS>>",
        "```",
    ]

    text_lower = text.lower()
    for pattern in dangerous_patterns:
        if pattern.lower() in text_lower:
            # Replace the dangerous pattern with a sanitized version
            text = text.replace(pattern, "[FILTERED]")
            text = text.replace(pattern.lower(), "[FILTERED]")
            text = text.replace(pattern.upper(), "[FILTERED]")

    # Remove any remaining control characters or unusual whitespace
    text = "".join(char for char in text if char.isprintable() or char in " \n")

    return text.strip()


def format_memory_pack(memories: List[Memory]) -> str:
    """
    Format memories as a bullet list for the LLM prompt.

    Format: [type] text (created_at date)

    Args:
        memories: List of memories to format

    Returns:
        Formatted string for inclusion in prompt
    """
    if not memories:
        return "No relevant memories."

    lines = []
    for m in memories:
        date_str = format_date_short(m.created_at)
        # Sanitize memory text to prevent prompt injection
        safe_text = sanitize_memory_text(m.text)
        lines.append(f"- [{m.type.value}] {safe_text} ({date_str})")

    return "\n".join(lines)
