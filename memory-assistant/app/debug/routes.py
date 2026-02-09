"""
Debug endpoint for pipeline health diagnostics.

Returns counts and small samples from each stage of the social → POI pipeline
so operators can identify where XHS (or other source) data stops flowing.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.db import get_db
from app.models import (
    SocialPost, SocialExtraction, POI, POISignal, POIAggregate,
    SocialSource,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/debug", tags=["debug"])


@router.get("/pipeline_health")
def pipeline_health(
    db: Session = Depends(get_db),
    source_filter: Optional[str] = Query(None, description="Filter by source, e.g. 'xhs'"),
):
    """
    Return counts and small samples from every stage of the
    social-post → extraction → POI → signal → aggregate pipeline.

    Use this to diagnose where data stops flowing.
    """

    # ---- Counts ----

    social_posts_total = db.execute(
        select(func.count(SocialPost.id))
    ).scalar() or 0

    social_posts_xhs = db.execute(
        select(func.count(SocialPost.id)).where(SocialPost.source == SocialSource.xhs)
    ).scalar() or 0

    # XHS posts with meaningful text (>= 200 chars)
    social_posts_xhs_with_text = db.execute(
        select(func.count(SocialPost.id)).where(
            SocialPost.source == SocialSource.xhs,
            func.length(SocialPost.raw_text) >= 200,
        )
    ).scalar() or 0

    social_extractions_total = db.execute(
        select(func.count(SocialExtraction.id))
    ).scalar() or 0

    # XHS extractions via join
    social_extractions_xhs = db.execute(
        select(func.count(SocialExtraction.id)).where(
            SocialExtraction.social_post_id.in_(
                select(SocialPost.id).where(SocialPost.source == SocialSource.xhs)
            )
        )
    ).scalar() or 0

    pois_total = db.execute(
        select(func.count(POI.id))
    ).scalar() or 0

    poi_signals_total = db.execute(
        select(func.count(POISignal.id))
    ).scalar() or 0

    poi_signals_xhs = db.execute(
        select(func.count(POISignal.id)).where(POISignal.source == SocialSource.xhs)
    ).scalar() or 0

    poi_aggregates_total = db.execute(
        select(func.count(POIAggregate.poi_id))
    ).scalar() or 0

    # ---- Samples (max 3 each) ----

    # XHS posts sample
    xhs_posts_rows = db.execute(
        select(SocialPost)
        .where(SocialPost.source == SocialSource.xhs)
        .order_by(SocialPost.created_at.desc())
        .limit(3)
    ).scalars().all()

    xhs_posts_sample = []
    for p in xhs_posts_rows:
        raw_len = len(p.raw_text) if p.raw_text else 0
        preview = (p.raw_text[:200] if p.raw_text else "")
        xhs_posts_sample.append({
            "id": str(p.id),
            "url": p.url,
            "raw_text_len": raw_len,
            "raw_text_preview": preview,
        })

    # XHS extractions sample
    xhs_extraction_rows = db.execute(
        select(SocialExtraction)
        .where(
            SocialExtraction.social_post_id.in_(
                select(SocialPost.id).where(SocialPost.source == SocialSource.xhs)
            )
        )
        .order_by(SocialExtraction.created_at.desc())
        .limit(3)
    ).scalars().all()

    xhs_extractions_sample = []
    for e in xhs_extraction_rows:
        candidates = (e.extracted_json or {}).get("candidates", [])
        top = [
            {
                "place_name": c.get("place_name", ""),
                "address_hint": c.get("address_hint"),
                "city_hint": c.get("city_hint"),
                "confidence": c.get("confidence"),
            }
            for c in candidates[:3]
        ]
        xhs_extractions_sample.append({
            "post_id": str(e.social_post_id),
            "candidate_count": len(candidates),
            "top_candidates": top,
        })

    # XHS poi_signals sample
    xhs_signals_rows = db.execute(
        select(POISignal, POI.name)
        .join(POI, POISignal.poi_id == POI.id)
        .where(POISignal.source == SocialSource.xhs)
        .order_by(POISignal.created_at.desc())
        .limit(3)
    ).all()

    xhs_signals_sample = []
    for signal, poi_name in xhs_signals_rows:
        sj = signal.signal_json or {}
        preview_parts = []
        if sj.get("why_special"):
            preview_parts.append(sj["why_special"][:80])
        if sj.get("what_to_order"):
            preview_parts.append(", ".join(sj["what_to_order"][:2]))
        xhs_signals_sample.append({
            "poi_id": str(signal.poi_id),
            "poi_name": poi_name,
            "source_post_id": str(signal.social_post_id) if signal.social_post_id else None,
            "signal_preview": " | ".join(preview_parts) or "(empty)",
        })

    # ---- Diagnosis ----
    diagnosis = _diagnose(
        social_posts_xhs, social_posts_xhs_with_text,
        social_extractions_xhs, xhs_extractions_sample,
        poi_signals_xhs,
    )

    return {
        "counts": {
            "social_posts_total": social_posts_total,
            "social_posts_xhs": social_posts_xhs,
            "social_posts_xhs_with_text": social_posts_xhs_with_text,
            "social_extractions_total": social_extractions_total,
            "social_extractions_xhs": social_extractions_xhs,
            "pois_total": pois_total,
            "poi_signals_total": poi_signals_total,
            "poi_signals_xhs": poi_signals_xhs,
            "poi_aggregates_total": poi_aggregates_total,
        },
        "samples": {
            "xhs_posts": xhs_posts_sample,
            "xhs_extractions": xhs_extractions_sample,
            "xhs_poi_signals": xhs_signals_sample,
        },
        "diagnosis": diagnosis,
    }


def _diagnose(
    xhs_posts: int,
    xhs_with_text: int,
    xhs_extractions: int,
    extraction_samples: list,
    xhs_signals: int,
) -> str:
    """Return a human-readable diagnosis of where the pipeline breaks."""
    if xhs_posts == 0:
        return "NO_XHS_POSTS: No Xiaohongshu posts have been ingested."

    if xhs_with_text == 0:
        return (
            "XHS_NO_TEXT: XHS posts exist but none have raw_text >= 200 chars. "
            "Ingestion is URL-only. Provide raw_text when creating XHS posts."
        )

    if xhs_extractions == 0:
        return (
            "XHS_NO_EXTRACTIONS: XHS posts with text exist but no extractions. "
            "The /extract endpoint may be failing or was never called. "
            "Check ExtractionResponse schema and API logs."
        )

    # Check if extractions have candidates
    has_candidates = any(
        s.get("candidate_count", 0) > 0 for s in extraction_samples
    )
    if not has_candidates:
        return (
            "XHS_EMPTY_EXTRACTIONS: Extractions exist but candidate_count is 0. "
            "The LLM extractor may be failing or the text is too short/generic."
        )

    if xhs_signals == 0:
        return (
            "XHS_NO_SIGNALS: Extractions with candidates exist but no POI signals. "
            "Canonicalization is failing or was never called. Check /canonicalize endpoint."
        )

    return "PIPELINE_OK: XHS data is flowing through all stages."
