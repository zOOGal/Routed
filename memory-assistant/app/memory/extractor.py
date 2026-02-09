"""
Memory candidate extraction from conversation messages.
"""
import logging
from typing import Dict, List, Optional

from app.llm.client import get_llm_client
from app.schemas import MemoryCandidate, MemoryCandidateList
from app.models import MemoryType, Sensitivity

logger = logging.getLogger(__name__)

EXTRACTION_SYSTEM_PROMPT = """You are a memory extraction system. Your job is to identify durable, future-useful information from user messages that should be remembered for personalization.

RULES:
1. Only extract information that would be useful in FUTURE conversations
2. Extract preferences, personal profile info, constraints, goals, and notable episodes
3. Do NOT extract:
   - Transient information (what they're doing right now, unless it's a recurring pattern)
   - Sensitive information (health, finances, relationships) unless user explicitly asks you to remember it
   - Information that's only relevant to the current conversation
4. Keep text SHORT and SPECIFIC - one clear fact per memory
5. Assign confidence based on how certain the information is:
   - 0.9+ : User stated directly and clearly
   - 0.75-0.9 : User implied strongly
   - 0.5-0.75 : Reasonable inference but uncertain
   - Below 0.5 : Don't include
6. Assign sensitivity:
   - "low" : General preferences, public info
   - "med" : Personal but not sensitive (work details, habits)
   - "high" : Sensitive info (health, finances, relationships) - only if user explicitly asked to remember
7. Set expires_in_days for time-bound goals or temporary constraints
8. Avoid duplicating information that seems like a restatement

MEMORY TYPES:
- "preference": User likes/dislikes, style preferences, how they want things done
- "profile": Facts about the user (job, location, family, skills)
- "constraint": Limitations, restrictions, things to avoid
- "goal": Things user is working toward or wants to achieve
- "episode": Notable past events or experiences worth remembering

OUTPUT FORMAT (strict JSON, no markdown):
{
  "candidates": [
    {
      "type": "preference|profile|constraint|goal|episode",
      "text": "Short, specific memory text",
      "structured_json": {"key": "value"} or null,
      "confidence": 0.0-1.0,
      "sensitivity": "low|med|high",
      "expires_in_days": null or integer
    }
  ]
}

If no memories should be extracted, return: {"candidates": []}"""


def extract_memories(
    messages: List[Dict[str, str]],
    existing_memories: Optional[List[str]] = None,
) -> List[MemoryCandidate]:
    """
    Extract memory candidates from recent conversation messages.

    Args:
        messages: Recent messages (at least the latest user message)
        existing_memories: Optional list of existing memory texts to avoid duplicates

    Returns:
        List of memory candidates
    """
    client = get_llm_client()

    # Build context about existing memories to avoid duplicates
    existing_context = ""
    if existing_memories:
        existing_context = f"\n\nEXISTING MEMORIES (avoid duplicating these):\n" + "\n".join(
            f"- {m}" for m in existing_memories[:20]
        )

    # Format recent messages for the prompt
    messages_text = "\n".join(
        f"{m['role'].upper()}: {m['content']}"
        for m in messages
    )

    user_prompt = f"""Analyze these recent messages and extract memory candidates:

{messages_text}{existing_context}

Extract any durable, future-useful information following the rules above. Return strict JSON."""

    try:
        response = client.chat_json(
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )

        # Parse and validate
        candidate_list = MemoryCandidateList(**response)
        return candidate_list.candidates

    except Exception as e:
        logger.error(f"Memory extraction failed: {e}")
        return []


def extract_from_feedback(
    user_message: str,
    assistant_message: str,
    feedback_comment: Optional[str],
) -> Optional[MemoryCandidate]:
    """
    Extract an episode memory from negative feedback.

    Args:
        user_message: The user's original message
        assistant_message: The assistant's response that received negative feedback
        feedback_comment: Optional comment explaining what was wrong

    Returns:
        Episode memory candidate or None
    """
    client = get_llm_client()

    prompt = f"""A user gave negative feedback on this exchange. Extract a brief episode memory about what went wrong that can help avoid similar issues in the future.

USER MESSAGE: {user_message}

ASSISTANT RESPONSE: {assistant_message}

FEEDBACK COMMENT: {feedback_comment or "No comment provided"}

Create a single episode memory capturing what the user didn't like. Be specific but brief.
Return JSON with a single candidate of type "episode", or empty candidates if unclear what went wrong.

{{"candidates": [...]}}"""

    try:
        response = client.chat_json(
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )

        candidate_list = MemoryCandidateList(**response)
        if candidate_list.candidates:
            # Return first candidate, ensure it's an episode
            candidate = candidate_list.candidates[0]
            candidate.type = MemoryType.episode
            candidate.sensitivity = Sensitivity.low
            return candidate
        return None

    except Exception as e:
        logger.error(f"Feedback memory extraction failed: {e}")
        return None
