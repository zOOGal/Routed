# Routed

> Your personal AI mobility agent that decides the best way for you to move in any city — optimized for stress, not just speed.

Routed combines real Google Maps routing data with Gemini AI to produce context-aware multimodal travel recommendations that factor in weather, time of day, personal preferences, and trip intent.

---

## Setup

### Prerequisites

- **Node.js** ≥ 18
- **npm** (ships with Node)
- A **Google Cloud** project with Directions API + Places API enabled
- A **Gemini** API key (free at [AI Studio](https://aistudio.google.com/app/apikey))

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

| Variable | Description |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Google Maps Directions / Places key |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Gemini AI key for route reasoning |

Optional keys (features degrade gracefully without them):

| Variable | Description |
|---|---|
| `OPENWEATHER_API_KEY` | Real-time weather data |
| `DATABASE_URL` | PostgreSQL connection string |
| `MEMORY_ASSISTANT_URL` | Memory-assistant sidecar URL |
| `MEMORY_ASSISTANT_API_KEY` | Memory-assistant auth key |

> **Do not commit `.env`.** It is git-ignored. Use `.env.example` as the reference.

### 3. Run in development

```bash
npm run dev
```

The app serves both the API and the React client on `http://localhost:5001`.

### 4. Build for production

```bash
npm run build
npm start
```

---

## Project Structure

```
client/          React (Vite) frontend
server/          Express API + AI agent service
shared/          Shared TypeScript schemas
packages/        Core orchestrator & skills
memory-assistant/ Python sidecar for semantic memory (optional)
```

---

## License

MIT
