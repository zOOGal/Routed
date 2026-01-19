import { GoogleGenAI } from "@google/genai";
import { getCityProfile, calculateCognitiveLoad } from "./city-intelligence";
import { storage } from "./storage";
import type { 
  AgentRequest, 
  RouteRecommendation, 
  RouteStep,
  CityProfile 
} from "@shared/schema";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const SYSTEM_PROMPT = `You are Movi, a calm and confident AI mobility agent. Your job is to decide the best way for a user to travel in a city, optimizing for low stress and cognitive load rather than just speed.

Core Principles:
1. OPINIONATED: Always recommend ONE best option, not multiple choices
2. STRESS-FIRST: Prioritize reducing mental load over saving time
3. CONTEXT-AWARE: Consider the city, time of day, and user preferences
4. EXPLAINABLE: Always explain your reasoning in a friendly, conversational way

When making recommendations:
- Consider walking friendliness of the city
- Avoid complex transit stations when possible, especially for unfamiliar users
- Factor in night-time reliability of transit
- Consider cost sensitivity
- Account for user's walking and transfer tolerance

You must respond with a valid JSON object matching this exact structure:
{
  "mode": "transit" | "rideshare" | "walk" | "bike" | "mixed",
  "summary": "A brief 1-sentence summary of the journey",
  "estimatedDuration": number (in minutes),
  "estimatedCost": number | null (in local currency, null if free),
  "stressScore": number (0-1, where 0 is very relaxing and 1 is very stressful),
  "reasoning": "A friendly 2-3 sentence explanation of why this is the best choice",
  "confidence": number (0-1),
  "steps": [
    {
      "type": "walk" | "transit" | "rideshare" | "wait" | "transfer",
      "instruction": "Clear instruction for this step",
      "duration": number (in minutes),
      "distance": number (in meters, optional),
      "line": "transit line name (optional)",
      "direction": "direction/destination of transit (optional)",
      "stopsCount": number (optional),
      "deepLink": "app deep link for rideshare (optional)"
    }
  ]
}

Be warm, supportive, and make the user feel confident about their journey.`;

interface UserContext {
  walkingTolerance: number;
  transferTolerance: number;
  stressVsSpeedBias: number;
  costSensitivity: number;
  cityFamiliarity: number;
}

async function getUserContext(userId?: string, cityId?: string): Promise<UserContext> {
  const defaultContext: UserContext = {
    walkingTolerance: 3,
    transferTolerance: 3,
    stressVsSpeedBias: 0.7,
    costSensitivity: 3,
    cityFamiliarity: 0.3,
  };

  if (!userId) return defaultContext;

  const user = await storage.getUser(userId);
  if (!user) return defaultContext;

  let cityFamiliarity = 0.3;
  if (cityId) {
    const familiarity = await storage.getUserCityFamiliarity(userId, cityId);
    if (familiarity) {
      cityFamiliarity = familiarity.familiarityScore || 0.3;
    }
  }

  return {
    walkingTolerance: user.walkingTolerance || 3,
    transferTolerance: user.transferTolerance || 3,
    stressVsSpeedBias: user.stressVsSpeedBias || 0.7,
    costSensitivity: user.costSensitivity || 3,
    cityFamiliarity,
  };
}

function buildPrompt(
  request: AgentRequest,
  cityProfile: CityProfile,
  userContext: UserContext
): string {
  const isNightTime = (() => {
    const now = new Date();
    const hour = now.getHours();
    return hour < 6 || hour >= 22;
  })();

  return `
User wants to travel in ${cityProfile.name}:
- From: ${request.origin}
- To: ${request.destination}
${request.departureTime ? `- Departure: ${request.departureTime}` : "- Departure: Now"}

City Context:
- Walking friendliness: ${(cityProfile.walkingFriendliness * 100).toFixed(0)}%
- Transit vs taxi preference: ${(cityProfile.transitVsTaxiBias * 100).toFixed(0)}% transit-leaning
- Night reliability: ${(cityProfile.nightReliability * 100).toFixed(0)}%
- Complex stations to avoid: ${cityProfile.complexStations.join(", ")}
- Available transit: ${cityProfile.transitTypes.join(", ")}
- Rideshare apps: ${cityProfile.rideshareApps.join(", ")}
${isNightTime ? "- It is currently nighttime" : ""}

User Preferences:
- Walking tolerance: ${userContext.walkingTolerance}/5 (${userContext.walkingTolerance >= 4 ? "enjoys walking" : userContext.walkingTolerance <= 2 ? "prefers minimal walking" : "moderate"})
- Transfer tolerance: ${userContext.transferTolerance}/5 (${userContext.transferTolerance >= 4 ? "comfortable with transfers" : userContext.transferTolerance <= 2 ? "avoids transfers" : "moderate"})
- Stress vs Speed: ${(userContext.stressVsSpeedBias * 100).toFixed(0)}% stress-focused (${userContext.stressVsSpeedBias >= 0.7 ? "strongly prefers calm journeys" : userContext.stressVsSpeedBias <= 0.3 ? "prioritizes speed" : "balanced"})
- Cost sensitivity: ${userContext.costSensitivity}/5 (${userContext.costSensitivity >= 4 ? "budget-conscious" : userContext.costSensitivity <= 2 ? "cost not a concern" : "moderate"})
- City familiarity: ${(userContext.cityFamiliarity * 100).toFixed(0)}% (${userContext.cityFamiliarity >= 0.7 ? "knows the city well" : userContext.cityFamiliarity <= 0.3 ? "unfamiliar with the city" : "somewhat familiar"})

Based on all this context, recommend the SINGLE best way to make this journey. Focus on reducing stress and cognitive load while respecting the user's preferences.

Respond ONLY with a valid JSON object matching the specified structure.`;
}

function parseAgentResponse(content: string): RouteRecommendation | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.mode || !parsed.summary || !parsed.steps) {
      return null;
    }

    return {
      mode: parsed.mode,
      summary: parsed.summary,
      estimatedDuration: parsed.estimatedDuration || 30,
      estimatedCost: parsed.estimatedCost,
      stressScore: Math.min(1, Math.max(0, parsed.stressScore || 0.5)),
      steps: parsed.steps.map((step: any) => ({
        type: step.type || "walk",
        instruction: step.instruction || "",
        duration: step.duration || 5,
        distance: step.distance,
        line: step.line,
        direction: step.direction,
        stopsCount: step.stopsCount,
        deepLink: step.deepLink,
      })),
      reasoning: parsed.reasoning || "I've selected what I believe is the best option for you.",
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.8)),
      alternatives: parsed.alternatives,
    };
  } catch (error) {
    console.error("Failed to parse agent response:", error);
    return null;
  }
}

export async function getRecommendation(
  request: AgentRequest
): Promise<RouteRecommendation> {
  const cityProfile = getCityProfile(request.cityId);
  if (!cityProfile) {
    throw new Error(`Unknown city: ${request.cityId}`);
  }

  const userContext = await getUserContext(request.userId, request.cityId);
  const prompt = buildPrompt(request, cityProfile, userContext);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
        { role: "model", parts: [{ text: "I understand. I am Movi, a calm and confident AI mobility agent. I will provide stress-optimized, opinionated travel recommendations with clear JSON output." }] },
        { role: "user", parts: [{ text: prompt }] },
      ],
    });

    const content = response.text || "";
    const recommendation = parseAgentResponse(content);

    if (!recommendation) {
      return generateFallbackRecommendation(request, cityProfile, userContext);
    }

    return recommendation;
  } catch (error) {
    console.error("Agent reasoning error:", error);
    return generateFallbackRecommendation(request, cityProfile, userContext);
  }
}

function generateFallbackRecommendation(
  request: AgentRequest,
  cityProfile: CityProfile,
  userContext: UserContext
): RouteRecommendation {
  const preferTransit = cityProfile.transitVsTaxiBias >= 0.5;
  const mode = preferTransit ? "transit" : "rideshare";

  const steps: RouteStep[] = preferTransit
    ? [
        {
          type: "walk",
          instruction: `Walk to the nearest ${cityProfile.transitTypes[0]} station`,
          duration: 5,
          distance: 400,
        },
        {
          type: "transit",
          instruction: `Take the ${cityProfile.transitTypes[0]} towards your destination`,
          duration: 20,
          line: cityProfile.transitTypes[0],
          stopsCount: 8,
        },
        {
          type: "walk",
          instruction: `Walk to ${request.destination}`,
          duration: 5,
          distance: 400,
        },
      ]
    : [
        {
          type: "rideshare",
          instruction: `Take ${cityProfile.rideshareApps[0]} to ${request.destination}`,
          duration: 25,
          deepLink: `uber://`,
        },
      ];

  return {
    mode,
    summary: `Take ${mode === "transit" ? cityProfile.transitTypes[0] : cityProfile.rideshareApps[0]} to reach your destination`,
    estimatedDuration: steps.reduce((acc, s) => acc + s.duration, 0),
    estimatedCost: mode === "transit" ? 3 : 25,
    stressScore: mode === "transit" ? 0.4 : 0.3,
    steps,
    reasoning: `Based on ${cityProfile.name}'s excellent ${mode} network and your preferences, this is a reliable way to reach your destination with minimal stress.`,
    confidence: 0.7,
  };
}

export async function replanTrip(
  tripId: string,
  reason: "delay" | "weather" | "missed_step" | "user_request"
): Promise<RouteRecommendation | null> {
  const trip = await storage.getTrip(tripId);
  if (!trip) return null;

  return getRecommendation({
    origin: trip.originName,
    destination: trip.destinationName,
    cityId: trip.cityId,
    userId: trip.userId || undefined,
  });
}
