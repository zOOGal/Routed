/**
 * LOCATION INTELLIGENCE SERVICE
 *
 * Verifies that entered locations match the selected city.
 * Uses LLM to intelligently detect city mismatches.
 */

import { GoogleGenAI } from "@google/genai";
import { getCityProfile } from "./city-intelligence";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export interface LocationVerificationResult {
  isValid: boolean;
  detectedCity?: string;
  mismatchType?: "origin" | "destination" | "both";
  message?: string;
}

interface PlaceAnalysis {
  isInCity: boolean;
  detectedCity: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Verify that origin and destination are in the selected city
 */
export async function verifyLocationsInCity(
  origin: string,
  destination: string,
  cityId: string
): Promise<LocationVerificationResult> {
  console.log(`[Location Check] Verifying: "${origin}" → "${destination}" in city: ${cityId}`);

  const cityProfile = getCityProfile(cityId);
  if (!cityProfile) {
    return { isValid: false, message: "Unknown city selected." };
  }

  // Quick heuristic check first (fast, no API call)
  const quickCheck = quickLocationCheck(origin, destination, cityProfile.name, cityId);
  console.log(`[Location Check] Quick check result:`, quickCheck);

  if (quickCheck.definitelyWrong) {
    return quickCheck.result;
  }

  // If heuristics are inconclusive, use LLM for verification
  try {
    const analysis = await analyzeLocationsWithLLM(origin, destination, cityProfile.name);
    return buildVerificationResult(analysis, cityProfile.name);
  } catch (error) {
    console.warn("LLM location verification failed, allowing request:", error);
    // On LLM failure, allow the request (fail open)
    return { isValid: true };
  }
}

/**
 * Quick heuristic check for obvious mismatches
 */
function quickLocationCheck(
  origin: string,
  destination: string,
  cityName: string,
  cityId: string
): { definitelyWrong: boolean; result: LocationVerificationResult } {
  const originLower = origin.toLowerCase();
  const destLower = destination.toLowerCase();
  const cityLower = cityName.toLowerCase();

  // Known city indicators that definitively don't match
  const cityIndicators: Record<string, string[]> = {
    nyc: [
      "manhattan", "brooklyn", "queens", "bronx", "staten island", "new york", "ny ",
      "central park", "times square", "wall street", "empire state", "the met",
      "met museum", "metropolitan museum", "grand central", "penn station",
      "fifth avenue", "5th avenue", "broadway", "harlem", "tribeca", "chelsea",
      "williamsburg", "jfk", "laguardia", "yankee stadium", "madison square"
    ],
    tokyo: [
      "shibuya", "shinjuku", "ginza", "akihabara", "roppongi", "tokyo", "chiyoda",
      "harajuku", "ikebukuro", "ueno", "asakusa", "odaiba", "narita", "haneda"
    ],
    berlin: [
      "kreuzberg", "mitte", "prenzlauer", "charlottenburg", "berlin", "alexanderplatz",
      "brandenburger", "potsdamer", "friedrichshain", "neukölln", "tempelhof", "tegel"
    ],
    london: [
      "westminster", "soho", "camden", "shoreditch", "london", "piccadilly",
      "big ben", "tower bridge", "heathrow", "gatwick", "oxford street", "covent garden"
    ],
    paris: [
      "montmartre", "marais", "champs", "louvre", "paris", "arrondissement",
      "eiffel", "notre dame", "sacré-cœur", "bastille", "saint-germain"
    ],
    "san-francisco": [
      "soma", "mission", "castro", "haight", "san francisco", "sf ", "embarcadero",
      "golden gate", "fisherman", "alcatraz", "union square", "chinatown sf"
    ],
  };

  // Check if locations contain indicators from OTHER cities
  for (const [otherCityId, indicators] of Object.entries(cityIndicators)) {
    if (otherCityId === cityId) continue;

    const originHasOtherCity = indicators.some(ind => originLower.includes(ind));
    const destHasOtherCity = indicators.some(ind => destLower.includes(ind));

    if (originHasOtherCity || destHasOtherCity) {
      const otherCityName = getCityProfile(otherCityId)?.name || otherCityId;

      let mismatchType: "origin" | "destination" | "both" = "both";
      if (originHasOtherCity && !destHasOtherCity) mismatchType = "origin";
      if (!originHasOtherCity && destHasOtherCity) mismatchType = "destination";

      return {
        definitelyWrong: true,
        result: {
          isValid: false,
          detectedCity: otherCityName,
          mismatchType,
          message: buildMismatchMessage(mismatchType, otherCityName, cityName),
        },
      };
    }
  }

  return { definitelyWrong: false, result: { isValid: true } };
}

/**
 * Use LLM to analyze if locations are in the expected city
 */
async function analyzeLocationsWithLLM(
  origin: string,
  destination: string,
  expectedCity: string
): Promise<{ origin: PlaceAnalysis; destination: PlaceAnalysis }> {
  const prompt = `Analyze these two locations and determine which city they are in.

Origin: "${origin}"
Destination: "${destination}"
Expected city: ${expectedCity}

For each location, respond with JSON:
{
  "origin": {
    "isInCity": boolean (true if the origin is in or near ${expectedCity}),
    "detectedCity": string or null (the actual city if different from expected),
    "confidence": "high" | "medium" | "low"
  },
  "destination": {
    "isInCity": boolean (true if the destination is in or near ${expectedCity}),
    "detectedCity": string or null (the actual city if different from expected),
    "confidence": "high" | "medium" | "low"
  }
}

Rules:
- "isInCity" should be true for locations clearly in or part of the metropolitan area
- Generic names (like "Central Station") without city context should have low confidence
- Well-known landmarks should have high confidence
- If unsure, use medium confidence and set isInCity to true

Respond ONLY with the JSON object, no other text.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const content = response.text || "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.warn("Failed to parse LLM response:", content);
    // Default to allowing the request
    return {
      origin: { isInCity: true, detectedCity: null, confidence: "low" },
      destination: { isInCity: true, detectedCity: null, confidence: "low" },
    };
  }
}

/**
 * Build verification result from LLM analysis
 */
function buildVerificationResult(
  analysis: { origin: PlaceAnalysis; destination: PlaceAnalysis },
  expectedCity: string
): LocationVerificationResult {
  const originWrong = !analysis.origin.isInCity && analysis.origin.confidence !== "low";
  const destWrong = !analysis.destination.isInCity && analysis.destination.confidence !== "low";

  if (!originWrong && !destWrong) {
    return { isValid: true };
  }

  let mismatchType: "origin" | "destination" | "both";
  let detectedCity: string | undefined;

  if (originWrong && destWrong) {
    mismatchType = "both";
    detectedCity = analysis.origin.detectedCity || analysis.destination.detectedCity || undefined;
  } else if (originWrong) {
    mismatchType = "origin";
    detectedCity = analysis.origin.detectedCity || undefined;
  } else {
    mismatchType = "destination";
    detectedCity = analysis.destination.detectedCity || undefined;
  }

  return {
    isValid: false,
    detectedCity,
    mismatchType,
    message: buildMismatchMessage(mismatchType, detectedCity, expectedCity),
  };
}

/**
 * Build user-friendly mismatch message
 */
function buildMismatchMessage(
  mismatchType: "origin" | "destination" | "both",
  detectedCity: string | undefined,
  expectedCity: string
): string {
  const locationWord = mismatchType === "both"
    ? "These locations"
    : mismatchType === "origin"
      ? "Your starting point"
      : "Your destination";

  if (detectedCity) {
    return `${locationWord} ${mismatchType === "both" ? "appear" : "appears"} to be in ${detectedCity}, not ${expectedCity}. Please select the correct city or update your locations.`;
  }

  return `${locationWord} ${mismatchType === "both" ? "don't" : "doesn't"} appear to be in ${expectedCity}. Please verify your city selection or update your locations.`;
}

/**
 * Suggest the correct city based on location names
 */
export function suggestCity(origin: string, destination: string): string | null {
  const combined = `${origin} ${destination}`.toLowerCase();

  const citySuggestions: Record<string, string[]> = {
    nyc: ["new york", "manhattan", "brooklyn", "queens", "bronx", "times square", "central park", "wall street"],
    tokyo: ["tokyo", "shibuya", "shinjuku", "ginza", "akihabara", "roppongi", "harajuku"],
    berlin: ["berlin", "kreuzberg", "mitte", "prenzlauer", "alexanderplatz", "brandenburger"],
    london: ["london", "westminster", "soho", "camden", "big ben", "tower bridge", "heathrow"],
    paris: ["paris", "eiffel", "louvre", "montmartre", "champs-elysées", "notre dame"],
    "san-francisco": ["san francisco", "sf", "golden gate", "fisherman", "alcatraz", "mission district"],
  };

  for (const [cityId, keywords] of Object.entries(citySuggestions)) {
    if (keywords.some(kw => combined.includes(kw))) {
      return cityId;
    }
  }

  return null;
}
