import { GoogleGenAI } from "@google/genai";
import { getCityProfile, calculateCognitiveLoad } from "./city-intelligence";
import { storage } from "./storage";
import type { 
  AgentRequest, 
  RouteRecommendation, 
  RouteStep,
  CityProfile,
  TravelMood
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
3. MOOD-AWARE: Adapt recommendations based on user's current emotional state
4. CONTEXT-AWARE: Consider weather, traffic, time of day, and real-world conditions
5. EXPLAINABLE: Always explain your reasoning in a friendly, conversational way

When making recommendations:
- Consider walking friendliness of the city
- Avoid complex transit stations when possible, especially for unfamiliar users
- Factor in night-time reliability of transit
- Consider cost sensitivity
- Account for user's walking and transfer tolerance
- CRITICAL: Adapt to user's current mood:
  - "relaxed": Prioritize scenic, calm routes even if slower
  - "normal": Balance comfort and efficiency
  - "hurry": Speed is top priority, tolerate more stress
  - "tired": Minimize walking, prefer sitting (taxis/rideshare ok)
  - "adventurous": Suggest interesting routes with local flavor

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

function getMoodDescription(mood: TravelMood | undefined): string {
  switch (mood) {
    case "relaxed":
      return "The user is feeling RELAXED - they're in no rush and would prefer a calm, scenic route even if it takes longer. Avoid stressful transfers or crowded routes.";
    case "hurry":
      return "The user is IN A HURRY - speed is the top priority. It's okay to suggest faster but slightly more stressful options like express trains or rideshare.";
    case "tired":
      return "The user is TIRED - minimize walking at all costs. Prefer options where they can sit down (rideshare, taxi, or direct transit with minimal walking). Avoid stairs and long walks.";
    case "adventurous":
      return "The user is feeling ADVENTUROUS - suggest interesting routes that offer local flavor or scenic views. They're open to walking through interesting neighborhoods or trying local transit experiences.";
    default:
      return "The user is in a NORMAL mood - balance comfort and efficiency. Standard stress-optimized routing applies.";
  }
}

function getSimulatedWeather(cityId: string): { condition: string; advice: string } {
  // In production, this would call a weather API
  // For now, simulate based on time and randomness for demo
  const hour = new Date().getHours();
  const conditions = ["clear", "cloudy", "light rain", "hot", "cold"];
  const randomIndex = (cityId.charCodeAt(0) + hour) % conditions.length;
  const condition = conditions[randomIndex];
  
  let advice = "";
  switch (condition) {
    case "light rain":
      advice = "It's raining - consider covered walking routes or rideshare to stay dry.";
      break;
    case "hot":
      advice = "It's hot outside - minimize outdoor walking and prefer air-conditioned transport.";
      break;
    case "cold":
      advice = "It's cold - minimize waiting outdoors and prefer heated transit or rideshare.";
      break;
    default:
      advice = "Weather is pleasant for outdoor travel.";
  }
  return { condition, advice };
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

  const weather = getSimulatedWeather(request.cityId);
  const moodDescription = getMoodDescription(request.mood);

  return `
User wants to travel in ${cityProfile.name}:
- From: ${request.origin}
- To: ${request.destination}
${request.departureTime ? `- Departure: ${request.departureTime}` : "- Departure: Now"}

CURRENT MOOD (IMPORTANT):
${moodDescription}

REAL-TIME CONDITIONS:
- Weather: ${weather.condition} - ${weather.advice}
- Time: ${isNightTime ? "Nighttime (late evening or early morning)" : "Daytime"}
${isNightTime ? `- Night reliability in ${cityProfile.name}: ${(cityProfile.nightReliability * 100).toFixed(0)}%` : ""}

City Context:
- Walking friendliness: ${(cityProfile.walkingFriendliness * 100).toFixed(0)}%
- Transit vs taxi preference: ${(cityProfile.transitVsTaxiBias * 100).toFixed(0)}% transit-leaning
- Complex stations to avoid: ${cityProfile.complexStations.join(", ")}
- Available transit: ${cityProfile.transitTypes.join(", ")}
- Rideshare apps: ${cityProfile.rideshareApps.join(", ")}

User Preferences:
- Walking tolerance: ${userContext.walkingTolerance}/5 (${userContext.walkingTolerance >= 4 ? "enjoys walking" : userContext.walkingTolerance <= 2 ? "prefers minimal walking" : "moderate"})
- Transfer tolerance: ${userContext.transferTolerance}/5 (${userContext.transferTolerance >= 4 ? "comfortable with transfers" : userContext.transferTolerance <= 2 ? "avoids transfers" : "moderate"})
- Stress vs Speed: ${(userContext.stressVsSpeedBias * 100).toFixed(0)}% stress-focused (${userContext.stressVsSpeedBias >= 0.7 ? "strongly prefers calm journeys" : userContext.stressVsSpeedBias <= 0.3 ? "prioritizes speed" : "balanced"})
- Cost sensitivity: ${userContext.costSensitivity}/5 (${userContext.costSensitivity >= 4 ? "budget-conscious" : userContext.costSensitivity <= 2 ? "cost not a concern" : "moderate"})
- City familiarity: ${(userContext.cityFamiliarity * 100).toFixed(0)}% (${userContext.cityFamiliarity >= 0.7 ? "knows the city well" : userContext.cityFamiliarity <= 0.3 ? "unfamiliar with the city" : "somewhat familiar"})

Based on all this context - especially the user's CURRENT MOOD and WEATHER - recommend the SINGLE best way to make this journey. Your recommendation should directly reflect their mood state.

In your reasoning, mention how the current mood and conditions influenced your choice.

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
