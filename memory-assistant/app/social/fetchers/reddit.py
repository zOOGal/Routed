"""
Reddit public post fetcher.

Uses Reddit's public JSON endpoint (append .json to any post URL)
to fetch post content without authentication.
"""
import logging
import re
from typing import Optional
from datetime import datetime, timezone

import httpx

from app.social.fetchers.base import SocialFetcher, FetchResult

logger = logging.getLogger(__name__)

# Match reddit post URLs
REDDIT_URL_PATTERN = re.compile(
    r"https?://(?:www\.|old\.|new\.)?reddit\.com/r/\w+/comments/(\w+)"
)


class RedditFetcher(SocialFetcher):
    """Fetch Reddit posts via public JSON endpoint."""

    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout

    def can_handle(self, url: str) -> bool:
        return bool(REDDIT_URL_PATTERN.match(url))

    def fetch(self, url: str) -> FetchResult:
        match = REDDIT_URL_PATTERN.match(url)
        if not match:
            raise ValueError(f"Not a valid Reddit post URL: {url}")

        post_id = match.group(1)

        # Normalize URL and append .json
        # Strip query params, ensure it ends properly
        clean_url = url.split("?")[0].rstrip("/")
        json_url = clean_url + ".json"

        try:
            resp = httpx.get(
                json_url,
                headers={"User-Agent": "Routed/1.0 (social ingestion bot)"},
                timeout=self.timeout,
                follow_redirects=True,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"Reddit fetch HTTP error: {e.response.status_code} for {url}")
            raise RuntimeError(f"Reddit returned {e.response.status_code}")
        except Exception as e:
            logger.error(f"Reddit fetch error for {url}: {e}")
            raise RuntimeError(f"Failed to fetch Reddit post: {e}")

        # Reddit JSON format: list of listings
        # [0] = post listing, [1] = comments listing
        try:
            post_data = data[0]["data"]["children"][0]["data"]
        except (IndexError, KeyError, TypeError) as e:
            raise RuntimeError(f"Unexpected Reddit JSON structure: {e}")

        title = post_data.get("title", "")
        selftext = post_data.get("selftext", "")
        author = post_data.get("author")
        created_utc = post_data.get("created_utc")
        subreddit = post_data.get("subreddit", "")

        raw_text = f"{title}\n\n{selftext}".strip() if selftext else title

        posted_at: Optional[str] = None
        if created_utc:
            posted_at = datetime.fromtimestamp(created_utc, tz=timezone.utc).isoformat()

        return FetchResult(
            raw_text=raw_text,
            raw_json={
                "title": title,
                "selftext": selftext,
                "subreddit": subreddit,
                "score": post_data.get("score"),
                "num_comments": post_data.get("num_comments"),
                "url": post_data.get("url"),
            },
            external_id=post_id,
            author=author,
            posted_at=posted_at,
        )
