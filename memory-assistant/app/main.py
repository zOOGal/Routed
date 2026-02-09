"""
FastAPI application with all routes.
"""
import logging
from uuid import UUID
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.config import get_settings
from app.db import get_db
from app.models import User, Conversation, Message, Memory, Feedback
from app.schemas import (
    UserCreate, UserResponse,
    ConversationCreate, ConversationResponse,
    ChatRequest, ChatResponse,
    MemoryResponse, MemoryListResponse,
    FeedbackCreate, FeedbackResponse,
    ErrorResponse,
)
from app.chat.service import process_chat, process_negative_feedback
from app.social.routes import router as social_router
from app.places.routes import router as poi_router
from app.detours.routes import router as detour_router
from app.debug.routes import router as debug_router

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(
    title="Personalized Assistant API",
    description="LLM assistant with long-term memory, social POI knowledge base, and detour suggestions",
    version="2.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ Auth Dependency ============

def verify_api_key(x_api_key: str = Header(...)) -> str:
    """Verify API key from header."""
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key


# Register sub-routers (after verify_api_key is defined)
app.include_router(social_router, dependencies=[Depends(verify_api_key)])
app.include_router(poi_router, dependencies=[Depends(verify_api_key)])
app.include_router(detour_router, dependencies=[Depends(verify_api_key)])
app.include_router(debug_router, dependencies=[Depends(verify_api_key)])


# ============ Health Check ============

@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# ============ User Routes ============

@app.post(
    "/v1/users",
    response_model=UserResponse,
    responses={401: {"model": ErrorResponse}},
)
def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """Create a new user."""
    user = User()
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.get(
    "/v1/users/{user_id}",
    response_model=UserResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """Get a user by ID."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ============ Conversation Routes ============

@app.post(
    "/v1/conversations",
    response_model=ConversationResponse,
    responses={404: {"model": ErrorResponse}},
)
def create_conversation(
    body: ConversationCreate,
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """Create a new conversation for a user."""
    # Verify user exists
    user = db.get(User, body.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    conversation = Conversation(user_id=body.user_id)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@app.get(
    "/v1/conversations/{conversation_id}",
    response_model=ConversationResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_conversation(
    conversation_id: UUID,
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """Get a conversation by ID."""
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


# ============ Chat Route ============

@app.post(
    "/v1/chat",
    response_model=ChatResponse,
    responses={404: {"model": ErrorResponse}},
)
def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """
    Send a message and get a response.

    This endpoint:
    1. Stores the user message
    2. Extracts and stores relevant memories
    3. Retrieves relevant memories for context
    4. Generates a personalized response
    5. Returns the response with memory metadata
    """
    # Verify user and conversation exist
    user = db.get(User, body.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    conversation = db.get(Conversation, body.conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.user_id != body.user_id:
        raise HTTPException(status_code=403, detail="Conversation does not belong to user")

    # Process the chat
    try:
        response = process_chat(
            db=db,
            user_id=body.user_id,
            conversation_id=body.conversation_id,
            user_message=body.message,
            location=body.location,
        )
        db.commit()
        return response
    except Exception as e:
        logger.error(f"Chat processing error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to process chat")


# ============ Memory Routes ============

@app.get(
    "/v1/memories",
    response_model=MemoryListResponse,
    responses={404: {"model": ErrorResponse}},
)
def list_memories(
    user_id: UUID = Query(..., description="User ID - only returns memories for this user"),
    type: Optional[str] = Query(None, description="Filter by memory type"),
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """
    List memories for a user.

    Provides transparency into what the system remembers.
    Note: In production, implement proper user authentication to verify
    the requesting user matches the user_id parameter.
    """
    # Verify user exists
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Query only memories belonging to the specified user
    # Security: user_id is required and filters results
    query = select(Memory).where(Memory.user_id == user_id)

    if type:
        query = query.where(Memory.type == type)

    query = query.order_by(Memory.created_at.desc())
    memories = list(db.execute(query).scalars().all())

    return MemoryListResponse(
        memories=[MemoryResponse.model_validate(m) for m in memories],
        total=len(memories),
    )


@app.get(
    "/v1/memories/{memory_id}",
    response_model=MemoryResponse,
    responses={404: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
def get_memory(
    memory_id: UUID,
    user_id: UUID = Query(..., description="User ID for ownership verification"),
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """Get a specific memory by ID. Requires user_id to verify ownership."""
    memory = db.get(Memory, memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")

    # Verify ownership - users can only access their own memories
    if memory.user_id != user_id:
        raise HTTPException(status_code=403, detail="Memory does not belong to user")

    return memory


@app.delete(
    "/v1/memories/{memory_id}",
    responses={404: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
def delete_memory(
    memory_id: UUID,
    user_id: UUID = Query(..., description="User ID for ownership verification"),
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """
    Delete a memory.

    Allows users to remove memories they don't want stored.
    Requires user_id to verify ownership.
    """
    memory = db.get(Memory, memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")

    # Verify ownership - users can only delete their own memories
    if memory.user_id != user_id:
        raise HTTPException(status_code=403, detail="Memory does not belong to user")

    db.delete(memory)
    db.commit()
    return {"status": "deleted", "id": str(memory_id)}


# ============ Feedback Route ============

@app.post(
    "/v1/feedback",
    response_model=FeedbackResponse,
    responses={404: {"model": ErrorResponse}},
)
def create_feedback(
    body: FeedbackCreate,
    db: Session = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """
    Submit feedback on a conversation or message.

    Negative feedback (rating=-1) may trigger creation of an episode memory
    to help the assistant learn from mistakes.
    """
    # Verify entities exist
    user = db.get(User, body.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    conversation = db.get(Conversation, body.conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if body.message_id:
        message = db.get(Message, body.message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

    # Create feedback record
    feedback = Feedback(
        user_id=body.user_id,
        conversation_id=body.conversation_id,
        message_id=body.message_id,
        rating=body.rating,
        comment=body.comment,
    )
    db.add(feedback)

    # Process negative feedback
    if body.rating == -1:
        try:
            memory_id = process_negative_feedback(
                db=db,
                user_id=body.user_id,
                conversation_id=body.conversation_id,
                message_id=body.message_id,
                comment=body.comment,
            )
            if memory_id:
                logger.info(f"Created episode memory from negative feedback: {memory_id}")
        except Exception as e:
            logger.error(f"Failed to process negative feedback: {e}")

    db.commit()
    db.refresh(feedback)
    return feedback


# ============ Startup Event ============

@app.on_event("startup")
async def startup_event():
    """Log startup information."""
    logger.info("Starting Personalized Assistant API")
    logger.info(f"Chat model: {settings.llm_chat_model}")
    logger.info(f"Embed model: {settings.llm_embed_model}")
