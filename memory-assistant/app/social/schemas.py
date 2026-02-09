"""
Pydantic schemas for social ingestion API.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import SocialSource


class SocialPostCreate(BaseModel):
    source: SocialSource
    url: Optional[str] = None
    raw_text: Optional[str] = None
    city_hint: Optional[str] = None


class SocialPostResponse(BaseModel):
    id: UUID
    source: SocialSource
    url: Optional[str]
    external_id: Optional[str]
    raw_text: str
    language: Optional[str]
    author: Optional[str]
    posted_at: Optional[datetime]
    created_at: datetime
    status: str = "stored"

    class Config:
        from_attributes = True


class ExtractionResponse(BaseModel):
    extraction_id: UUID = Field(validation_alias="id")
    social_post_id: UUID
    extracted_json: Dict[str, Any]
    confidence: float
    created_at: datetime

    class Config:
        from_attributes = True
