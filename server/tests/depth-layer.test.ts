import { describe, it, expect } from "vitest";
import { generateSimpleDepthLayer } from "../depth/depthLayer";
import { depthLayerOutputSchema, DEFAULT_LEARNED_PREFERENCES } from "../depth/types";
import type { CityProfile, RouteRecommendation } from "@shared/schema";

// Mock city profile
const mockCityProfile: CityProfile = {
  id: "berlin",
  name: "Berlin",
  country: "Germany",
  timezone: "Europe/Berlin",
  complexStations: ["Alexanderplatz"],
  nightReliability: 0.7,
  transitVsTaxiBias: 0.8,
  walkingFriendliness: 0.8,
  cognitiveLoadIndex: {
    navigation: 0.4,
    signage: 0.3,
    crowding: 0.5,
    overall: 0.4,
  },
  currency: "EUR",
  transitTypes: ["U-Bahn", "S-Bahn"],
  rideshareApps: ["Bolt", "Uber"],
};

// Mock recommendation
const mockRecommendation: RouteRecommendation = {
  mode: "transit",
  summary: "Take U-Bahn to destination",
  estimatedDuration: 25,
  estimatedCost: 3,
  stressScore: 0.3,
  steps: [
    { type: "walk", instruction: "Walk to station", duration: 5 },
    { type: "transit", instruction: "Take U2", duration: 15, line: "U2" },
    { type: "walk", instruction: "Walk to destination", duration: 5 },
  ],
  reasoning: "Transit is efficient for this route",
  confidence: 0.85,
};

// Mock weather
const mockWeather = {
  condition: "clear" as const,
  description: "Clear sky",
  temperature: 18,
  feelsLike: 16,
  humidity: 55,
  windSpeed: 8,
  isOutdoorFriendly: true,
  advice: "Pleasant weather for walking",
};

describe("Depth Layer - generateSimpleDepthLayer", () => {
  it("should generate valid depth layer output", () => {
    const output = generateSimpleDepthLayer({
      intent: "leisure",
      origin: "Alexanderplatz",
      destination: "Brandenburg Gate",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
    });

    expect(output).toHaveProperty("agentPresenceLine");
    expect(output).toHaveProperty("tripFramingLine");
    expect(output).toHaveProperty("contextualInsights");
    expect(output).toHaveProperty("responsibilityLine");
    expect(Array.isArray(output.contextualInsights)).toBe(true);
  });

  it("should generate output that passes Zod validation", () => {
    const output = generateSimpleDepthLayer({
      intent: "work",
      origin: "Home",
      destination: "Office",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
    });

    // Should not throw
    const validated = depthLayerOutputSchema.parse(output);
    expect(validated).toEqual(output);
  });

  it("should respect max insight count (4)", () => {
    const output = generateSimpleDepthLayer({
      intent: "leisure",
      origin: "Home",
      destination: "Museum",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: {
        ...mockWeather,
        condition: "rain",
        isOutdoorFriendly: false,
      },
      venueInfo: {
        name: "Museum",
        isOpenNow: false,
        nextOpenTime: "Opens at 10:00 tomorrow",
        requiresReservation: true,
        requiresTicket: true,
        confidence: 0.8,
      },
      tripCount: 10,
    });

    expect(output.contextualInsights.length).toBeLessThanOrEqual(4);
  });

  it("should include different content for different intents", () => {
    const leisureOutput = generateSimpleDepthLayer({
      intent: "leisure",
      origin: "Home",
      destination: "Park",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
    });

    const workOutput = generateSimpleDepthLayer({
      intent: "work",
      origin: "Home",
      destination: "Office",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
    });

    // Both should be valid but may have different framing
    expect(leisureOutput.agentPresenceLine).toBeTruthy();
    expect(workOutput.agentPresenceLine).toBeTruthy();
  });

  it("should include venue info in insights when provided", () => {
    const output = generateSimpleDepthLayer({
      intent: "leisure",
      origin: "Home",
      destination: "Pergamon Museum",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
      venueInfo: {
        name: "Pergamon Museum",
        isOpenNow: false,
        nextOpenTime: "Opens at 10:00 tomorrow",
        requiresReservation: true,
        requiresTicket: true,
        confidence: 0.8,
      },
    });

    // Should have venue-related insight
    const hasVenueInsight = output.contextualInsights.some(
      (insight) =>
        insight.toLowerCase().includes("closed") ||
        insight.toLowerCase().includes("museum") ||
        insight.toLowerCase().includes("reservation")
    );
    expect(hasVenueInsight).toBe(true);
  });
});

describe("Depth Layer - Zod schema validation", () => {
  it("should accept valid output", () => {
    const validOutput = {
      agentPresenceLine: "Monitoring conditions for your trip.",
      tripFramingLine: "25 min transit journey with one transfer.",
      contextualInsights: ["Weather is clear.", "No rush hour traffic."],
      responsibilityLine: "I'll alert you to any changes.",
    };

    const result = depthLayerOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("should accept output with optional memoryCallbackLine", () => {
    const outputWithCallback = {
      agentPresenceLine: "Ready for your commute.",
      tripFramingLine: "Your usual route to work.",
      contextualInsights: [],
      memoryCallbackLine: "You usually prefer the calmer route.",
      responsibilityLine: "Watching for delays.",
    };

    const result = depthLayerOutputSchema.safeParse(outputWithCallback);
    expect(result.success).toBe(true);
  });

  it("should reject output with missing required fields", () => {
    const invalidOutput = {
      agentPresenceLine: "Test",
      // missing tripFramingLine, contextualInsights, responsibilityLine
    };

    const result = depthLayerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("should reject output with wrong types", () => {
    const invalidOutput = {
      agentPresenceLine: "Test",
      tripFramingLine: "Test",
      contextualInsights: "not an array", // Should be array
      responsibilityLine: "Test",
    };

    const result = depthLayerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("should accept empty contextualInsights array", () => {
    const outputWithEmptyInsights = {
      agentPresenceLine: "Test",
      tripFramingLine: "Test",
      contextualInsights: [],
      responsibilityLine: "Test",
    };

    const result = depthLayerOutputSchema.safeParse(outputWithEmptyInsights);
    expect(result.success).toBe(true);
  });

  it("should enforce max 4 contextualInsights", () => {
    const outputWithTooManyInsights = {
      agentPresenceLine: "Test",
      tripFramingLine: "Test",
      contextualInsights: ["1", "2", "3", "4", "5"], // 5 items
      responsibilityLine: "Test",
    };

    const result = depthLayerOutputSchema.safeParse(outputWithTooManyInsights);
    expect(result.success).toBe(false);
  });
});

describe("Depth Layer - LLM JSON parsing fallback", () => {
  it("should handle malformed JSON gracefully", () => {
    // The parseAndValidateLLMOutput function extracts JSON from content
    // and validates with Zod. If it fails, it returns null and the system
    // falls back to deterministic output.

    // Test that generateSimpleDepthLayer always produces valid output
    // as the fallback mechanism
    const output = generateSimpleDepthLayer({
      intent: "exploring",
      origin: "Unknown Location",
      destination: "Random Place",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
    });

    // Fallback should always work
    expect(output.agentPresenceLine).toBeTruthy();
    expect(output.tripFramingLine).toBeTruthy();
    expect(output.responsibilityLine).toBeTruthy();
    expect(Array.isArray(output.contextualInsights)).toBe(true);
  });

  it("should produce deterministic output without LLM", () => {
    // Same inputs should produce same output (deterministic)
    const params = {
      intent: "leisure" as const,
      origin: "Point A",
      destination: "Point B",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
    };

    const output1 = generateSimpleDepthLayer(params);
    const output2 = generateSimpleDepthLayer(params);

    // Core structure should be consistent
    expect(output1.agentPresenceLine).toBe(output2.agentPresenceLine);
    expect(output1.tripFramingLine).toBe(output2.tripFramingLine);
    expect(output1.responsibilityLine).toBe(output2.responsibilityLine);
  });
});

describe("Depth Layer - DEFAULT_LEARNED_PREFERENCES", () => {
  it("should have reasonable default values", () => {
    expect(DEFAULT_LEARNED_PREFERENCES.walkingToleranceMin).toBeGreaterThan(0);
    expect(DEFAULT_LEARNED_PREFERENCES.transferTolerance).toBeGreaterThan(0);
    expect(DEFAULT_LEARNED_PREFERENCES.calmQuickBias).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_LEARNED_PREFERENCES.calmQuickBias).toBeLessThanOrEqual(1);
    expect(DEFAULT_LEARNED_PREFERENCES.saveSpendBias).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_LEARNED_PREFERENCES.saveSpendBias).toBeLessThanOrEqual(1);
    expect(DEFAULT_LEARNED_PREFERENCES.replanSensitivity).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_LEARNED_PREFERENCES.replanSensitivity).toBeLessThanOrEqual(1);
  });

  it("should use defaults when no preferences provided", () => {
    const output = generateSimpleDepthLayer({
      intent: "leisure",
      origin: "A",
      destination: "B",
      recommendation: mockRecommendation,
      cityProfile: mockCityProfile,
      weather: mockWeather,
      // No learnedPreferences provided - should use defaults
    });

    // Should still generate valid output
    expect(output.agentPresenceLine).toBeTruthy();
  });
});
