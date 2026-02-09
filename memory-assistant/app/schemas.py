"""
Pydantic schemas for API request/response validation.
"""
from datetime import datetime
from typing import Optional, Any, Dict, List
from uuid import UUID
from pydantic import BaseModel, Field

from app.models import MessageRole, MemoryType, Sensitivity


# ============ User Schemas ============

class UserCreate(BaseModel):
    pass


class UserResponse(BaseModel):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ============ Conversation Schemas ============

class ConversationCreate(BaseModel):
    user_id: UUID


class ConversationResponse(BaseModel):
    id: UUID
    user_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ============ Message Schemas ============

class MessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    role: MessageRole
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


# ============ Chat Schemas ============

class ChatLocationContext(BaseModel):
    """Optional location context for POI-aware chat responses."""
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float
    category: Optional[str] = "food"


class ChatRequest(BaseModel):
    user_id: UUID
    conversation_id: UUID
    message: str = Field(..., min_length=1, max_length=10000)
    location: Optional[ChatLocationContext] = None


class DetourCandidateOut(BaseModel):
    """Simplified detour candidate for response contract."""
    poi_id: str
    name: str
    adds_minutes: float
    what_to_order: List[str]
    why_special: str


class ChatResponse(BaseModel):
    reply: str
    used_memories: List[UUID]
    stored_memories: List[UUID]
    detour_candidates_returned: int = 0
    detour_candidates_used: List[str] = Field(default_factory=list)
    detour_reason_if_empty: Optional[str] = None


# ============ Memory Schemas ============

class MemoryCandidate(BaseModel):
    """Memory candidate extracted by the LLM."""
    type: MemoryType
    text: str
    structured_json: Optional[Dict[str, Any]] = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    sensitivity: Sensitivity = Sensitivity.low
    expires_in_days: Optional[int] = None


class MemoryCandidateList(BaseModel):
    """Response from memory extraction LLM."""
    candidates: List[MemoryCandidate]


class MemoryResponse(BaseModel):
    id: UUID
    user_id: UUID
    type: MemoryType
    text: str
    structured_json: Optional[Dict[str, Any]]
    confidence: float
    sensitivity: Sensitivity
    created_at: datetime
    expires_at: Optional[datetime]

    class Config:
        from_attributes = True


class MemoryListResponse(BaseModel):
    memories: List[MemoryResponse]
    total: int


# ============ Feedback Schemas ============

class FeedbackCreate(BaseModel):
    user_id: UUID
    conversation_id: UUID
    message_id: Optional[UUID] = None
    rating: int = Field(..., ge=-1, le=1)
    comment: Optional[str] = None


class FeedbackResponse(BaseModel):
    id: UUID
    user_id: UUID
    conversation_id: UUID
    message_id: Optional[UUID]
    rating: int
    comment: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ============ Error Schemas ============

class ErrorResponse(BaseModel):
    detail: str
