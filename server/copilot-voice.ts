/**
 * ROUTED COPILOT VOICE
 *
 * Defines the persona and decision philosophy for user-facing output.
 *
 * ROLE: Urban mobility copilot — a local buddy, not a GPS.
 *
 * PRINCIPLES:
 * 1. Context-aware decisions (purpose, preferences, constraints)
 * 2. Time/place awareness (hours, closures, safety, crowding)
 * 3. Weather/comfort awareness (temperature, rain, walking)
 * 4. Offer alternatives when primary plan is fragile
 * 5. Friendly, grounded, concise — not robotic
 *
 * NEVER:
 * - Output generic filler ("Take transit to reach your destination")
 * - Assume facts without stating assumptions
 * - Reveal internal reasoning verbatim
 * - Ignore mismatches (wrong city/currency)
 */

import type { RouteRecommendation, TripIntent, CityProfile, DepthLayerOutput } from "@shared/schema";
import type { WeatherData } from "./weather-service";
import type { VenueInfo } from "./venue-service";
import type { DecisionContext } from "./route-scoring";

// ============================================
// COPILOT EXPLANATION TEMPLATES
// ============================================

interface CopilotContext {
  intent: TripIntent;
  userNote?: string;
  weather: WeatherData;
  venueInfo?: VenueInfo;
  recommendation: RouteRecommendation;
  decision: DecisionContext;
  cityProfile: CityProfile;
  isRushHour: boolean;
  isNightTime: boolean;
}

/**
 * Generate a personalized, context-aware explanation
 * This replaces generic "I chose this route because..." with actual reasoning
 */
export function generateCopilotExplanation(ctx: CopilotContext): string {
  const parts: string[] = [];

  // Start with the core decision reason (but make it conversational)
  const coreReason = buildCoreReason(ctx);
  if (coreReason) parts.push(coreReason);

  // Add weather context if relevant
  const weatherNote = buildWeatherNote(ctx);
  if (weatherNote) parts.push(weatherNote);

  // Add time-sensitive context
  const timeNote = buildTimeNote(ctx);
  if (timeNote) parts.push(timeNote);

  // Add venue-specific note
  const venueNote = buildVenueNote(ctx);
  if (venueNote) parts.push(venueNote);

  // Combine with natural flow
  if (parts.length === 0) {
    return "This should get you there comfortably.";
  }

  return parts.join(" ");
}

function buildCoreReason(ctx: CopilotContext): string | null {
  const { recommendation, decision, intent } = ctx;
  const { archetype } = recommendation.decisionMetadata || {};

  // If only one option, be honest
  if (decision.wasOnlyOption) {
    if (recommendation.mode === "transit") {
      return "This is the most reliable option right now.";
    }
    return "This is what's available for this route.";
  }

  // Intent-driven reasoning
  if (intent === "work" || intent === "appointment") {
    if (archetype === "fast") {
      return "Fastest way to get there on time.";
    }
    return "Reliable timing for your schedule.";
  }

  if (intent === "leisure" || intent === "exploring") {
    if (archetype === "calm") {
      return "Easy route — no rush, minimal transfers.";
    }
    return "A comfortable way to get there.";
  }

  if (intent === "time_sensitive") {
    return "Optimized for getting there quickly.";
  }

  // Note-driven reasoning
  if (decision.noteInfluence) {
    // Extract the essence without "Since you said..."
    if (ctx.userNote?.toLowerCase().includes("tired")) {
      return "Kept it simple — less walking.";
    }
    if (ctx.userNote?.toLowerCase().includes("date")) {
      return "A relaxed route so you arrive composed.";
    }
    if (ctx.userNote?.toLowerCase().includes("luggage") || ctx.userNote?.toLowerCase().includes("bags")) {
      return "Minimal stairs and transfers for your bags.";
    }
  }

  // Archetype-based fallback
  if (archetype === "calm") {
    return "Straightforward route, easy to follow.";
  }
  if (archetype === "fast") {
    return "Quickest option available.";
  }
  if (archetype === "comfort") {
    return "Prioritized comfort over speed.";
  }

  return null;
}

function buildWeatherNote(ctx: CopilotContext): string | null {
  const { weather, recommendation } = ctx;
  const walkingMinutes = recommendation.steps
    .filter(s => s.type === "walk")
    .reduce((sum, s) => sum + s.duration, 0);

  if (!weather.isOutdoorFriendly && walkingMinutes > 5) {
    if (weather.condition.includes("rain")) {
      return `${walkingMinutes} min outdoors — might want an umbrella.`;
    }
    if (weather.temperature < 5) {
      return `Bundle up — ${walkingMinutes} min outside in the cold.`;
    }
    if (weather.temperature > 30) {
      return `It's hot — ${walkingMinutes} min of walking.`;
    }
    return `${walkingMinutes} min of outdoor walking.`;
  }

  // Good weather, longer walk is fine
  if (weather.isOutdoorFriendly && walkingMinutes > 10) {
    return "Nice weather for the walk.";
  }

  return null;
}

function buildTimeNote(ctx: CopilotContext): string | null {
  const { isRushHour, isNightTime, recommendation } = ctx;

  if (isRushHour && recommendation.mode === "transit") {
    return "Rush hour — might be crowded.";
  }

  if (isNightTime && recommendation.mode === "walk") {
    return "Late hour — stay aware of your surroundings.";
  }

  if (isNightTime && recommendation.mode === "transit") {
    return "Trains run less frequently this late.";
  }

  return null;
}

function buildVenueNote(ctx: CopilotContext): string | null {
  const { venueInfo, recommendation } = ctx;

  if (!venueInfo) return null;

  // Venue closes soon
  if (venueInfo.closingTime) {
    const now = new Date();
    const [hours, minutes] = venueInfo.closingTime.split(":").map(Number);
    const closeTime = new Date();
    closeTime.setHours(hours, minutes, 0, 0);

    const arrivalTime = new Date(now.getTime() + recommendation.estimatedDuration * 60000);
    const timeToClose = (closeTime.getTime() - arrivalTime.getTime()) / 60000;

    if (timeToClose < 30 && timeToClose > 0) {
      return `Heads up: ${venueInfo.name} closes in about ${Math.round(timeToClose + recommendation.estimatedDuration)} min.`;
    }
    if (timeToClose <= 0) {
      return `${venueInfo.name} might be closed by the time you arrive.`;
    }
  }

  if (!venueInfo.isOpenNow) {
    return `Note: ${venueInfo.name} appears to be closed right now.`;
  }

  return null;
}

// ============================================
// TRIP FRAMING (one-liner summary)
// ============================================

/**
 * Generate a natural one-liner that frames the trip
 * Not a repeat of the route, but the "feel" of it
 */
export function generateTripFraming(ctx: CopilotContext): string {
  const { recommendation, intent } = ctx;
  const { steps, estimatedDuration } = recommendation;

  const walkSteps = steps.filter(s => s.type === "walk");
  const transitSteps = steps.filter(s => s.type === "transit");
  const totalWalkMin = walkSteps.reduce((sum, s) => sum + s.duration, 0);
  const transferCount = Math.max(0, transitSteps.length - 1);

  // Very short trip
  if (estimatedDuration <= 10) {
    if (steps.length === 1 && steps[0].type === "walk") {
      return "Quick walk, you're basically there.";
    }
    return "Short hop — you'll be there in no time.";
  }

  // Transit-heavy
  if (transitSteps.length > 0) {
    if (transferCount === 0) {
      if (totalWalkMin <= 5) {
        return "Straight shot — one ride, minimal walking.";
      }
      return "One train, bookended by short walks.";
    }
    if (transferCount === 1) {
      return "One transfer, straightforward route.";
    }
    return `A few connections, but manageable.`;
  }

  // Walk-only
  if (transitSteps.length === 0 && walkSteps.length > 0) {
    if (totalWalkMin <= 15) {
      return "Nice walk — enjoy the stroll.";
    }
    return "Longer walk, but doable.";
  }

  // Rideshare
  if (recommendation.mode === "rideshare") {
    return "Door to door — sit back and ride.";
  }

  return "Here's your route.";
}

// ============================================
// ALTERNATIVE SUGGESTIONS
// ============================================

interface AlternativeSuggestion {
  reason: string;
  suggestion: string;
}

/**
 * Suggest alternatives when the primary plan has risks
 */
export function suggestAlternatives(ctx: CopilotContext): AlternativeSuggestion[] {
  const suggestions: AlternativeSuggestion[] = [];
  const { weather, venueInfo, recommendation, isRushHour, isNightTime } = ctx;

  // Weather risk
  if (!weather.isOutdoorFriendly && recommendation.mode === "walk") {
    suggestions.push({
      reason: "weather",
      suggestion: "Consider transit or rideshare if the weather worsens.",
    });
  }

  // Venue closing soon
  if (venueInfo && !venueInfo.isOpenNow) {
    suggestions.push({
      reason: "closed",
      suggestion: "You might want to call ahead to confirm they're open.",
    });
  }

  // Rush hour crowding
  if (isRushHour && recommendation.mode === "transit") {
    suggestions.push({
      reason: "crowding",
      suggestion: "If crowds stress you out, rideshare might be calmer.",
    });
  }

  // Night safety
  if (isNightTime && recommendation.mode === "walk") {
    const walkMin = recommendation.steps
      .filter(s => s.type === "walk")
      .reduce((sum, s) => sum + s.duration, 0);
    if (walkMin > 10) {
      suggestions.push({
        reason: "safety",
        suggestion: "For a late walk, you might prefer a ride.",
      });
    }
  }

  return suggestions;
}

// ============================================
// VALIDATION: Catch mismatches before output
// ============================================

export interface OutputValidation {
  valid: boolean;
  issues: string[];
  corrections: string[];
}

/**
 * Validate the output matches the context
 * Catch currency/city mismatches before they reach the user
 */
export function validateCopilotOutput(
  cityId: string,
  recommendation: RouteRecommendation
): OutputValidation {
  const issues: string[] = [];
  const corrections: string[] = [];

  // Check for wrong currency symbols
  const costDisplay = recommendation.costDisplay || "";
  if (cityId === "nyc" && costDisplay.includes("€")) {
    issues.push("EUR currency shown for NYC");
    corrections.push("Cost display should use $, not €");
  }
  if (cityId === "berlin" && costDisplay.includes("$") && !costDisplay.includes("C$") && !costDisplay.includes("A$")) {
    issues.push("USD currency shown for Berlin");
    corrections.push("Cost display should use €, not $");
  }

  // Check for wrong transit names in summary
  const summary = recommendation.summary || "";
  if (cityId === "nyc" && (summary.includes("U-Bahn") || summary.includes("S-Bahn"))) {
    issues.push("German transit names in NYC route");
    corrections.push("Should use Subway, not U-Bahn/S-Bahn");
  }
  if (cityId === "berlin" && summary.includes("MTA")) {
    issues.push("NYC transit names in Berlin route");
    corrections.push("Should use BVG, not MTA");
  }

  return {
    valid: issues.length === 0,
    issues,
    corrections,
  };
}
