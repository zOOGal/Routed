# Routed

A mobility agent that makes the transit decision so you don't have to.

## What it does

Routed takes an origin, destination, and trip intent, then returns a single opinionated route recommendation. It factors in current weather, city-local time, venue hours, and user preferences to minimize cognitive load rather than optimize for speed. The user never compares options — the system decides.

## Why Gemini

Gemini is used as a constrained decision engine, not a chatbot. It does not generate routes or invent data. It receives pre-scored route candidates with real context (weather, time of day, venue status, user intent) and selects the best one with a short, grounded explanation.

- **Structured input, structured output.** Gemini receives a JSON payload of scored candidates and environmental context. It returns a mode selection, a one-sentence reason, and a confidence score. Output is validated against a schema; malformed responses are rejected.
- **Grounded reasoning.** The system prompt requires all reasoning to reference actual conditions from the input. Atmospheric adjectives ("pleasant", "lovely") are stripped from output post-hoc.
- **Deterministic fallback.** If Gemini is unavailable, slow, or returns invalid output, a heuristic scorer selects the route using the same data. The app works without an API key.
- **Depth layer generation.** Gemini produces a contextual framing line and 2-3 local insights per trip, grounded in city profile data and current conditions.

## Setup

### Prerequisites

- Node.js 18+
- Python 3.9+ (optional, for the memory sidecar)
- Google Maps API key
- Gemini API key

### Running locally

```bash
cp .env.example .env   # Fill in your API keys — secrets are not committed
npm install
npm run dev            # Client + server on port 5001
```

The memory sidecar (optional, for semantic memory and POI detours) runs separately:

```bash
cd memory-assistant
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

It requires PostgreSQL with pgvector. See `.env.example` for the full set of configuration variables.

### Tests

```bash
npx vitest run   # 481 tests, 27 files
```

## Project structure

```
client/              React + Vite + Tailwind frontend
server/              Express API, route scoring, Gemini decision engine, venue/weather services
packages/core/       Shared logic: orchestrator, ride broker, entitlements, learning engine
memory-assistant/    Python sidecar (FastAPI + pgvector) for semantic memory and POI data
shared/              TypeScript types shared between client and server
```

The Python sidecar exists because the POI pipeline and semantic memory use pgvector embeddings, which are simpler to manage with SQLAlchemy and Alembic than from Node.

## How it works

1. **Context resolution.** The server resolves city-local time, weather, venue hours, and user profile before any routing begins. If the destination is closed, routing is skipped entirely.

2. **Route candidates.** Google Maps Directions API returns transit, walking, and driving options. Each is scored on three axes — calm (low cognitive load), fast (time), and comfort (weather/walking exposure) — weighted by trip intent.

3. **Gemini selection.** When candidates are close in score, Gemini breaks the tie using the full environmental context. When they are not close, the deterministic scorer decides without an LLM call.

4. **Ride broker.** If the selected mode is rideshare, quotes are aggregated from available providers, scored server-side (price, ETA, user context), and a single option is presented. The user selects a tier, not a provider.

5. **Detour suggestions.** If the user's note mentions food or drink preferences, curated POIs along the corridor are filtered by typed intent (coffee vs. brunch vs. cuisine). If none match, a Google Places fallback is used.

## Supported cities

New York, Berlin, Tokyo. Each has city-specific transit naming, local provider catalogs, timezone handling, and currency formatting.

## Prototype note

This is a proof of concept. Ride booking uses a simulated provider — no real driver is dispatched. Some venue hours are approximated. The UI labels simulated features accordingly.

## License

MIT
