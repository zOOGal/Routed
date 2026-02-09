import { GoogleGenAI } from "@google/genai";
import type { DepthLayerOutput, LearnedPreferences, TripIntent, CityProfile, RouteRecommendation, UserEvent, VenueInfo } from "@shared/schema";
import type { WeatherData } from "../weather-service";
import type { DetourSuggestion } from "../memory-assistant-service";
import { depthLayerOutputSchema, type DepthLayerInput, DEFAULT_LEARNED_PREFERENCES } from "./types";
import {
  generateAgentPresenceLine,
  generateTripFramingLine,
  generateResponsibilityLine,
  generateFallbackDepthOutput,
} from "./templates";
import { generateContextualInsights, shouldShowMemoryCallback, isRushHour, isNightTime } from "./insights";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const DEPTH_SYSTEM_PROMPT = `You generate user-facing context for a navigation app that makes routes feel less overwhelming.

The route has already been selected. Do NOT compare alternatives.

CRITICAL RULES:
1. Never reveal internal identifiers, indices, or labels ("Option 0", "Route 1", array indices).
2. If nearby_places are provided in the input, you MUST include 1-2 as contextualInsights by name, with added time and why they're special (from the provided data). Do NOT invent places.
3. If no nearby_places are provided, do not mention food or stops.

Respond with a JSON object:
{
  "agentPresenceLine": "Conditions awareness (max 80 chars). e.g. 'Clear, 18°C — good for walking.'",
  "tripFramingLine": "Route structure (max 150 chars). e.g. 'Transit to 34th St, then a short walk east.'",
  "contextualInsights": ["Fact 1", "Fact 2"], // 0-4 items, max 120 chars each
  "memoryCallbackLine": "Optional: only if there's a real pattern from past trips",
  "responsibilityLine": "Short reassurance (max 80 chars). e.g. 'Monitoring for delays.'"
}

STYLE: calm, spatial, practical, confident. Max 90 words total across all fields.
- No exclamation marks. No filler. No essay-style reflection.
- Every insight = concrete fact (weather, hours, crowding, distance, or a named nearby place).
- Avoid: "strikes a balance", "allows you to experience", "prioritizes enjoyment".
- If nothing useful to say, return fewer insights. Never pad.
- If nearby_places exist and you don't use them, that is a failure.`;

interface GenerateDepthLayerParams {
  userId?: string;
  learnedPreferences?: LearnedPreferences;
  recentEvents?: UserEvent[];
  intent: TripIntent;
  userNote?: string;
  origin: string;
  destination: string;
  recommendation: RouteRecommendation;
  cityProfile: CityProfile;
  weather: WeatherData;
  venueInfo?: VenueInfo;
  tripCount?: number;
  nearbyPois?: DetourSuggestion[];
}

/**
 * Generate the depth layer output for a trip recommendation
 * Uses deterministic templates first, with optional LLM refinement
 */
export async function generateDepthLayer(params: GenerateDepthLayerParams): Promise<DepthLayerOutput> {
  const {
    userId,
    learnedPreferences = DEFAULT_LEARNED_PREFERENCES,
    recentEvents = [],
    intent,
    userNote,
    origin,
    destination,
    recommendation,
    cityProfile,
    weather,
    venueInfo,
    tripCount = 0,
    nearbyPois,
  } = params;

  const currentTime = new Date();

  // Build input context
  const input: DepthLayerInput = {
    userId,
    learnedPreferences,
    recentEvents,
    intent,
    userNote,
    origin,
    destination,
    recommendation,
    cityProfile,
    weather,
    venueInfo,
    currentTime,
    isRushHour: isRushHour(currentTime),
    isNightTime: isNightTime(currentTime),
  };

  // Generate deterministic base output
  const baseOutput = generateDeterministicOutput(input, tripCount);

  // Try LLM refinement for polishing (optional)
  try {
    const refinedOutput = await refinWithLLM(input, baseOutput, nearbyPois);
    return refinedOutput;
  } catch (error) {
    console.warn("LLM refinement failed, using deterministic output:", error);
    return baseOutput;
  }
}

/**
 * Generate output using deterministic templates
 */
function generateDeterministicOutput(input: DepthLayerInput, tripCount: number): DepthLayerOutput {
  const agentPresenceLine = generateAgentPresenceLine(input);
  const tripFramingLine = generateTripFramingLine(input);
  const contextualInsights = generateContextualInsights(input);
  const responsibilityLine = generateResponsibilityLine(input);

  // Check for memory callback
  const memoryCallback = shouldShowMemoryCallback(input, tripCount);

  return {
    agentPresenceLine,
    tripFramingLine,
    contextualInsights,
    memoryCallbackLine: memoryCallback.shouldShow ? memoryCallback.text : undefined,
    responsibilityLine,
  };
}

/**
 * Optionally refine output with LLM for more natural phrasing
 */
async function refinWithLLM(input: DepthLayerInput, baseOutput: DepthLayerOutput, nearbyPois?: DetourSuggestion[]): Promise<DepthLayerOutput> {
  // Skip LLM for simple cases to save API calls — but always run if we have POIs to surface
  if (baseOutput.contextualInsights.length === 0 && !input.venueInfo && !input.userNote && (!nearbyPois || nearbyPois.length === 0)) {
    return baseOutput;
  }

  const prompt = buildLLMPrompt(input, baseOutput, nearbyPois);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: DEPTH_SYSTEM_PROMPT }] },
        { role: "model", parts: [{ text: "Understood. JSON only, using provided place data if available." }] },
        { role: "user", parts: [{ text: prompt }] },
      ],
    });

    const content = response.text || "";
    const parsed = parseAndValidateLLMOutput(content);

    if (parsed) {
      return parsed;
    }

    return baseOutput;
  } catch (error) {
    console.warn("LLM call failed:", error);
    return baseOutput;
  }
}

/**
 * Build prompt for LLM refinement
 */
function buildLLMPrompt(input: DepthLayerInput, baseOutput: DepthLayerOutput, nearbyPois?: DetourSuggestion[]): string {
  const context: Record<string, unknown> = {
    origin: input.origin,
    destination: input.destination,
    intent: input.intent,
    userNote: input.userNote,
    weather: `${input.weather.condition}, ${input.weather.temperature}C`,
    isRushHour: input.isRushHour,
    isNightTime: input.isNightTime,
    routeMode: input.recommendation.mode,
    duration: input.recommendation.estimatedDuration,
    venueInfo: input.venueInfo
      ? `${input.venueInfo.name}: ${input.venueInfo.isOpenNow ? "open" : "closed"}`
      : null,
  };

  // Include nearby places for the LLM to reference by name
  let placesSection = "";
  if (nearbyPois && nearbyPois.length > 0) {
    const places = nearbyPois.slice(0, 3).map((p) => ({
      name: p.name,
      adds_minutes: p.adds_minutes,
      category: p.category,
      why_special: p.why_special,
      what_to_order: p.what_to_order?.slice(0, 2),
      is_open: p.is_open,
    }));
    placesSection = `
nearby_places (YOU MUST recommend 1-2 of these by name in contextualInsights):
${JSON.stringify(places, null, 2)}`;
  }

  return `
Context:
${JSON.stringify(context, null, 2)}
${placesSection}

Base output (refine for natural phrasing, incorporate nearby_places if provided):
${JSON.stringify(baseOutput, null, 2)}

Generate refined JSON output.`;
}

/**
 * Parse and validate LLM output with Zod
 */
function parseAndValidateLLMOutput(content: string): DepthLayerOutput | null {
  try {
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = depthLayerOutputSchema.parse(parsed);

    return validated;
  } catch (error) {
    console.warn("Failed to parse LLM output:", error);
    return null;
  }
}

/**
 * Generate a simple depth layer without LLM (for testing or fallback)
 */
export function generateSimpleDepthLayer(params: GenerateDepthLayerParams): DepthLayerOutput {
  const input: DepthLayerInput = {
    userId: params.userId,
    learnedPreferences: params.learnedPreferences || DEFAULT_LEARNED_PREFERENCES,
    recentEvents: params.recentEvents || [],
    intent: params.intent,
    userNote: params.userNote,
    origin: params.origin,
    destination: params.destination,
    recommendation: params.recommendation,
    cityProfile: params.cityProfile,
    weather: params.weather,
    venueInfo: params.venueInfo,
    currentTime: new Date(),
    isRushHour: isRushHour(new Date()),
    isNightTime: isNightTime(new Date()),
  };

  return generateDeterministicOutput(input, params.tripCount || 0);
}
