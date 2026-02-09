"""Add social ingestion, POI knowledge base, and detour tables

Revision ID: 002
Revises: 001
Create Date: 2025-01-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE socialsource AS ENUM ('xhs', 'tiktok', 'instagram', 'reddit', 'manual');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            CREATE TYPE poiprovider AS ENUM ('google', 'apple', 'osm', 'manual');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            CREATE TYPE poicategory AS ENUM ('food', 'cafe', 'bar', 'dessert', 'viewpoint', 'shop', 'other');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # Create social_posts table
    op.execute("""
        CREATE TABLE IF NOT EXISTS social_posts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source socialsource NOT NULL,
            url TEXT,
            external_id TEXT,
            raw_text TEXT NOT NULL DEFAULT '',
            raw_json JSONB,
            language TEXT,
            author TEXT,
            posted_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute('CREATE INDEX IF NOT EXISTS ix_social_posts_source ON social_posts(source)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_social_posts_external_id ON social_posts(external_id)')

    # Create social_extractions table
    op.execute("""
        CREATE TABLE IF NOT EXISTS social_extractions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            social_post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
            extracted_json JSONB NOT NULL,
            confidence FLOAT NOT NULL DEFAULT 0.0,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute('CREATE INDEX IF NOT EXISTS ix_social_extractions_post_id ON social_extractions(social_post_id)')

    # Create pois table
    op.execute("""
        CREATE TABLE IF NOT EXISTS pois (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider poiprovider NOT NULL,
            provider_place_id TEXT NOT NULL,
            name TEXT NOT NULL,
            lat DOUBLE PRECISION NOT NULL,
            lng DOUBLE PRECISION NOT NULL,
            address TEXT,
            categories JSONB,
            price_level INTEGER,
            rating FLOAT,
            user_ratings_total INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_pois_provider_place_id ON pois(provider, provider_place_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_pois_lat_lng ON pois(lat, lng)')

    # Create poi_signals table
    op.execute("""
        CREATE TABLE IF NOT EXISTS poi_signals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            poi_id UUID NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
            source socialsource NOT NULL,
            social_post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL,
            signal_json JSONB NOT NULL,
            confidence FLOAT NOT NULL DEFAULT 0.0,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute('CREATE INDEX IF NOT EXISTS ix_poi_signals_poi_id ON poi_signals(poi_id)')

    # Create poi_aggregates table
    op.execute("""
        CREATE TABLE IF NOT EXISTS poi_aggregates (
            poi_id UUID PRIMARY KEY REFERENCES pois(id) ON DELETE CASCADE,
            aggregate_json JSONB NOT NULL DEFAULT '{}',
            score FLOAT NOT NULL DEFAULT 0.0,
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS poi_aggregates')
    op.execute('DROP TABLE IF EXISTS poi_signals')
    op.execute('DROP TABLE IF EXISTS pois')
    op.execute('DROP TABLE IF EXISTS social_extractions')
    op.execute('DROP TABLE IF EXISTS social_posts')
    op.execute('DROP TYPE IF EXISTS poicategory')
    op.execute('DROP TYPE IF EXISTS poiprovider')
    op.execute('DROP TYPE IF EXISTS socialsource')
