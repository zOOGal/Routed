# Movi - AI Mobility Agent

## Overview
Movi is an AI-powered mobility agent that helps users decide the best way to travel in cities. Unlike traditional maps apps, Movi optimizes for **stress and cognitive load** rather than just speed.

### Core Philosophy
- **Opinionated**: Single best recommendation, not multiple options
- **Stress-First**: Prioritizes calm, low-stress journeys
- **Agentic**: Decides, adapts, and explains its reasoning
- **Context-Aware**: Learns user preferences and city familiarity

## Architecture

### Layers
1. **User & Memory Layer** - User preferences, city familiarity scores, behavioral signals
2. **Agent Reasoning Layer** - Gemini-powered AI for route decisions
3. **City Mobility Intelligence** - City profiles with cognitive load scoring (NYC, Tokyo, London)
4. **Execution Layer** - Trip state machine (planned → in_progress → completed)
5. **API & Frontend Layer** - REST API + React mobile-first UI

### Tech Stack
- **Frontend**: React, TypeScript, Tailwind CSS, Shadcn UI, Wouter, TanStack Query
- **Backend**: Node.js, Express
- **AI**: Google Gemini (via Replit AI Integrations)
- **Storage**: In-memory (MVP), designed for easy PostgreSQL migration

## Project Structure

```
├── client/src/
│   ├── components/     # Reusable UI components
│   │   ├── city-selector.tsx
│   │   ├── location-input.tsx
│   │   ├── route-card.tsx
│   │   ├── trip-step.tsx
│   │   ├── stress-meter.tsx
│   │   └── ...
│   ├── pages/          # Page components
│   │   ├── home.tsx    # Main trip planning
│   │   ├── trip.tsx    # Trip execution view
│   │   ├── preferences.tsx
│   │   └── history.tsx
│   └── lib/            # Utilities and providers
├── server/
│   ├── routes.ts       # API endpoints
│   ├── storage.ts      # Data persistence layer
│   ├── agent-service.ts    # Gemini AI integration
│   └── city-intelligence.ts # City profiles
└── shared/
    └── schema.ts       # Shared types and schemas
```

## API Endpoints

### Agent
- `POST /api/agent/recommend` - Get AI route recommendation

### Cities
- `GET /api/cities` - List all supported cities
- `GET /api/cities/:id` - Get city profile

### Users
- `GET /api/users/preferences` - Get user preferences
- `PUT /api/users/preferences` - Update preferences

### Trips
- `GET /api/trips` - List all trips
- `GET /api/trips/:id` - Get trip details
- `POST /api/trips/:id/start` - Start a trip
- `POST /api/trips/:id/step/complete` - Complete current step
- `POST /api/trips/:id/cancel` - Cancel trip
- `POST /api/trips/:id/replan` - Get new recommendation

## City Intelligence

Each city has a profile including:
- Complex stations to avoid
- Night reliability score
- Transit vs taxi preference
- Walking friendliness
- Cognitive Load Index (navigation, signage, crowding)

Currently supported: NYC, Tokyo, London

## User Preferences

- **Walking Tolerance**: 1-5 scale
- **Transfer Tolerance**: 1-5 scale
- **Stress vs Speed Bias**: 0-1 (higher = less stress)
- **Cost Sensitivity**: 1-5 scale

## Development

### Running Locally
The app runs on port 5000 with the `npm run dev` command.

### Adding New Cities
Edit `server/city-intelligence.ts` to add new city profiles.

### Future Phases
- PostgreSQL persistence
- User authentication
- Real-time transit data integration
- More cities
- Native mobile apps
