"""
Base interface for social post fetchers.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class FetchResult:
    """Result from fetching a social post."""
    raw_text: str
    raw_json: Optional[Dict[str, Any]] = None
    external_id: Optional[str] = None
    author: Optional[str] = None
    language: Optional[str] = None
    posted_at: Optional[str] = None  # ISO format string


class SocialFetcher(ABC):
    """Interface for fetching social post content."""

    @abstractmethod
    def fetch(self, url: str) -> FetchResult:
        """
        Fetch content from a social post URL.

        Args:
            url: The URL of the social post.

        Returns:
            FetchResult with raw_text, raw_json, and metadata.

        Raises:
            ValueError: If the URL is invalid or unsupported.
            RuntimeError: If fetching fails.
        """
        ...

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Check if this fetcher can handle the given URL."""
        ...
