# Movi - AI Mobility Agent

## Overview
Movi is an AI-powered mobility agent that helps users decide the best way to travel in cities. Unlike traditional maps apps, Movi optimizes for **stress and cognitive load** rather than just speed.

### Core Philosophy
- **Opinionated**: Single best recommendation, not multiple options
- **Stress-First**: Prioritizes calm, low-stress journeys
- **Agentic**: Decides, adapts, and explains its reasoning
- **Context-Aware**: Learns user preferences and city familiarity

## Design System - Wabi-Sabi Aesthetic

The UI follows the Japanese aesthetic philosophy of Wabi-Sabi, emphasizing:

### Principles Applied
- **Kanso (Simplicity)**: Generous negative space, minimal UI elements
- **Fukinsei (Asymmetry)**: Slightly off-center layouts, organic border radii
- **Shibui (Quiet Beauty)**: Muted earthy colors, subtle interactions
- **Shizen (Naturalness)**: Paper texture background, organic shapes
- **Yūgen (Subtle Depth)**: Progressive disclosure, gentle animations
- **Seijaku (Tranquility)**: Calm pacing, breathing animations

### Color Palette
- **Light Mode**: Warm cream backgrounds (HSL 40 30% 96%), sage green primary (HSL 150 25% 42%)
- **Dark Mode**: Warm charcoal (HSL 30 15% 10%), softer sage accents

### Typography
- Lowercase, humble microcopy throughout
- Humanist sans-serif (Inter)
- Generous line spacing

### Animations
- `animate-gentle-fade`: Subtle fade-in with slight vertical movement
- `animate-breathe`: Pulsing opacity for loading states

## Architecture

### Layers
1. **User & Memory Layer** - User preferences, city familiarity scores, behavioral signals
2. **Agent Reasoning Layer** - Gemini-powered AI for route decisions
3. **City Mobility Intelligence** - City profiles with cognitive load scoring (NYC, Tokyo, Berlin)
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
│   │   ├── city-selector.tsx      # City dropdown (muted styling)
│   │   ├── preference-sliders.tsx # Calm/Fast, Economy/Comfort sliders
│   │   ├── route-card.tsx         # Route recommendation display
│   │   ├── loading-state.tsx      # Breathing circle animation
│   │   ├── empty-state.tsx        # Minimal empty states
│   │   └── ...
│   ├── pages/          # Page components
│   │   ├── home.tsx    # Main trip planning (Wabi-Sabi design)
│   │   ├── trip.tsx    # Trip execution view
│   │   ├── preferences.tsx
│   │   └── history.tsx
│   └── lib/            # Utilities and providers
├── server/
│   ├── routes.ts       # API endpoints
│   ├── storage.ts      # Data persistence layer
│   ├── agent-service.ts    # Gemini AI integration with slider enforcement
│   └── city-intelligence.ts # City profiles (NYC, Tokyo, Berlin)
└── shared/
    └── schema.ts       # Shared types and schemas
```

## API Endpoints

### Agent
- `POST /api/agent/recommend` - Get AI route recommendation
  - Body: origin, destination, cityId, calmVsFast, economyVsComfort, unfamiliarWithCity, userNote (optional)

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

Currently supported: NYC, Tokyo, Berlin

## User Preferences

### Real-time Preferences (always visible for practical usability)
- **Calm ↔ Fast**: 0-100 slider with icons (Leaf/Zap) - 0 = prioritize calm, 100 = prioritize speed
- **Economy ↔ Comfort**: 0-100 slider with icons (Wallet/Sparkles) - 0 = cheapest, 100 = most comfortable
- **City Familiarity Toggle**: "I'm new to this city" - simpler routes when enabled
- **Optional Note**: Hidden behind toggle, context for AI (e.g., "heavy luggage")
- **Preference Summary**: Live feedback showing current settings ("prefer calm", "budget-friendly")

### Slider Enforcement
- Economy ≤ 30: System enforces transit/walking (never rideshare)
- Economy > 30: AI chooses based on conditions

### Saved Preferences (in Preferences page)
- **Walking Tolerance**: 1-5 scale
- **Transfer Tolerance**: 1-5 scale
- **Stress vs Speed Bias**: 0-1 (higher = less stress)
- **Cost Sensitivity**: 1-5 scale

## Development

### Running Locally
The app runs on port 5000 with the `npm run dev` command.

### Adding New Cities
Edit `server/city-intelligence.ts` to add new city profiles.

### Design Guidelines
- Maintain lowercase microcopy throughout the UI
- Use organic border-radii (slightly imperfect)
- Preserve generous negative space
- Keep animations subtle and calming

### Future Phases
- PostgreSQL persistence
- User authentication
- Real-time transit data integration
- More cities
- Native mobile apps
