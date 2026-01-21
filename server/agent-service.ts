import { GoogleGenAI } from "@google/genai";
import { getCityProfile, calculateCognitiveLoad } from "./city-intelligence";
import { storage } from "./storage";
import {
  getMultipleRoutes,
  mapToRouteSteps,
  generateGoogleMapsDeepLink,
  nomadiModeToGoogleMode,
  type GoogleMapsRoute,
  type TravelMode
} from "./google-maps-service";
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

const SYSTEM_PROMPT = `You are Movi, a calm and confident AI mobility agent. Your job is to analyze REAL route data from Google Maps and recommend the best option for a user.

Core Principles:
1. OPINIONATED: Select ONE best route from the real options provided
2. USER-FIRST: The user's slider preferences are your TOP PRIORITY
3. DATA-DRIVEN: Use the real route data (durations, distances, transit details) provided to you
4. EXPLAINABLE: Always explain your reasoning in a friendly, conversational way

CRITICAL SLIDER RULES (YOU MUST FOLLOW):
- Calm vs Fast slider (0-100): 0=calm routes, 100=speed priority
- Economy vs Comfort slider (0-100): 0=cheapest options, 100=premium comfort

MANDATORY CONSTRAINTS:
- If Economy slider is LOW (0-30): You MUST recommend transit or walking. NEVER recommend driving/rideshare.
- If Economy slider is HIGH (70-100): Rideshare and premium options are allowed.
- If Calm slider is LOW (0-30): Prioritize peaceful, scenic, low-stress routes.
- If Calm slider is HIGH (70-100): Prioritize speed even if more stressful.

Weather and conditions are SECONDARY - they can influence route choice but CANNOT override budget constraints.

You will be provided with REAL route data from Google Maps. Your job is to:
1. Analyze the actual routes available
2. Select the best one based on user preferences
3. Assign a stress score based on complexity, transfers, and walking distance
4. Explain your choice

You must respond with a valid JSON object matching this exact structure:
{
  "selectedMode": "transit" | "driving" | "walking" (which route to use from the provided options),
  "summary": "A brief 1-sentence summary of the journey",
  "stressScore": number (0-1, where 0 is very relaxing and 1 is very stressful),
  "reasoning": "A friendly 2-3 sentence explanation of why this is the best choice",
  "confidence": number (0-1)
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

function getPreferenceDescription(value: number, lowLabel: string, highLabel: string): string {
  if (value <= 20) return `Strongly prefers ${lowLabel}`;
  if (value <= 40) return `Leans towards ${lowLabel}`;
  if (value <= 60) return "Balanced";
  if (value <= 80) return `Leans towards ${highLabel}`;
  return `Strongly prefers ${highLabel}`;
}

interface RouteOption {
  mode: TravelMode;
  route: GoogleMapsRoute;
}

function buildPrompt(
  request: AgentRequest,
  cityProfile: CityProfile,
  userContext: UserContext,
  routeOptions: RouteOption[]
): string {
  const isNightTime = (() => {
    const now = new Date();
    const hour = now.getHours();
    return hour < 6 || hour >= 22;
  })();

  const weather = getSimulatedWeather(request.cityId);

  // Use slider values if provided, otherwise fall back to user context
  const calmVsFast = request.calmVsFast ?? 50;
  const economyVsComfort = request.economyVsComfort ?? 50;
  const isUnfamiliar = request.unfamiliarWithCity ?? (userContext.cityFamiliarity < 0.3);

  const calmFastDesc = getPreferenceDescription(calmVsFast, "calm routes", "faster routes");
  const economyComfortDesc = getPreferenceDescription(economyVsComfort, "economy options", "comfortable options");

  // Format real route data for AI analysis
  const routeDataText = routeOptions.map(({ mode, route }) => {
    const durationMin = Math.ceil(route.duration.value / 60);
    const distanceKm = (route.distance.value / 1000).toFixed(1);
    const stepsCount = route.steps.length;
    const transitSteps = route.steps.filter(s => s.travelMode === "TRANSIT");
    const walkingSteps = route.steps.filter(s => s.travelMode === "WALKING");
    const totalWalkingMin = walkingSteps.reduce((acc, s) => acc + Math.ceil(s.duration.value / 60), 0);

    let details = `  - Mode: ${mode.toUpperCase()}\n`;
    details += `    Duration: ${durationMin} minutes\n`;
    details += `    Distance: ${distanceKm} km\n`;

    if (mode === "transit") {
      details += `    Transit segments: ${transitSteps.length}\n`;
      details += `    Walking time: ${totalWalkingMin} minutes\n`;
      if (route.fare) {
        details += `    Fare: ${route.fare.text}\n`;
      }
      if (route.departureTime && route.arrivalTime) {
        details += `    Departs: ${route.departureTime}, Arrives: ${route.arrivalTime}\n`;
      }
      // Add transit line details
      transitSteps.forEach((step, i) => {
        if (step.transitDetails) {
          const td = step.transitDetails;
          details += `    Line ${i + 1}: ${td.line.shortName || td.line.name} (${td.line.vehicle.type}) - ${td.numStops} stops\n`;
          details += `      From: ${td.departureStop.name} → To: ${td.arrivalStop.name}\n`;
        }
      });
    }

    if (mode === "driving") {
      details += `    Estimated cost: ~$15-25 (rideshare)\n`;
    }

    if (mode === "walking") {
      details += `    Free, good exercise!\n`;
    }

    return details;
  }).join("\n");

  return `
User wants to travel in ${cityProfile.name}:
- From: ${request.origin}
- To: ${request.destination}
${request.departureTime ? `- Departure: ${request.departureTime}` : "- Departure: Now"}

USER PREFERENCES (IMPORTANT - These are set by the user RIGHT NOW):
- Calm vs Fast: ${calmVsFast}/100 - ${calmFastDesc}
  ${calmVsFast <= 30 ? "→ PRIORITIZE calm, low-stress routes even if they take longer" : ""}
  ${calmVsFast >= 70 ? "→ PRIORITIZE speed, user is in a hurry" : ""}
- Economy vs Comfort: ${economyVsComfort}/100 - ${economyComfortDesc}
  ${economyVsComfort <= 30 ? "→ PRIORITIZE cheapest options (public transit, walking)" : ""}
  ${economyVsComfort >= 70 ? "→ PRIORITIZE comfort (rideshare, premium options OK)" : ""}
- City Familiarity: ${isUnfamiliar ? "UNFAMILIAR with this city - avoid complex routes, prefer simple navigation" : "Familiar with the city"}

REAL-TIME CONDITIONS:
- Weather: ${weather.condition} - ${weather.advice}
- Time: ${isNightTime ? "Nighttime (late evening or early morning)" : "Daytime"}
${isNightTime ? `- Night reliability in ${cityProfile.name}: ${(cityProfile.nightReliability * 100).toFixed(0)}%` : ""}

City Context:
- Walking friendliness: ${(cityProfile.walkingFriendliness * 100).toFixed(0)}%
- Complex stations to avoid: ${cityProfile.complexStations.join(", ")}

=== REAL ROUTE OPTIONS FROM GOOGLE MAPS ===
${routeDataText}
===========================================

Based on the user's CALM vs FAST and ECONOMY vs COMFORT preferences, select the BEST route from the options above.

CRITICAL RULES:
1. USER PREFERENCES ARE THE TOP PRIORITY - they override weather and other conditions
2. If Economy slider is LOW (0-30), you MUST recommend transit or walking - even in bad weather
3. If Comfort slider is HIGH (70-100), then you can suggest driving/rideshare
4. Weather and conditions are secondary factors - they can influence the route but NOT override budget constraints
5. USE THE REAL DATA - don't make up durations or distances, use what's provided

In your reasoning, explain how the user's preferences and the actual route data influenced your choice.

Respond ONLY with a valid JSON object matching the specified structure.`;
}

interface AIRouteSelection {
  selectedMode: TravelMode;
  summary: string;
  stressScore: number;
  reasoning: string;
  confidence: number;
}

function parseAIRouteSelection(content: string): AIRouteSelection | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.selectedMode || !parsed.summary) {
      return null;
    }

    return {
      selectedMode: parsed.selectedMode,
      summary: parsed.summary,
      stressScore: Math.min(1, Math.max(0, parsed.stressScore || 0.5)),
      reasoning: parsed.reasoning || "I've selected what I believe is the best option for you.",
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.8)),
    };
  } catch (error) {
    console.error("Failed to parse AI route selection:", error);
    return null;
  }
}

function googleModeToNomadiMode(mode: TravelMode): RouteRecommendation["mode"] {
  switch (mode) {
    case "transit":
      return "transit";
    case "driving":
      return "rideshare";
    case "walking":
      return "walk";
    case "bicycling":
      return "bike";
    default:
      return "transit";
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

  // Fetch real routes from Google Maps
  const departureTime = request.departureTime ? new Date(request.departureTime) : undefined;
  const routeOptions = await getMultipleRoutes(request.origin, request.destination, departureTime);

  // If we got real routes, use AI to select the best one
  if (routeOptions.length > 0) {
    const prompt = buildPrompt(request, cityProfile, userContext, routeOptions);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
          { role: "model", parts: [{ text: "I understand. I am Movi, a calm and confident AI mobility agent. I will analyze real route data and select the best option based on user preferences." }] },
          { role: "user", parts: [{ text: prompt }] },
        ],
      });

      const content = response.text || "";
      const aiSelection = parseAIRouteSelection(content);

      if (aiSelection) {
        // Find the selected route from the options
        const selectedOption = routeOptions.find(r => r.mode === aiSelection.selectedMode);
        if (selectedOption) {
          // Build recommendation from real route data + AI analysis
          return buildRecommendationFromGoogleRoute(
            request,
            selectedOption.mode,
            selectedOption.route,
            aiSelection
          );
        }
      }

      // If AI selection failed, use heuristic to pick best route
      console.warn("AI route selection failed, using heuristic fallback");
      return buildRecommendationFromHeuristic(request, routeOptions, cityProfile);
    } catch (error) {
      console.error("AI reasoning error:", error);
      return buildRecommendationFromHeuristic(request, routeOptions, cityProfile);
    }
  }

  // Fallback to AI-generated estimates if Google Maps API fails
  console.warn("Google Maps API unavailable, using AI-generated fallback");
  return generateFallbackRecommendation(request, cityProfile, userContext);
}

function buildRecommendationFromGoogleRoute(
  request: AgentRequest,
  mode: TravelMode,
  route: GoogleMapsRoute,
  aiSelection: AIRouteSelection
): RouteRecommendation {
  const steps = mapToRouteSteps(route.steps, request.origin, request.destination);
  const durationMin = Math.ceil(route.duration.value / 60);

  // Estimate cost based on mode
  let estimatedCost: number | null = null;
  if (mode === "transit" && route.fare) {
    estimatedCost = route.fare.value;
  } else if (mode === "driving") {
    // Rough rideshare estimate
    const distanceKm = route.distance.value / 1000;
    estimatedCost = Math.round(5 + distanceKm * 1.5 + durationMin * 0.3);
  }

  // Generate full trip deep link
  const googleMapsLink = generateGoogleMapsDeepLink(
    request.origin,
    request.destination,
    mode
  );

  return {
    mode: googleModeToNomadiMode(mode),
    summary: aiSelection.summary,
    estimatedDuration: durationMin,
    estimatedCost,
    stressScore: aiSelection.stressScore,
    steps,
    reasoning: aiSelection.reasoning,
    confidence: aiSelection.confidence,
    googleMapsLink,
  };
}

function buildRecommendationFromHeuristic(
  request: AgentRequest,
  routeOptions: RouteOption[],
  cityProfile: CityProfile
): RouteRecommendation {
  const economyVsComfort = request.economyVsComfort ?? 50;
  const calmVsFast = request.calmVsFast ?? 50;

  // Select best mode based on preferences
  let selectedOption: RouteOption | undefined;

  if (economyVsComfort <= 30) {
    // Budget priority: prefer transit or walking
    selectedOption = routeOptions.find(r => r.mode === "transit")
      || routeOptions.find(r => r.mode === "walking");
  } else if (economyVsComfort >= 70) {
    // Comfort priority: prefer driving
    selectedOption = routeOptions.find(r => r.mode === "driving")
      || routeOptions.find(r => r.mode === "transit");
  } else if (calmVsFast >= 70) {
    // Speed priority: pick fastest
    selectedOption = routeOptions.reduce((fastest, current) =>
      current.route.duration.value < fastest.route.duration.value ? current : fastest
    );
  } else {
    // Balanced: prefer transit
    selectedOption = routeOptions.find(r => r.mode === "transit")
      || routeOptions[0];
  }

  if (!selectedOption) {
    selectedOption = routeOptions[0];
  }

  const { mode, route } = selectedOption;
  const steps = mapToRouteSteps(route.steps, request.origin, request.destination);
  const durationMin = Math.ceil(route.duration.value / 60);

  let estimatedCost: number | null = null;
  if (mode === "transit" && route.fare) {
    estimatedCost = route.fare.value;
  } else if (mode === "driving") {
    const distanceKm = route.distance.value / 1000;
    estimatedCost = Math.round(5 + distanceKm * 1.5 + durationMin * 0.3);
  }

  const googleMapsLink = generateGoogleMapsDeepLink(
    request.origin,
    request.destination,
    mode
  );

  // Calculate stress score heuristically
  const walkingSteps = route.steps.filter(s => s.travelMode === "WALKING");
  const totalWalkingMin = walkingSteps.reduce((acc, s) => acc + s.duration.value / 60, 0);
  const transferCount = route.steps.filter(s => s.travelMode === "TRANSIT").length - 1;
  const stressScore = Math.min(1, 0.2 + (totalWalkingMin / 30) * 0.3 + (transferCount * 0.15));

  return {
    mode: googleModeToNomadiMode(mode),
    summary: `${mode.charAt(0).toUpperCase() + mode.slice(1)} route to ${request.destination}`,
    estimatedDuration: durationMin,
    estimatedCost,
    stressScore,
    steps,
    reasoning: `Based on your preferences, ${mode} is a good choice for this trip.`,
    confidence: 0.75,
    googleMapsLink,
  };
}

function generateBudgetFriendlyRecommendation(
  request: AgentRequest,
  cityProfile: CityProfile,
  originalRecommendation: RouteRecommendation
): RouteRecommendation {
  // Convert rideshare recommendation to transit while preserving the journey structure
  const transitSteps: RouteStep[] = [
    {
      type: "walk",
      instruction: `Walk to the nearest ${cityProfile.transitTypes[0]} station`,
      duration: 5,
      distance: 400,
    },
    {
      type: "transit",
      instruction: `Take the ${cityProfile.transitTypes[0]} towards ${request.destination}`,
      duration: Math.max(15, originalRecommendation.estimatedDuration - 10),
      line: cityProfile.transitTypes[0],
      stopsCount: 6,
    },
    {
      type: "walk",
      instruction: `Walk to ${request.destination}`,
      duration: 5,
      distance: 300,
    },
  ];

  return {
    mode: "transit",
    summary: `Take ${cityProfile.transitTypes[0]} to reach ${request.destination} - budget-friendly option`,
    estimatedDuration: transitSteps.reduce((acc, s) => acc + s.duration, 0),
    estimatedCost: 3, // Typical transit fare
    stressScore: 0.35,
    steps: transitSteps,
    reasoning: `Since you've set your budget preference to economy, I'm recommending public transit instead of rideshare. This is the most cost-effective way to reach your destination while keeping stress low.`,
    confidence: 0.85,
  };
}

function generateFallbackRecommendation(
  request: AgentRequest,
  cityProfile: CityProfile,
  userContext: UserContext
): RouteRecommendation {
  // Respect economy preference in fallback too
  const economyVsComfort = request.economyVsComfort ?? 50;
  const preferTransit = economyVsComfort <= 50 || cityProfile.transitVsTaxiBias >= 0.5;
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
