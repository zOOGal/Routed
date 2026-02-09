"""
Tests for seed ingestion script: parsing and processing logic.
"""
import json
import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime

from scripts.seed_ingest import (
    parse_seed_file,
    validate_source,
    SeedRow,
    process_seed_file,
    IngestSummary,
)
from app.models import SocialSource


# ── Parsing tests ───────────────────────────────────────────────


class TestParseJSON:
    def test_basic_json(self, tmp_path):
        seed = [
            {
                "source": "xhs",
                "raw_text": "Best ramen at Ichiran Shibuya",
                "city_hint": "Tokyo",
            },
            {
                "source": "manual",
                "raw_text": "Try the matcha at Tsujiri",
            },
        ]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        rows = parse_seed_file(str(path))
        assert len(rows) == 2
        assert rows[0].source == "xhs"
        assert rows[0].raw_text == "Best ramen at Ichiran Shibuya"
        assert rows[0].city_hint == "Tokyo"
        assert rows[1].source == "manual"
        assert rows[1].url is None

    def test_json_with_all_fields(self, tmp_path):
        seed = [
            {
                "source": "reddit",
                "url": "https://reddit.com/r/JapanTravel/comments/abc/test",
                "raw_text": "Great sushi spot",
                "city_hint": "Osaka",
                "country_hint": "Japan",
                "posted_at": "2024-06-15T10:00:00",
                "author": "user123",
            }
        ]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        rows = parse_seed_file(str(path))
        assert len(rows) == 1
        assert rows[0].url == "https://reddit.com/r/JapanTravel/comments/abc/test"
        assert rows[0].country_hint == "Japan"
        assert rows[0].posted_at == "2024-06-15T10:00:00"
        assert rows[0].author == "user123"

    def test_json_empty_array(self, tmp_path):
        path = tmp_path / "seeds.json"
        path.write_text("[]", encoding="utf-8")

        rows = parse_seed_file(str(path))
        assert rows == []

    def test_json_missing_optional_fields(self, tmp_path):
        seed = [{"source": "manual", "raw_text": "hello"}]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        rows = parse_seed_file(str(path))
        assert rows[0].url is None
        assert rows[0].city_hint is None
        assert rows[0].country_hint is None
        assert rows[0].posted_at is None
        assert rows[0].author is None

    def test_json_not_array_raises(self, tmp_path):
        path = tmp_path / "seeds.json"
        path.write_text('{"source":"manual"}', encoding="utf-8")

        with pytest.raises(ValueError, match="must be an array"):
            parse_seed_file(str(path))


class TestParseCSV:
    def test_basic_csv(self, tmp_path):
        csv_content = (
            "source,url,raw_text,city_hint,country_hint,posted_at,author\n"
            "xhs,,Best ramen at Ichiran,Tokyo,Japan,,\n"
            "manual,,Try the matcha,,,,\n"
        )
        path = tmp_path / "seeds.csv"
        path.write_text(csv_content, encoding="utf-8")

        rows = parse_seed_file(str(path))
        assert len(rows) == 2
        assert rows[0].source == "xhs"
        assert rows[0].raw_text == "Best ramen at Ichiran"
        assert rows[0].city_hint == "Tokyo"
        assert rows[1].source == "manual"

    def test_csv_with_url(self, tmp_path):
        csv_content = (
            "source,url,raw_text,city_hint,country_hint,posted_at,author\n"
            "reddit,https://reddit.com/r/test/comments/abc/post,Great food,Berlin,Germany,2024-01-01,alice\n"
        )
        path = tmp_path / "seeds.csv"
        path.write_text(csv_content, encoding="utf-8")

        rows = parse_seed_file(str(path))
        assert rows[0].url == "https://reddit.com/r/test/comments/abc/post"
        assert rows[0].author == "alice"


class TestValidateSource:
    def test_valid_sources(self):
        assert validate_source("xhs") == SocialSource.xhs
        assert validate_source("reddit") == SocialSource.reddit
        assert validate_source("manual") == SocialSource.manual
        assert validate_source("tiktok") == SocialSource.tiktok
        assert validate_source("instagram") == SocialSource.instagram

    def test_invalid_source(self):
        with pytest.raises(ValueError, match="Invalid source"):
            validate_source("twitter")


class TestUnsupportedFormat:
    def test_unsupported_extension(self, tmp_path):
        path = tmp_path / "seeds.xml"
        path.write_text("<data/>")
        with pytest.raises(ValueError, match="Unsupported file format"):
            parse_seed_file(str(path))


# ── Processing tests (mocked) ──────────────────────────────────


class TestProcessBadRows:
    """Ensure one bad row doesn't abort the whole import."""

    @patch("scripts.seed_ingest.canonicalize_post")
    @patch("scripts.seed_ingest.run_extraction")
    @patch("scripts.seed_ingest.ingest_post")
    @patch("scripts.seed_ingest.SessionLocal")
    def test_bad_row_continues(
        self, mock_session_cls, mock_ingest, mock_extract, mock_canon, tmp_path
    ):
        # Set up mock DB session
        mock_db = MagicMock()
        mock_session_cls.return_value = mock_db

        # Seed file: first row has bad source, second is valid
        seed = [
            {"source": "INVALID_SOURCE", "raw_text": "bad row"},
            {"source": "manual", "raw_text": "good row about ramen"},
        ]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        # Mock ingest_post to succeed for valid rows
        mock_post = MagicMock()
        mock_post.id = "test-id"
        mock_post.raw_text = "good row about ramen"
        mock_ingest.return_value = {"post": mock_post, "status": "stored"}

        # Mock extraction
        mock_extraction = MagicMock()
        mock_extract.return_value = {
            "extraction": mock_extraction,
            "extracted_json": {"candidates": []},
        }

        summary = process_seed_file(str(path))

        # First row should fail, second should succeed
        assert summary.inserted_posts == 1
        assert len(summary.errors) == 1
        assert "INVALID_SOURCE" in summary.errors[0]

    @patch("scripts.seed_ingest.canonicalize_post")
    @patch("scripts.seed_ingest.run_extraction")
    @patch("scripts.seed_ingest.ingest_post")
    @patch("scripts.seed_ingest.SessionLocal")
    def test_extraction_failure_continues(
        self, mock_session_cls, mock_ingest, mock_extract, mock_canon, tmp_path
    ):
        mock_db = MagicMock()
        mock_session_cls.return_value = mock_db

        seed = [
            {"source": "manual", "raw_text": "post one"},
            {"source": "manual", "raw_text": "post two"},
        ]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        # Both ingests succeed
        mock_post = MagicMock()
        mock_post.id = "test-id"
        mock_post.raw_text = "some text"
        mock_ingest.return_value = {"post": mock_post, "status": "stored"}

        # First extraction fails, second succeeds
        mock_extract.side_effect = [
            RuntimeError("LLM timeout"),
            {"extraction": MagicMock(), "extracted_json": {"candidates": []}},
        ]

        summary = process_seed_file(str(path))

        assert summary.inserted_posts == 2
        assert summary.extraction_failures == 1
        assert summary.extracted_posts == 1

    def test_dry_run_no_side_effects(self, tmp_path):
        seed = [
            {"source": "manual", "raw_text": "test post"},
        ]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        # Dry run should not import anything
        summary = process_seed_file(str(path), dry_run=True)
        assert summary.inserted_posts == 0

    def test_source_filter(self, tmp_path):
        seed = [
            {"source": "xhs", "raw_text": "xhs post"},
            {"source": "manual", "raw_text": "manual post"},
            {"source": "xhs", "raw_text": "another xhs"},
        ]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        # Dry run with filter to check row count
        summary = process_seed_file(str(path), dry_run=True, source_filter="xhs")
        assert summary.total_rows == 3
        assert summary.skipped_rows == 1  # the manual row

    def test_limit(self, tmp_path):
        seed = [{"source": "manual", "raw_text": f"post {i}"} for i in range(10)]
        path = tmp_path / "seeds.json"
        path.write_text(json.dumps(seed), encoding="utf-8")

        summary = process_seed_file(str(path), dry_run=True, limit=3)
        assert summary.total_rows == 10
