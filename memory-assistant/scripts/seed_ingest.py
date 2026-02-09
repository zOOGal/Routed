#!/usr/bin/env python3
"""
Batch seed ingestion script.

Reads a JSON or CSV seed file and populates the POI knowledge base by:
1. Inserting social_posts rows
2. Running LLM extraction (social_extractions)
3. Canonicalizing against Places API (pois + poi_signals + poi_aggregates)

Usage:
    python scripts/seed_ingest.py --file seeds.json
    python scripts/seed_ingest.py --file seeds.csv --dry-run
    python scripts/seed_ingest.py --file seeds.json --source xhs --limit 10
    python scripts/seed_ingest.py --file seeds.json --skip-canonicalize
"""
import argparse
import csv
import io
import json
import logging
import sys
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

# Ensure the app package is importable when running from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import SessionLocal
from app.models import SocialSource
from app.social.service import ingest_post, run_extraction
from app.places.canonicalize import canonicalize_post

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("seed_ingest")


# ── Seed row parsing ────────────────────────────────────────────


@dataclass
class SeedRow:
    source: str
    raw_text: str = ""
    url: Optional[str] = None
    city_hint: Optional[str] = None
    country_hint: Optional[str] = None
    posted_at: Optional[str] = None
    author: Optional[str] = None


def parse_seed_file(path: str) -> List[SeedRow]:
    """Parse a JSON or CSV seed file into SeedRow objects."""
    if path.endswith(".json"):
        return _parse_json(path)
    elif path.endswith(".csv"):
        return _parse_csv(path)
    else:
        raise ValueError(f"Unsupported file format: {path} (use .json or .csv)")


def _parse_json(path: str) -> List[SeedRow]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("JSON seed file must be an array of objects")
    return [_dict_to_row(d) for d in data]


def _parse_csv(path: str) -> List[SeedRow]:
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [_dict_to_row(row) for row in reader]


def _dict_to_row(d: Dict[str, Any]) -> SeedRow:
    return SeedRow(
        source=str(d.get("source", "manual")).strip(),
        raw_text=str(d.get("raw_text", "") or "").strip(),
        url=(d.get("url") or "").strip() or None,
        city_hint=(d.get("city_hint") or "").strip() or None,
        country_hint=(d.get("country_hint") or "").strip() or None,
        posted_at=(d.get("posted_at") or "").strip() or None,
        author=(d.get("author") or "").strip() or None,
    )


def validate_source(source_str: str) -> SocialSource:
    """Convert string to SocialSource enum, raising ValueError on bad input."""
    try:
        return SocialSource(source_str)
    except ValueError:
        valid = ", ".join(s.value for s in SocialSource)
        raise ValueError(f"Invalid source '{source_str}'. Must be one of: {valid}")


# ── Processing ──────────────────────────────────────────────────


@dataclass
class IngestSummary:
    total_rows: int = 0
    skipped_rows: int = 0
    inserted_posts: int = 0
    extracted_posts: int = 0
    extraction_failures: int = 0
    canonicalized_candidates: int = 0
    created_pois: int = 0
    linked_pois: int = 0
    unmatched_candidates: int = 0
    errors: List[str] = field(default_factory=list)


def process_seed_file(
    path: str,
    dry_run: bool = False,
    limit: Optional[int] = None,
    source_filter: Optional[str] = None,
    skip_extract: bool = False,
    skip_canonicalize: bool = False,
) -> IngestSummary:
    """
    Main entry point: parse file, process each row, return summary.
    """
    rows = parse_seed_file(path)
    summary = IngestSummary(total_rows=len(rows))

    # Apply source filter
    if source_filter:
        rows = [r for r in rows if r.source == source_filter]
        summary.skipped_rows = summary.total_rows - len(rows)
        logger.info(f"Source filter '{source_filter}': {len(rows)} rows match")

    # Apply limit
    if limit is not None and limit < len(rows):
        rows = rows[:limit]
        logger.info(f"Limiting to {limit} rows")

    if dry_run:
        _dry_run_report(rows, skip_extract, skip_canonicalize)
        return summary

    for i, row in enumerate(rows):
        logger.info(f"[{i+1}/{len(rows)}] Processing {row.source} post...")
        _process_one_row(row, summary, skip_extract, skip_canonicalize)

    return summary


def _process_one_row(
    row: SeedRow,
    summary: IngestSummary,
    skip_extract: bool,
    skip_canonicalize: bool,
) -> None:
    """Process a single seed row with its own DB session (independent transactions)."""
    db = SessionLocal()
    try:
        # 1. Validate source
        source = validate_source(row.source)

        # 2. Parse posted_at
        posted_at = None
        if row.posted_at:
            try:
                posted_at = datetime.fromisoformat(row.posted_at)
            except ValueError:
                logger.warning(f"  Bad posted_at '{row.posted_at}', ignoring")

        # 3. Ingest post
        result = ingest_post(
            db=db,
            source=source,
            url=row.url,
            raw_text=row.raw_text,
            author=row.author,
            posted_at=posted_at,
        )
        db.commit()
        post = result["post"]
        post_id = post.id
        summary.inserted_posts += 1
        logger.info(f"  Inserted post {post_id} (status={result['status']})")

        # 4. Extract (if text available and not skipped)
        if skip_extract:
            return

        if not post.raw_text or not post.raw_text.strip():
            logger.info(f"  Skipping extraction: no raw_text")
            return

        city_hint = row.city_hint
        try:
            ext_result = run_extraction(db=db, post_id=post_id, city_hint=city_hint)
            db.commit()
            candidates = ext_result["extracted_json"].get("candidates", [])
            summary.extracted_posts += 1
            logger.info(f"  Extracted {len(candidates)} candidate(s)")
        except Exception as e:
            summary.extraction_failures += 1
            summary.errors.append(f"Extraction failed for post {post_id}: {e}")
            logger.error(f"  Extraction failed: {e}")
            db.rollback()
            return

        # 5. Canonicalize (if not skipped)
        if skip_canonicalize or not candidates:
            return

        try:
            canon_result = canonicalize_post(db, post_id)
            # canonicalize_post commits internally
            linked = canon_result.get("created_or_linked_pois", [])
            unmatched = canon_result.get("unmatched_candidates", [])
            summary.canonicalized_candidates += len(linked) + len(unmatched)
            summary.linked_pois += len(linked)
            summary.unmatched_candidates += len(unmatched)
            logger.info(f"  Canonicalized: {len(linked)} linked, {len(unmatched)} unmatched")
        except Exception as e:
            summary.errors.append(f"Canonicalization failed for post {post_id}: {e}")
            logger.error(f"  Canonicalization failed: {e}")
            db.rollback()

    except Exception as e:
        summary.errors.append(f"Row failed ({row.source}, url={row.url}): {e}")
        logger.error(f"  Row error: {e}")
        db.rollback()
    finally:
        db.close()


def _dry_run_report(
    rows: List[SeedRow],
    skip_extract: bool,
    skip_canonicalize: bool,
) -> None:
    """Print what would happen without doing anything."""
    print(f"\n=== DRY RUN ===")
    print(f"Would process {len(rows)} rows:\n")
    for i, row in enumerate(rows):
        text_preview = (row.raw_text[:60] + "...") if len(row.raw_text) > 60 else row.raw_text
        print(f"  {i+1}. [{row.source}] {text_preview or '(no text)'}")
        if row.url:
            print(f"     url: {row.url}")
        if row.city_hint:
            print(f"     city_hint: {row.city_hint}")
    print(f"\nSteps: ingest=YES  extract={'NO' if skip_extract else 'YES'}  "
          f"canonicalize={'NO' if skip_canonicalize else 'YES'}")
    print(f"=== END DRY RUN ===\n")


def print_summary(summary: IngestSummary) -> None:
    """Print the final summary."""
    print(f"\n{'='*50}")
    print(f"  SEED INGESTION SUMMARY")
    print(f"{'='*50}")
    print(f"  Total rows in file:       {summary.total_rows}")
    print(f"  Skipped (filtered):       {summary.skipped_rows}")
    print(f"  Inserted posts:           {summary.inserted_posts}")
    print(f"  Extracted posts:          {summary.extracted_posts}")
    print(f"  Extraction failures:      {summary.extraction_failures}")
    print(f"  Canonicalized candidates: {summary.canonicalized_candidates}")
    print(f"  Linked POIs:              {summary.linked_pois}")
    print(f"  Unmatched candidates:     {summary.unmatched_candidates}")
    if summary.errors:
        print(f"\n  Errors ({len(summary.errors)}):")
        for err in summary.errors[:10]:
            print(f"    - {err}")
        if len(summary.errors) > 10:
            print(f"    ... and {len(summary.errors) - 10} more")
    print(f"{'='*50}\n")


# ── CLI ─────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Batch ingest social posts from a seed file into the POI knowledge base.",
    )
    parser.add_argument(
        "--file", "-f", required=True,
        help="Path to seed file (JSON array or CSV with headers)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would be done without writing to DB or calling APIs",
    )
    parser.add_argument(
        "--limit", "-n", type=int, default=None,
        help="Process at most N rows",
    )
    parser.add_argument(
        "--source", "-s", default=None,
        help="Only process rows matching this source (xhs, reddit, manual, ...)",
    )
    parser.add_argument(
        "--skip-extract", action="store_true",
        help="Insert posts but skip LLM extraction",
    )
    parser.add_argument(
        "--skip-canonicalize", action="store_true",
        help="Insert + extract but skip Places API canonicalization",
    )
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"Error: file not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    summary = process_seed_file(
        path=args.file,
        dry_run=args.dry_run,
        limit=args.limit,
        source_filter=args.source,
        skip_extract=args.skip_extract,
        skip_canonicalize=args.skip_canonicalize,
    )

    if not args.dry_run:
        print_summary(summary)


if __name__ == "__main__":
    main()
