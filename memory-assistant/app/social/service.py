"""
Social post ingestion service — reusable business logic.

Called by both API routes and batch CLI scripts.
"""
import logging
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import SocialPost, SocialExtraction, SocialSource
from app.social.fetchers.reddit import RedditFetcher
from app.social.fetchers.link_only import LinkOnlyFetcher
from app.social.extractor import extract_places

logger = logging.getLogger(__name__)

# Shared fetcher instances
_reddit_fetcher = RedditFetcher()
_link_fetchers = {
    SocialSource.xhs: LinkOnlyFetcher("xhs"),
    SocialSource.tiktok: LinkOnlyFetcher("tiktok"),
    SocialSource.instagram: LinkOnlyFetcher("instagram"),
}


def ingest_post(
    db: Session,
    source: SocialSource,
    url: Optional[str] = None,
    raw_text: Optional[str] = None,
    author: Optional[str] = None,
    posted_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Ingest a social post into the database.

    Returns:
        Dict with "post" (SocialPost ORM object) and "status" string.

    Raises:
        ValueError: If manual source has no raw_text.
    """
    text = raw_text or ""
    raw_json = None
    external_id = None
    fetched_author = author
    fetched_posted_at = posted_at
    status = "stored"

    if source == SocialSource.reddit and url:
        try:
            result = _reddit_fetcher.fetch(url)
            text = result.raw_text or text
            raw_json = result.raw_json
            external_id = result.external_id
            fetched_author = fetched_author or result.author
            if result.posted_at and not fetched_posted_at:
                fetched_posted_at = datetime.fromisoformat(result.posted_at)
        except Exception as e:
            logger.error(f"Reddit fetch failed: {e}")
            if not text:
                status = "fetch_failed"

    elif source in (SocialSource.xhs, SocialSource.tiktok, SocialSource.instagram):
        if url:
            fetcher = _link_fetchers[source]
            result = fetcher.fetch(url)
            raw_json = result.raw_json
        if not text:
            status = "needs_text"

    elif source == SocialSource.manual:
        if not text:
            raise ValueError("raw_text is required for manual source")

    post = SocialPost(
        source=source,
        url=url,
        external_id=external_id,
        raw_text=text,
        raw_json=raw_json,
        author=fetched_author,
        posted_at=fetched_posted_at,
    )
    db.add(post)
    db.flush()  # get id without committing

    logger.info(
        "social.ingest_post",
        extra={
            "post_id": str(post.id),
            "source": source.value,
            "status": status,
            "raw_text_len": len(text),
            "has_url": url is not None,
        },
    )

    return {"post": post, "status": status}


def run_extraction(
    db: Session,
    post_id: UUID,
    city_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run LLM extraction on a social post and store the result.

    Returns:
        Dict with "extraction" (SocialExtraction ORM object) and "extracted_json".

    Raises:
        ValueError: If post not found or has no text.
    """
    post = db.get(SocialPost, post_id)
    if not post:
        raise ValueError(f"Social post {post_id} not found")

    if not post.raw_text or not post.raw_text.strip():
        raise ValueError(f"Post {post_id} has no raw_text")

    extracted_json = extract_places(post.raw_text, city_hint=city_hint)

    candidates = extracted_json.get("candidates", [])
    if candidates:
        avg_confidence = sum(c.get("confidence", 0) for c in candidates) / len(candidates)
    else:
        avg_confidence = 0.0

    extraction = SocialExtraction(
        social_post_id=post_id,
        extracted_json=extracted_json,
        confidence=avg_confidence,
    )
    db.add(extraction)
    db.flush()

    logger.info(
        "social.run_extraction",
        extra={
            "post_id": str(post_id),
            "extraction_id": str(extraction.id),
            "candidate_count": len(candidates),
            "avg_confidence": round(avg_confidence, 3),
            "reason_if_empty": "no candidates extracted by LLM" if not candidates else None,
        },
    )

    return {"extraction": extraction, "extracted_json": extracted_json}
