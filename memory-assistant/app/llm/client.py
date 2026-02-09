"""
LLM client wrapper for chat completions and embeddings.
Designed to be provider-agnostic (OpenAI-compatible API).
"""
import json
import logging
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class LLMClient:
    """Wrapper for LLM chat and embedding operations."""

    def __init__(self):
        self.client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )
        self.chat_model = settings.llm_chat_model
        self.embed_model = settings.llm_embed_model
        self.embed_dimension = settings.llm_embed_dimension

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2000,
        json_mode: bool = False,
    ) -> str:
        """
        Generate a chat completion.

        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Sampling temperature
            max_tokens: Maximum tokens in response
            json_mode: If True, request JSON response format

        Returns:
            The assistant's response content
        """
        try:
            kwargs: Dict[str, Any] = {
                "model": self.chat_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            response = self.client.chat.completions.create(**kwargs)
            return response.choices[0].message.content or ""

        except Exception as e:
            logger.error(f"LLM chat error: {e}")
            raise

    def chat_json(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.3,
    ) -> Dict[str, Any]:
        """
        Generate a chat completion and parse as JSON.

        Args:
            messages: List of message dicts
            temperature: Sampling temperature (lower for structured output)

        Returns:
            Parsed JSON response
        """
        response = self.chat(
            messages=messages,
            temperature=temperature,
            json_mode=True,
        )

        try:
            return json.loads(response)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM JSON response: {response[:500]}")
            raise ValueError(f"Invalid JSON from LLM: {e}")

    def embed(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed

        Returns:
            Embedding vector as list of floats
        """
        try:
            # Gemini doesn't support dimensions parameter
            kwargs = {
                "model": self.embed_model,
                "input": text,
            }
            # Only add dimensions for OpenAI models
            if "text-embedding-3" in self.embed_model:
                kwargs["dimensions"] = self.embed_dimension

            response = self.client.embeddings.create(**kwargs)
            return response.data[0].embedding

        except Exception as e:
            logger.error(f"Embedding error: {e}")
            raise

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors
        """
        if not texts:
            return []

        try:
            # Gemini doesn't support dimensions parameter
            kwargs = {
                "model": self.embed_model,
                "input": texts,
            }
            # Only add dimensions for OpenAI models
            if "text-embedding-3" in self.embed_model:
                kwargs["dimensions"] = self.embed_dimension

            response = self.client.embeddings.create(**kwargs)
            # Sort by index to maintain order
            sorted_data = sorted(response.data, key=lambda x: x.index)
            return [item.embedding for item in sorted_data]

        except Exception as e:
            logger.error(f"Batch embedding error: {e}")
            raise


# Singleton instance
_client: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    """Get or create the LLM client singleton."""
    global _client
    if _client is None:
        _client = LLMClient()
    return _client
