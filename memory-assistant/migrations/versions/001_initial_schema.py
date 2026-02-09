"""Initial schema with all tables

Revision ID: 001
Revises: None
Create Date: 2024-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    # Create enum types with IF NOT EXISTS pattern
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE messagerole AS ENUM ('user', 'assistant', 'system');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            CREATE TYPE memorytype AS ENUM ('preference', 'profile', 'constraint', 'goal', 'episode');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            CREATE TYPE sensitivity AS ENUM ('low', 'med', 'high');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # Create users table
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)

    # Create conversations table
    op.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)

    # Create messages table
    op.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role messagerole NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute('CREATE INDEX IF NOT EXISTS ix_messages_conversation_created ON messages(conversation_id, created_at)')

    # Create memories table
    op.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type memorytype NOT NULL,
            text TEXT NOT NULL,
            structured_json JSONB,
            confidence FLOAT NOT NULL DEFAULT 0.8,
            sensitivity sensitivity NOT NULL DEFAULT 'low',
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            expires_at TIMESTAMP,
            source_conversation_id UUID,
            source_message_id UUID,
            embedding vector(1536)
        )
    """)
    op.execute('CREATE INDEX IF NOT EXISTS ix_memories_user_type ON memories(user_id, type)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_memories_user_created ON memories(user_id, created_at)')

    # Create HNSW index for vector similarity search
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_memories_embedding_hnsw
        ON memories
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)

    # Create feedback table
    op.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
            rating INTEGER NOT NULL,
            comment TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS feedback')
    op.execute('DROP INDEX IF EXISTS ix_memories_embedding_hnsw')
    op.execute('DROP INDEX IF EXISTS ix_memories_user_created')
    op.execute('DROP INDEX IF EXISTS ix_memories_user_type')
    op.execute('DROP TABLE IF EXISTS memories')
    op.execute('DROP INDEX IF EXISTS ix_messages_conversation_created')
    op.execute('DROP TABLE IF EXISTS messages')
    op.execute('DROP TABLE IF EXISTS conversations')
    op.execute('DROP TABLE IF EXISTS users')
    op.execute('DROP TYPE IF EXISTS sensitivity')
    op.execute('DROP TYPE IF EXISTS memorytype')
    op.execute('DROP TYPE IF EXISTS messagerole')
    op.execute('DROP EXTENSION IF EXISTS vector')
