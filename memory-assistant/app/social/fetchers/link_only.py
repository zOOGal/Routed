"""
Link-only fetcher for platforms where scraping is not compliant.

For XHS (Xiaohongshu), TikTok, Instagram: we store the URL and accept
user-provided raw_text, but do NOT attempt to scrape content.
"""
import logging

from app.social.fetchers.base import SocialFetcher, FetchResult

logger = logging.getLogger(__name__)


class LinkOnlyFetcher(SocialFetcher):
    """
    Stub fetcher for platforms we do not scrape.

    Returns an empty FetchResult — the caller must provide raw_text separately.
    """

    def __init__(self, platform: str):
        self.platform = platform

    def can_handle(self, url: str) -> bool:
        patterns = {
            "xhs": ["xiaohongshu.com", "xhslink.com"],
            "tiktok": ["tiktok.com"],
            "instagram": ["instagram.com"],
        }
        domains = patterns.get(self.platform, [])
        return any(d in url for d in domains)

    def fetch(self, url: str) -> FetchResult:
        logger.info(
            f"LinkOnlyFetcher ({self.platform}): storing URL only, no scraping. "
            f"raw_text must be provided by the user."
        )
        return FetchResult(
            raw_text="",
            raw_json={"url": url, "platform": self.platform, "link_only": True},
        )
