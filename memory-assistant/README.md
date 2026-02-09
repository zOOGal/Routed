# Personalized Assistant with Long-Term Memory

An MVP backend service that wraps an LLM with long-term memory and personalization. The system stores chat messages, extracts memories from conversations, and uses them to provide personalized responses.

## Features

- **Memory Extraction**: Automatically extracts preferences, profile info, constraints, goals, and notable episodes from conversations
- **Write Gate**: Intelligent filtering to only store high-confidence, appropriate memories
- **Hybrid Retrieval**: Combines structured queries with vector similarity search
- **Personalized Responses**: Uses memory context to generate relevant, personalized replies
- **Feedback Loop**: Learn from negative feedback to improve future interactions
- **User Transparency**: Full API access to view and delete stored memories

## Tech Stack

- Python 3.11
- FastAPI
- PostgreSQL with pgvector
- SQLAlchemy + Alembic
- OpenAI-compatible LLM API
- Docker + docker-compose

## Quick Start

### 1. Clone and Setup Environment

```bash
cd memory-assistant
cp .env.example .env
```

Edit `.env` and set your LLM API key:
```
LLM_API_KEY=sk-your-openai-api-key
```

### 2. Start Services with Docker

```bash
docker-compose up -d
```

This will:
- Start PostgreSQL with pgvector
- Run database migrations
- Start the API server on http://localhost:8000

### 3. Verify It's Running

```bash
curl http://localhost:8000/health
```

## API Usage

All endpoints require the `x-api-key` header (default: `dev-api-key-change-me`).

### Create a User

```bash
curl -X POST http://localhost:8000/v1/users \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{}'
```

Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Create a Conversation

```bash
curl -X POST http://localhost:8000/v1/conversations \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{"user_id": "550e8400-e29b-41d4-a716-446655440000"}'
```

### Send a Chat Message

```bash
curl -X POST http://localhost:8000/v1/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "conversation_id": "660e8400-e29b-41d4-a716-446655440001",
    "message": "Hi! I'\''m a software engineer and I prefer concise answers. I'\''m currently learning Rust."
  }'
```

Response:
```json
{
  "reply": "Nice to meet you! As a fellow engineer, I'll keep things concise. Rust is a great choice...",
  "used_memories": [],
  "stored_memories": ["770e8400-e29b-41d4-a716-446655440002", "770e8400-e29b-41d4-a716-446655440003"]
}
```

### List User's Memories

```bash
curl "http://localhost:8000/v1/memories?user_id=550e8400-e29b-41d4-a716-446655440000" \
  -H "x-api-key: dev-api-key-change-me"
```

Response:
```json
{
  "memories": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "profile",
      "text": "Software engineer",
      "structured_json": null,
      "confidence": 0.95,
      "sensitivity": "low",
      "created_at": "2024-01-15T10:31:00Z",
      "expires_at": null
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440003",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "goal",
      "text": "Learning Rust programming language",
      "structured_json": null,
      "confidence": 0.9,
      "sensitivity": "low",
      "created_at": "2024-01-15T10:31:00Z",
      "expires_at": null
    }
  ],
  "total": 2
}
```

### Filter Memories by Type

```bash
curl "http://localhost:8000/v1/memories?user_id=550e8400-e29b-41d4-a716-446655440000&type=preference" \
  -H "x-api-key: dev-api-key-change-me"
```

### Get a Specific Memory

```bash
curl "http://localhost:8000/v1/memories/770e8400-e29b-41d4-a716-446655440002?user_id=550e8400-e29b-41d4-a716-446655440000" \
  -H "x-api-key: dev-api-key-change-me"
```

Note: The `user_id` query parameter is required for ownership verification.

### Delete a Memory

```bash
curl -X DELETE "http://localhost:8000/v1/memories/770e8400-e29b-41d4-a716-446655440002?user_id=550e8400-e29b-41d4-a716-446655440000" \
  -H "x-api-key: dev-api-key-change-me"
```

Note: The `user_id` query parameter is required for ownership verification. Users can only delete their own memories.

### Submit Feedback

```bash
curl -X POST http://localhost:8000/v1/feedback \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "conversation_id": "660e8400-e29b-41d4-a716-446655440001",
    "message_id": "880e8400-e29b-41d4-a716-446655440004",
    "rating": -1,
    "comment": "The response was too long, I asked for concise answers"
  }'
```

## Development

### Run Without Docker

```bash
# Install dependencies
pip install -r requirements.txt

# Start PostgreSQL with pgvector (e.g., using Docker)
docker run -d --name pgvector \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=memory_assistant \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Run migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload
```

### Run Tests

```bash
pytest
```

### Run Migrations

```bash
# Create a new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1
```

## Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `preference` | User likes/dislikes, style preferences | "Prefers concise responses" |
| `profile` | Facts about the user | "Software engineer at Acme Corp" |
| `constraint` | Limitations or restrictions | "Allergic to shellfish" |
| `goal` | Things user is working toward | "Learning Rust programming" |
| `episode` | Notable past events | "Had a bad experience with verbose responses" |

## Write Gate Rules

Memories are automatically stored based on confidence and sensitivity:

- **Low sensitivity**: Stored if confidence ≥ 0.75
- **Medium sensitivity**: Stored if confidence ≥ 0.85
- **High sensitivity**: Only stored with explicit user consent

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/memory_assistant` |
| `API_KEY` | API authentication key | `dev-api-key-change-me` |
| `LLM_API_KEY` | OpenAI API key | (required) |
| `LLM_BASE_URL` | Custom LLM endpoint | (OpenAI default) |
| `LLM_CHAT_MODEL` | Chat model name | `gpt-4o-mini` |
| `LLM_EMBED_MODEL` | Embedding model name | `text-embedding-3-small` |
| `LLM_EMBED_DIMENSION` | Embedding vector dimension | `1536` |

---

## Social POI Knowledge Base & Detour Suggestions

### Platform Compliance Note

**XHS (Xiaohongshu), TikTok, and Instagram** are supported as **link-ingestion only**. The system does NOT scrape or fetch content from these platforms. Users must provide the post text manually along with the URL. This avoids ToS violations and login-gated scraping.

**Reddit** uses the public JSON endpoint (appending `.json` to post URLs), which does not require authentication.

Social content is used as **enrichment/ranking signals** (what to order, why it's special, warnings) but **never as source of truth** for address, hours, or place existence. All place data is verified via Google Places API.

### Ingest a Social Post (Manual)

```bash
curl -X POST http://localhost:8000/v1/social/posts \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{
    "source": "manual",
    "raw_text": "Just had the best ramen at Ichiran in Shibuya! The tonkotsu broth was incredible. Order the extra-firm noodles. Cash only though, heads up. Go on weekday lunch to avoid the line."
  }'
```

### Ingest a Reddit Post (Auto-Fetched)

```bash
curl -X POST http://localhost:8000/v1/social/posts \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{
    "source": "reddit",
    "url": "https://www.reddit.com/r/JapanTravel/comments/abc123/best_ramen_in_tokyo/"
  }'
```

### Ingest an XHS Post (Link + User-Provided Text)

```bash
curl -X POST http://localhost:8000/v1/social/posts \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{
    "source": "xhs",
    "url": "https://www.xiaohongshu.com/explore/abc123",
    "raw_text": "东京涩谷一兰拉面！豚骨汤底超浓郁，一定要点硬面。只收现金！工作日中午去人少。",
    "city_hint": "Tokyo"
  }'
```

### Extract Place Candidates from a Post

```bash
curl -X POST http://localhost:8000/v1/social/posts/{post_id}/extract \
  -H "x-api-key: dev-api-key-change-me"
```

Response:
```json
{
  "extraction_id": "...",
  "social_post_id": "...",
  "extracted_json": {
    "candidates": [
      {
        "place_name": "Ichiran",
        "place_aliases": ["一兰拉面", "Ichiran Ramen"],
        "city_hint": "Tokyo",
        "category": "food",
        "vibe_tags": ["popular", "must-try"],
        "what_to_order": ["tonkotsu ramen", "extra-firm noodles"],
        "why_special": "Incredible tonkotsu broth",
        "warnings": ["cash only", "long lines on weekends"],
        "best_time_windows": ["weekday lunch"],
        "price_level_hint": 2,
        "confidence": 0.95
      }
    ]
  },
  "confidence": 0.95
}
```

### Canonicalize to Real POIs

```bash
curl -X POST http://localhost:8000/v1/poi/canonicalize \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{"social_post_id": "{post_id}"}'
```

Response:
```json
{
  "created_or_linked_pois": [
    {
      "poi_id": "...",
      "provider_place_id": "ChIJ...",
      "match_confidence": 0.87,
      "name": "Ichiran Shibuya"
    }
  ],
  "unmatched_candidates": []
}
```

### Suggest Detours Along a Route

```bash
curl -X POST http://localhost:8000/v1/detours/suggest \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "origin": {"lat": 35.6812, "lng": 139.7671},
    "destination": {"lat": 35.6580, "lng": 139.7016},
    "time_budget_minutes": 30,
    "max_detour_minutes": 15,
    "intent": "authentic ramen",
    "filters": {
      "category": "food",
      "price_level_max": 3,
      "must_be_open": true
    }
  }'
```

Response:
```json
{
  "suggestions": [
    {
      "poi_id": "...",
      "name": "Ichiran Shibuya",
      "lat": 35.6610,
      "lng": 139.7005,
      "address": "1-22-7 Jinnan, Shibuya City, Tokyo",
      "category": "food",
      "adds_minutes": 4.2,
      "corridor_distance_km": 0.8,
      "social_score": 3.45,
      "why_special": "Incredible tonkotsu broth",
      "what_to_order": ["tonkotsu ramen", "extra-firm noodles"],
      "warnings": ["cash only"],
      "vibe_tags": ["popular", "must-try"],
      "confidence": 0.69,
      "sources_count": {"reddit": 2, "xhs": 1},
      "is_open": true,
      "insert_stop": {"poi_id": "...", "lat": 35.6610, "lng": 139.7005}
    }
  ],
  "corridor_buffer_km": 2.0,
  "note": "Detour times are straight-line estimates. Actual driving time may vary."
}
```

### Full Ingestion Workflow

```bash
# 1. Ingest a post
POST_ID=$(curl -s -X POST http://localhost:8000/v1/social/posts \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{"source":"manual","raw_text":"Amazing ramen at Fuunji near Shinjuku station. The tsukemen is legendary. 30 min wait but worth it."}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 2. Extract place candidates
curl -X POST "http://localhost:8000/v1/social/posts/${POST_ID}/extract" \
  -H "x-api-key: dev-api-key-change-me"

# 3. Canonicalize to real POIs (requires GOOGLE_PLACES_API_KEY)
curl -X POST http://localhost:8000/v1/poi/canonicalize \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d "{\"social_post_id\":\"${POST_ID}\"}"

# 4. Query detour suggestions
curl -X POST http://localhost:8000/v1/detours/suggest \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-change-me" \
  -d '{"origin":{"lat":35.6812,"lng":139.7671},"destination":{"lat":35.6905,"lng":139.6995},"intent":"ramen","filters":{"category":"food"}}'
```

### Batch Seed Ingestion

Populate the POI knowledge base from a local seed file (JSON or CSV) containing posts you've manually collected.

**Example seed file (`seeds.json`):**

```json
[
  {
    "source": "xhs",
    "url": "https://www.xiaohongshu.com/explore/abc123",
    "raw_text": "东京涩谷一兰拉面！豚骨汤底超浓郁，一定要点硬面和溏心蛋。只收现金！工作日中午去人少。",
    "city_hint": "Tokyo",
    "country_hint": "Japan"
  },
  {
    "source": "manual",
    "raw_text": "Amazing tsukemen at Fuunji near Shinjuku station. The dipping broth is legendary. Expect a 30 min wait but worth it. Around 1000 yen.",
    "city_hint": "Tokyo"
  },
  {
    "source": "reddit",
    "url": "https://www.reddit.com/r/JapanTravel/comments/xyz/best_coffee_in_kyoto/",
    "raw_text": "",
    "city_hint": "Kyoto"
  }
]
```

**Example seed file (`seeds.csv`):**

```csv
source,url,raw_text,city_hint,country_hint,posted_at,author
xhs,,Best ramen at Ichiran Shibuya,Tokyo,Japan,,
manual,,Try the matcha parfait at Tsujiri Kyoto,Kyoto,Japan,,
```

**Commands:**

```bash
# Dry run — see what would happen without writing anything
python scripts/seed_ingest.py --file seeds.json --dry-run

# Ingest all rows (extract + canonicalize)
python scripts/seed_ingest.py --file seeds.json

# Only ingest XHS posts
python scripts/seed_ingest.py --file seeds.json --source xhs

# Limit to first 20 rows
python scripts/seed_ingest.py --file seeds.json --limit 20

# Ingest + extract only (skip Places API canonicalization)
python scripts/seed_ingest.py --file seeds.json --skip-canonicalize

# Ingest only (skip extraction and canonicalization)
python scripts/seed_ingest.py --file seeds.json --skip-extract

# Inside Docker container
docker compose exec api python scripts/seed_ingest.py --file /data/seeds.json
```

**Expected summary output:**

```
==================================================
  SEED INGESTION SUMMARY
==================================================
  Total rows in file:       12
  Skipped (filtered):       0
  Inserted posts:           12
  Extracted posts:          11
  Extraction failures:      1
  Canonicalized candidates: 15
  Linked POIs:              9
  Unmatched candidates:     6

  Errors (1):
    - Extraction failed for post abc-123: LLM timeout
==================================================
```

## New Configuration Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_PLACES_API_KEY` | Google Places API key for canonicalization | (required for canonicalize/detours) |
| `PLACES_PROVIDER` | Places API provider | `google` |
| `CORRIDOR_BUFFER_KM` | Detour corridor buffer radius in km | `2.0` |
| `MAX_DETOUR_CANDIDATES` | Max candidates to evaluate per query | `20` |

## API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
