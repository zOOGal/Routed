"""
Chat service: orchestrates message storage, memory extraction, retrieval, and response generation.
"""
import logging
from typing import Dict, List, Optional
from uuid import UUID
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models import (
    User, Conversation, Message, Memory,
    MessageRole, MemoryType, Sensitivity,
    POI, POIAggregate, POISignal, SocialPost, SocialExtraction,
)
from app.schemas import MemoryCandidate, ChatResponse, ChatLocationContext
from app.llm.client import get_llm_client
from app.memory.extractor import extract_memories, extract_from_feedback
from app.memory.gate import evaluate_candidates
from app.memory.retrieval import retrieve_hybrid, format_memory_pack
from app.detours.ranker import suggest_detours
from app.utils.time import utc_now, days_from_now

logger = logging.getLogger(__name__)

CHAT_SYSTEM_PROMPT = """You are a helpful, personalized assistant for a navigation app. You have access to memories about this user and nearby place data from real social-media sources.

MEMORY USAGE POLICY:
- Use memories only when relevant to the current conversation
- If a memory conflicts with what the user is saying now, ask a question rather than assume
- Never reveal internal IDs, storage details, or that you have a "memory system"
- When using remembered information, reference it naturally (e.g., "Since you prefer...")
- Treat memories as context, not constraints - the user can always change their mind

PLACE/RESTAURANT POLICY:
- If NEARBY PLACES are provided in the context, you MUST recommend 1-2 by name
- You are NOT allowed to invent or hallucinate restaurants, cafes, or places
- Only mention places that appear in the provided data
- If no place data is provided, do NOT make up restaurant suggestions
- If asked about food/places but no data is available, say "I don't have curated stops for this area yet"

TONE: Calm, practical, concise. This is a navigation product, not a travel blog."""

CHAT_DEVELOPER_PROMPT = """You are responding to a user message. Below are relevant memories about this user.

USER MEMORIES:
{memory_pack}

Use these memories to personalize your response when relevant. Remember:
1. Don't explicitly list or enumerate memories
2. Integrate knowledge naturally into your response
3. If memories seem outdated or contradict current message, prioritize current message
4. Keep responses concise and helpful"""


def get_recent_messages(
    db: Session,
    conversation_id: UUID,
    limit: int = 6,
) -> List[Message]:
    """Get recent messages from a conversation."""
    query = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages = list(db.execute(query).scalars().all())
    return list(reversed(messages))


def get_existing_memory_texts(db: Session, user_id: UUID) -> List[str]:
    """Get existing memory texts for duplicate detection."""
    query = select(Memory.text).where(Memory.user_id == user_id)
    return [row[0] for row in db.execute(query).all()]


def store_memory(
    db: Session,
    user_id: UUID,
    candidate: MemoryCandidate,
    conversation_id: Optional[UUID] = None,
    message_id: Optional[UUID] = None,
) -> Memory:
    """Store a memory candidate in the database with embedding."""
    client = get_llm_client()

    # Generate embedding
    embedding = client.embed(candidate.text)

    # Calculate expiration
    expires_at = None
    if candidate.expires_in_days is not None:
        expires_at = days_from_now(candidate.expires_in_days)

    memory = Memory(
        user_id=user_id,
        type=candidate.type,
        text=candidate.text,
        structured_json=candidate.structured_json,
        confidence=candidate.confidence,
        sensitivity=candidate.sensitivity,
        expires_at=expires_at,
        source_conversation_id=conversation_id,
        source_message_id=message_id,
        embedding=embedding,
    )

    db.add(memory)
    db.flush()  # Get the ID

    return memory


def _log_poi_counts(db: Session) -> None:
    """Debug: log POI knowledge-base counts."""
    try:
        from sqlalchemy import func
        poi_count = db.query(func.count(POI.id)).scalar() or 0
        agg_count = db.query(func.count(POIAggregate.poi_id)).scalar() or 0
        sig_count = db.query(func.count(POISignal.id)).scalar() or 0
        post_count = db.query(func.count(SocialPost.id)).scalar() or 0
        ext_count = db.query(func.count(SocialExtraction.id)).scalar() or 0
        logger.info(
            "[poi-debug] KB counts — pois=%d, aggregates=%d, signals=%d, posts=%d, extractions=%d",
            poi_count, agg_count, sig_count, post_count, ext_count,
        )
    except Exception as e:
        logger.warning("[poi-debug] Failed to query counts: %s", e)


def _fetch_detour_candidates(
    db: Session,
    user_id: UUID,
    location: Optional[ChatLocationContext],
) -> tuple:
    """Fetch detour candidates if location context is provided.

    Returns:
        (candidates_list, detour_reason_if_empty)
    """
    if location is None:
        return [], "no location context provided"

    try:
        results = suggest_detours(
            db=db,
            user_id=user_id,
            origin_lat=location.origin_lat,
            origin_lng=location.origin_lng,
            dest_lat=location.dest_lat,
            dest_lng=location.dest_lng,
            category_filter=location.category or "food",
            max_detour_minutes=15.0,
            max_results=5,
        )
        if not results:
            _log_poi_counts(db)
            return [], "no POIs found in corridor for this area"
        logger.info("[chat] Found %d detour candidates", len(results))
        return results, None
    except Exception as e:
        logger.error("[chat] Detour fetch failed: %s", e)
        return [], "detour query failed: %s" % str(e)


def _format_detour_candidates_for_prompt(candidates: list) -> str:
    """Format detour candidates as structured text for the LLM prompt."""
    if not candidates:
        return ""

    lines = ["\nNEARBY PLACES (from real social-media data — you MUST recommend 1-2 by name):"]
    for c in candidates[:3]:
        order_tip = ", ".join(c.what_to_order[:2]) if c.what_to_order else "n/a"
        lines.append(
            "- %s | +%d min detour | why: %s | try: %s | sources: %s"
            % (c.name, int(c.adds_minutes), c.why_special[:80], order_tip, c.sources_count)
        )
    lines.append(
        "\nRULE: Reference at least one of the above by name. "
        "Do NOT invent other restaurants. If none fit, say 'I don't have curated food stops for this area yet.'"
    )
    return "\n".join(lines)


def process_chat(
    db: Session,
    user_id: UUID,
    conversation_id: UUID,
    user_message: str,
    location: Optional[ChatLocationContext] = None,
) -> ChatResponse:
    """
    Process a chat message through the full pipeline.

    Steps:
    1. Store user message
    2. Extract memory candidates
    3. Apply write gate and store approved memories
    4. Retrieve relevant memories
    5. Fetch detour candidates if location provided
    6. Generate response with memory + POI context
    7. Store assistant message
    8. Return response with metadata + debug contract
    """
    client = get_llm_client()

    # 1. Store user message
    msg = Message(
        conversation_id=conversation_id,
        role=MessageRole.user,
        content=user_message,
    )
    db.add(msg)
    db.flush()

    user_message_id = msg.id

    # 2. Get recent messages for context
    recent_messages = get_recent_messages(db, conversation_id, limit=6)
    messages_for_extraction = [
        {"role": m.role.value, "content": m.content}
        for m in recent_messages
    ]

    # 3. Extract memory candidates
    existing_texts = get_existing_memory_texts(db, user_id)
    candidates = extract_memories(messages_for_extraction, existing_texts)

    # 4. Apply write gate
    approved, _ = evaluate_candidates(candidates, existing_texts)

    # 5. Store approved memories
    stored_memory_ids: List[UUID] = []
    for candidate in approved:
        try:
            memory = store_memory(
                db=db,
                user_id=user_id,
                candidate=candidate,
                conversation_id=conversation_id,
                message_id=user_message_id,
            )
            stored_memory_ids.append(memory.id)
        except Exception as e:
            logger.error(f"Failed to store memory: {e}")

    # 6. Retrieve relevant memories
    relevant_memories = retrieve_hybrid(db, user_id, user_message)
    used_memory_ids = [m.id for m in relevant_memories]

    # 7. Fetch detour candidates
    detour_candidates, detour_reason = _fetch_detour_candidates(db, user_id, location)
    detour_prompt_section = _format_detour_candidates_for_prompt(detour_candidates)

    # 8. Build prompt with memory context + POI data
    memory_pack = format_memory_pack(relevant_memories)
    developer_prompt = CHAT_DEVELOPER_PROMPT.format(memory_pack=memory_pack)
    if detour_prompt_section:
        developer_prompt += "\n" + detour_prompt_section

    # Build message history for LLM
    llm_messages = [
        {"role": "system", "content": CHAT_SYSTEM_PROMPT},
        {"role": "system", "content": developer_prompt},
    ]

    # Add conversation history (last few turns)
    for m in recent_messages:
        llm_messages.append({
            "role": m.role.value,
            "content": m.content,
        })

    # 9. Generate response
    try:
        reply = client.chat(
            messages=llm_messages,
            temperature=0.7,
            max_tokens=1500,
        )
    except Exception as e:
        logger.error(f"LLM generation failed: {e}")
        reply = "I apologize, but I'm having trouble generating a response right now. Please try again."

    # 10. Check which POIs the LLM actually referenced
    used_poi_ids = []  # type: List[str]
    for c in detour_candidates:
        if c.name.lower() in reply.lower():
            used_poi_ids.append(c.poi_id)

    # 11. Store assistant message
    assistant_msg = Message(
        conversation_id=conversation_id,
        role=MessageRole.assistant,
        content=reply,
    )
    db.add(assistant_msg)
    db.flush()

    return ChatResponse(
        reply=reply,
        used_memories=used_memory_ids,
        stored_memories=stored_memory_ids,
        detour_candidates_returned=len(detour_candidates),
        detour_candidates_used=used_poi_ids,
        detour_reason_if_empty=detour_reason,
    )


def process_negative_feedback(
    db: Session,
    user_id: UUID,
    conversation_id: UUID,
    message_id: Optional[UUID],
    comment: Optional[str],
) -> Optional[UUID]:
    """
    Process negative feedback and optionally create an episode memory.

    Args:
        db: Database session
        user_id: User ID
        conversation_id: Conversation ID
        message_id: Optional message ID that received feedback
        comment: Optional feedback comment

    Returns:
        Memory ID if episode was created, else None
    """
    # Get the relevant messages
    if message_id:
        assistant_msg = db.get(Message, message_id)
        if not assistant_msg or assistant_msg.role != MessageRole.assistant:
            return None

        # Get the user message before it
        user_msgs = (
            db.execute(
                select(Message)
                .where(
                    Message.conversation_id == conversation_id,
                    Message.role == MessageRole.user,
                    Message.created_at < assistant_msg.created_at,
                )
                .order_by(Message.created_at.desc())
                .limit(1)
            )
            .scalars()
            .first()
        )

        if not user_msgs:
            return None

        # Extract episode from feedback
        candidate = extract_from_feedback(
            user_message=user_msgs.content,
            assistant_message=assistant_msg.content,
            feedback_comment=comment,
        )

        if candidate:
            # Check write gate
            existing_texts = get_existing_memory_texts(db, user_id)
            approved, _ = evaluate_candidates([candidate], existing_texts)

            if approved:
                memory = store_memory(
                    db=db,
                    user_id=user_id,
                    candidate=approved[0],
                    conversation_id=conversation_id,
                    message_id=message_id,
                )
                return memory.id

    return None
