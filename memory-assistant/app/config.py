"""
Configuration loaded from environment variables.
"""
import os
from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql://postgres:postgres@localhost:5432/memory_assistant"

    # API Authentication
    api_key: str = "dev-api-key-change-me"

    # LLM Configuration
    llm_base_url: Optional[str] = None  # If None, uses OpenAI default
    llm_api_key: str = ""
    llm_chat_model: str = "gpt-4o-mini"
    llm_embed_model: str = "text-embedding-3-small"
    llm_embed_dimension: int = 1536

    # Memory settings
    memory_context_pack_size: int = 10

    # Places API
    places_provider: str = "google"
    google_places_api_key: str = ""

    # Detour settings
    corridor_buffer_km: float = 2.0
    max_detour_candidates: int = 20

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
