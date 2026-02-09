"""
LLM-based extraction of place candidates from social post text.
"""
import json
import logging
from typing import Any, Dict, Optional

from app.llm.client import get_llm_client

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """\
You are a place extraction assistant. Given a social media post about travel, food, or local experiences, extract structured information about every place mentioned.

Return JSON with this exact schema:
{
  "candidates": [
    {
      "place_name": "string (the name of the place/restaurant/cafe/bar/shop)",
      "place_aliases": ["alternative names or spellings"],
      "address_hint": "string or null (any address info mentioned)",
      "landmark_hint": "string or null (nearby landmark mentioned)",
      "city_hint": "string or null (city/neighborhood mentioned)",
      "country_hint": "string or null (country mentioned)",
      "category": "food|cafe|bar|dessert|viewpoint|shop|other",
      "vibe_tags": ["cozy", "hidden gem", "touristy", "romantic", etc],
      "what_to_order": ["specific dishes or items mentioned as recommendations"],
      "why_special": "string (why the author recommends this place)",
      "warnings": ["any warnings: long lines, cash only, reservation needed, etc"],
      "best_time_windows": ["weekday lunch", "after 8pm", "weekend brunch", etc],
      "price_level_hint": 1 to 4 or null (1=budget, 4=splurge),
      "confidence": 0.0 to 1.0 (how confident you are this is a real, specific place)
    }
  ]
}

Rules:
- Only extract places that are clearly specific, named locations (not generic references like "a restaurant nearby")
- If the post mentions no specific places, return {"candidates": []}
- Use the original language for place names when possible, and add English translations as aliases
- Set confidence lower (< 0.5) for places only vaguely mentioned
- Set confidence higher (> 0.8) for places that are the main subject of the post
- Extract ALL places mentioned, even if briefly
- Do not invent information not present in the text
"""


def extract_places(raw_text: str, city_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Extract place candidates from social post text using LLM.

    Args:
        raw_text: The raw text content of the social post.
        city_hint: Optional city context to help the LLM.

    Returns:
        Validated extraction dict with "candidates" key.
    """
    if not raw_text or not raw_text.strip():
        return {"candidates": []}

    llm = get_llm_client()

    user_content = f"Social post text:\n\n{raw_text}"
    if city_hint:
        user_content += f"\n\nContext: This post is about {city_hint}."

    messages = [
        {"role": "system", "content": EXTRACTION_PROMPT},
        {"role": "user", "content": user_content},
    ]

    try:
        result = llm.chat_json(messages=messages, temperature=0.2)
    except Exception as e:
        logger.error(f"LLM extraction failed: {e}")
        return {"candidates": []}

    # Validate structure
    return _validate_extraction(result)


def _validate_extraction(data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and clean the extraction result."""
    if not isinstance(data, dict):
        logger.warning(f"Extraction result is not a dict: {type(data)}")
        return {"candidates": []}

    candidates = data.get("candidates", [])
    if not isinstance(candidates, list):
        logger.warning(f"candidates is not a list: {type(candidates)}")
        return {"candidates": []}

    valid_categories = {"food", "cafe", "bar", "dessert", "viewpoint", "shop", "other"}
    cleaned = []

    for c in candidates:
        if not isinstance(c, dict):
            continue
        if not c.get("place_name"):
            continue

        # Normalize category
        cat = c.get("category", "other")
        if cat not in valid_categories:
            cat = "other"

        # Clamp confidence
        conf = c.get("confidence", 0.5)
        try:
            conf = float(conf)
            conf = max(0.0, min(1.0, conf))
        except (ValueError, TypeError):
            conf = 0.5

        # Clamp price_level_hint
        price = c.get("price_level_hint")
        if price is not None:
            try:
                price = int(price)
                if price < 1 or price > 4:
                    price = None
            except (ValueError, TypeError):
                price = None

        cleaned.append({
            "place_name": str(c["place_name"]),
            "place_aliases": _ensure_str_list(c.get("place_aliases", [])),
            "address_hint": c.get("address_hint"),
            "landmark_hint": c.get("landmark_hint"),
            "city_hint": c.get("city_hint"),
            "country_hint": c.get("country_hint"),
            "category": cat,
            "vibe_tags": _ensure_str_list(c.get("vibe_tags", [])),
            "what_to_order": _ensure_str_list(c.get("what_to_order", [])),
            "why_special": c.get("why_special", ""),
            "warnings": _ensure_str_list(c.get("warnings", [])),
            "best_time_windows": _ensure_str_list(c.get("best_time_windows", [])),
            "price_level_hint": price,
            "confidence": conf,
        })

    return {"candidates": cleaned}


def _ensure_str_list(val: Any) -> list:
    """Ensure value is a list of strings."""
    if not isinstance(val, list):
        return []
    return [str(v) for v in val if v is not None]
