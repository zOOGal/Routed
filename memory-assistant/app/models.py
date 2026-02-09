"""
SQLAlchemy ORM models.
"""
import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Column, String, Text, Float, DateTime, Enum, ForeignKey,
    Integer, Index, JSON, ARRAY
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, DOUBLE_PRECISION
from sqlalchemy.orm import declarative_base, relationship
from pgvector.sqlalchemy import Vector

from app.config import get_settings

settings = get_settings()
Base = declarative_base()


class MessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class MemoryType(str, enum.Enum):
    preference = "preference"
    profile = "profile"
    constraint = "constraint"
    goal = "goal"
    episode = "episode"


class Sensitivity(str, enum.Enum):
    low = "low"
    med = "med"
    high = "high"


class SocialSource(str, enum.Enum):
    xhs = "xhs"
    tiktok = "tiktok"
    instagram = "instagram"
    reddit = "reddit"
    manual = "manual"


class POIProvider(str, enum.Enum):
    google = "google"
    apple = "apple"
    osm = "osm"
    manual = "manual"


class POICategory(str, enum.Enum):
    food = "food"
    cafe = "cafe"
    bar = "bar"
    dessert = "dessert"
    viewpoint = "viewpoint"
    shop = "shop"
    other = "other"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")
    memories = relationship("Memory", back_populates="user", cascade="all, delete-orphan")
    feedback = relationship("Feedback", back_populates="user", cascade="all, delete-orphan")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    feedback = relationship("Feedback", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(Enum(MessageRole, name='messagerole', create_type=False), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")
    feedback = relationship("Feedback", back_populates="message", cascade="all, delete-orphan")

    # Index for conversation message ordering
    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )


class Memory(Base):
    __tablename__ = "memories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(Enum(MemoryType, name='memorytype', create_type=False), nullable=False)
    text = Column(Text, nullable=False)
    structured_json = Column(JSON, nullable=True)
    confidence = Column(Float, nullable=False, default=0.8)
    sensitivity = Column(Enum(Sensitivity, name='sensitivity', create_type=False), nullable=False, default=Sensitivity.low)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    source_conversation_id = Column(UUID(as_uuid=True), nullable=True)
    source_message_id = Column(UUID(as_uuid=True), nullable=True)
    embedding = Column(Vector(768), nullable=True)  # Must match LLM_EMBED_DIMENSION config (768 for Gemini, 1536 for OpenAI)

    # Relationships
    user = relationship("User", back_populates="memories")

    __table_args__ = (
        Index("ix_memories_user_type", "user_id", "type"),
        Index("ix_memories_user_created", "user_id", "created_at"),
    )


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    rating = Column(Integer, nullable=False)  # -1 or 1
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="feedback")
    conversation = relationship("Conversation", back_populates="feedback")
    message = relationship("Message", back_populates="feedback")


# ============ Social Ingestion Models ============


class SocialPost(Base):
    __tablename__ = "social_posts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source = Column(Enum(SocialSource, name="socialsource", create_type=False), nullable=False)
    url = Column(Text, nullable=True)
    external_id = Column(Text, nullable=True)
    raw_text = Column(Text, nullable=False, default="")
    raw_json = Column(JSONB, nullable=True)
    language = Column(Text, nullable=True)
    author = Column(Text, nullable=True)
    posted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    extractions = relationship("SocialExtraction", back_populates="social_post", cascade="all, delete-orphan")
    poi_signals = relationship("POISignal", back_populates="social_post")

    __table_args__ = (
        Index("ix_social_posts_source", "source"),
        Index("ix_social_posts_external_id", "external_id"),
    )


class SocialExtraction(Base):
    __tablename__ = "social_extractions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    social_post_id = Column(UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="CASCADE"), nullable=False)
    extracted_json = Column(JSONB, nullable=False)
    confidence = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    social_post = relationship("SocialPost", back_populates="extractions")

    __table_args__ = (
        Index("ix_social_extractions_post_id", "social_post_id"),
    )


# ============ POI Knowledge Base Models ============


class POI(Base):
    __tablename__ = "pois"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(Enum(POIProvider, name="poiprovider", create_type=False), nullable=False)
    provider_place_id = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    lat = Column(DOUBLE_PRECISION, nullable=False)
    lng = Column(DOUBLE_PRECISION, nullable=False)
    address = Column(Text, nullable=True)
    categories = Column(JSONB, nullable=True)  # list of strings
    price_level = Column(Integer, nullable=True)
    rating = Column(Float, nullable=True)
    user_ratings_total = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    signals = relationship("POISignal", back_populates="poi", cascade="all, delete-orphan")
    aggregate = relationship("POIAggregate", back_populates="poi", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_pois_provider_place_id", "provider", "provider_place_id", unique=True),
        Index("ix_pois_lat_lng", "lat", "lng"),
    )


class POISignal(Base):
    __tablename__ = "poi_signals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    poi_id = Column(UUID(as_uuid=True), ForeignKey("pois.id", ondelete="CASCADE"), nullable=False)
    source = Column(Enum(SocialSource, name="socialsource", create_type=False), nullable=False)
    social_post_id = Column(UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="SET NULL"), nullable=True)
    signal_json = Column(JSONB, nullable=False)
    confidence = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    poi = relationship("POI", back_populates="signals")
    social_post = relationship("SocialPost", back_populates="poi_signals")

    __table_args__ = (
        Index("ix_poi_signals_poi_id", "poi_id"),
    )


class POIAggregate(Base):
    __tablename__ = "poi_aggregates"

    poi_id = Column(UUID(as_uuid=True), ForeignKey("pois.id", ondelete="CASCADE"), primary_key=True)
    aggregate_json = Column(JSONB, nullable=False, default=dict)
    score = Column(Float, nullable=False, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    poi = relationship("POI", back_populates="aggregate")
