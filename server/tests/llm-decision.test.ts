/**
 * LLM DECISION ENGINE TESTS
 *
 * Tests for the LLM-powered route decision system.
 * Focuses on:
 * - Fallback behavior when LLM is unavailable
 * - Context-aware decision making
 * - User note handling
 * - Learned preferences integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeFallbackDecision,
  type LLMDecisionContext,
} from "../llm-decision";
import type { RouteCandidate } from "../route-scoring";
import type { GoogleMapsRoute } from "../google-maps-service";

// ============================================
// FIXTURES
// ============================================

function createMockGoogleRoute(durationMin: number, walkingMin: number, transfers: number): GoogleMapsRoute {
  const steps: GoogleMapsRoute["steps"] = [];

  // Walking step
  if (walkingMin > 0) {
    steps.push({
      travelMode: "WALKING",
      distance: { text: "500m", value: 500 },
      duration: { text: `${walkingMin} min`, value: walkingMin * 60 },
      htmlInstructions: "Walk",
      startLocation: { lat: 0, lng: 0 },
      endLocation: { lat: 0, lng: 0 },
    });
  }

  // Transit steps
  for (let i = 0; i <= transfers; i++) {
    steps.push({
      travelMode: "TRANSIT",
      distance: { text: "5km", value: 5000 },
      duration: { text: "10 min", value: 600 },
      htmlInstructions: "Take transit",
      startLocation: { lat: 0, lng: 0 },
      endLocation: { lat: 0, lng: 0 },
      transitDetails: {
        departureStop: { name: "Station A", location: { lat: 0, lng: 0 } },
        arrivalStop: { name: "Station B", location: { lat: 0, lng: 0 } },
        line: { name: "Line 1", vehicle: { type: "SUBWAY", name: "Subway" } },
        numStops: 5,
      },
    });
  }

  return {
    distance: { text: "10km", value: 10000 },
    duration: { text: `${durationMin} min`, value: durationMin * 60 },
    steps,
  };
}

function createMockCandidate(
  mode: "transit" | "walking" | "driving",
  durationMin: number,
  walkingMin: number,
  transfers: number = 0
): RouteCandidate {
  return {
    mode,
    archetype: transfers === 0 ? "calm" : "fast",
    route: createMockGoogleRoute(durationMin, walkingMin, transfers),
    scores: {
      calm: transfers === 0 ? 90 : 60,
      fast: Math.max(0, 100 - durationMin),
      comfort: mode === "driving" ? 90 : 70,
    },
    metrics: {
      durationMinutes: durationMin,
      walkingMinutes: walkingMin,
      walkingMeters: walkingMin * 80,
      transferCount: transfers,
      hasComplexStation: false,
      isWeatherExposed: mode === "walking",
      stopsCount: transfers * 3,
    },
    finalScore: 0,
  };
}

function createBaseUserContext(): LLMDecisionContext["userContext"] {
  return {
    intent: "leisure",
    calmVsFast: 50,
    economyVsComfort: 50,
    unfamiliarWithCity: false,
  };
}

function createBaseEnvironmentContext(): LLMDecisionContext["environmentContext"] {
  return {
    weather: {
      condition: "clear",
      temperature: 20,
      isOutdoorFriendly: true,
    },
    isRushHour: false,
    isNightTime: false,
    cityName: "Berlin",
    cityCharacteristics: {
      walkingFriendliness: 0.8,
      transitReliability: 0.9,
      nightSafety: 0.8,
    },
  };
}

// ============================================
// TESTS: FALLBACK DECISION LOGIC
// ============================================

describe("LLM Decision Fallback", () => {
  it("returns single candidate when only one option", () => {
    const candidates = [createMockCandidate("transit", 25, 8, 0)];

    const result = makeFallbackDecision(
      candidates,
      createBaseUserContext(),
      createBaseEnvironmentContext()
    );

    expect(result.decision.selectedCandidateIndex).toBe(0);
    expect(result.decision.confidenceScore).toBe(1.0);
    expect(result.usedLLM).toBe(false);
  });

  it("prefers faster route for time_sensitive intent", () => {
    const candidates = [
      createMockCandidate("transit", 35, 5, 0),  // Slow but calm
      createMockCandidate("transit", 20, 10, 2), // Fast but transfers
    ];

    const userContext = {
      ...createBaseUserContext(),
      intent: "time_sensitive" as const,
    };

    const result = makeFallbackDecision(
      candidates,
      userContext,
      createBaseEnvironmentContext()
    );

    // Should prefer faster option
    expect(result.selectedCandidate.metrics.durationMinutes).toBe(20);
  });

  it("prefers calmer route for leisure intent", () => {
    const candidates = [
      createMockCandidate("transit", 35, 5, 0),  // Slow but calm
      createMockCandidate("transit", 20, 10, 2), // Fast but transfers
    ];

    const userContext = {
      ...createBaseUserContext(),
      intent: "leisure" as const,
    };

    const result = makeFallbackDecision(
      candidates,
      userContext,
      createBaseEnvironmentContext()
    );

    // Should prefer calmer option (no transfers)
    expect(result.selectedCandidate.metrics.transferCount).toBe(0);
  });

  it("penalizes walking when user note mentions tired", () => {
    const candidates = [
      createMockCandidate("transit", 25, 20, 0), // High walking
      createMockCandidate("transit", 30, 5, 1),  // Low walking
    ];

    const userContext = {
      ...createBaseUserContext(),
      userNote: "I'm really tired, please minimize walking",
    };

    const result = makeFallbackDecision(
      candidates,
      userContext,
      createBaseEnvironmentContext()
    );

    // Should prefer route with less walking
    expect(result.selectedCandidate.metrics.walkingMinutes).toBe(5);
    expect(result.decision.keyFactors).toContain("minimal walking");
  });

  it("prefers rideshare for date note", () => {
    const candidates = [
      createMockCandidate("transit", 25, 8, 1),
      createMockCandidate("driving", 20, 2, 0),
    ];

    const userContext = {
      ...createBaseUserContext(),
      userNote: "This is for a date night",
    };

    const result = makeFallbackDecision(
      candidates,
      userContext,
      createBaseEnvironmentContext()
    );

    // Should prefer driving for comfort on a date
    expect(result.selectedCandidate.mode).toBe("driving");
  });

  it("prefers cheaper options for budget note", () => {
    const candidates = [
      createMockCandidate("walking", 35, 35, 0),
      createMockCandidate("driving", 15, 2, 0),
    ];

    const userContext = {
      ...createBaseUserContext(),
      userNote: "Trying to save money, cheap option please",
    };

    const result = makeFallbackDecision(
      candidates,
      userContext,
      createBaseEnvironmentContext()
    );

    // Should prefer walking (free)
    expect(result.selectedCandidate.mode).toBe("walking");
  });

  it("avoids outdoor routes in bad weather", () => {
    const candidates = [
      createMockCandidate("walking", 25, 25, 0),
      createMockCandidate("driving", 20, 2, 0),
    ];

    const environmentContext = {
      ...createBaseEnvironmentContext(),
      weather: {
        condition: "rain",
        temperature: 10,
        isOutdoorFriendly: false,
      },
    };

    const result = makeFallbackDecision(
      candidates,
      createBaseUserContext(),
      environmentContext
    );

    // Should prefer driving to avoid weather
    expect(result.selectedCandidate.mode).toBe("driving");
    expect(result.decision.keyFactors).toContain("weather protection");
  });

  it("prefers rideshare at night for safety", () => {
    const candidates = [
      createMockCandidate("walking", 25, 25, 0),
      createMockCandidate("driving", 18, 2, 0),
    ];

    const environmentContext = {
      ...createBaseEnvironmentContext(),
      isNightTime: true,
    };

    const result = makeFallbackDecision(
      candidates,
      createBaseUserContext(),
      environmentContext
    );

    // Should prefer driving at night
    expect(result.selectedCandidate.mode).toBe("driving");
    expect(result.decision.keyFactors).toContain("safe for night");
  });

  it("simplifies routes for unfamiliar users", () => {
    const candidates = [
      createMockCandidate("transit", 35, 5, 0),  // No transfers
      createMockCandidate("transit", 25, 8, 3),  // Multiple transfers
    ];

    const userContext = {
      ...createBaseUserContext(),
      unfamiliarWithCity: true,
    };

    const result = makeFallbackDecision(
      candidates,
      userContext,
      createBaseEnvironmentContext()
    );

    // Should prefer simpler route for tourists
    expect(result.selectedCandidate.metrics.transferCount).toBe(0);
  });

  it("respects economy vs comfort slider", () => {
    const candidates = [
      createMockCandidate("transit", 30, 8, 1),
      createMockCandidate("driving", 18, 2, 0),
    ];

    // Economy focused user
    const economyUserContext = {
      ...createBaseUserContext(),
      economyVsComfort: 10, // Strong economy preference
    };

    const economyResult = makeFallbackDecision(
      candidates,
      economyUserContext,
      createBaseEnvironmentContext()
    );

    // Should prefer transit (cheaper)
    expect(economyResult.selectedCandidate.mode).toBe("transit");

    // Comfort focused user
    const comfortUserContext = {
      ...createBaseUserContext(),
      economyVsComfort: 90, // Strong comfort preference
    };

    const comfortResult = makeFallbackDecision(
      candidates,
      comfortUserContext,
      createBaseEnvironmentContext()
    );

    // Should prefer driving (more comfortable)
    expect(comfortResult.selectedCandidate.mode).toBe("driving");
  });

  it("uses learned preferences when available", () => {
    const candidates = [
      createMockCandidate("transit", 25, 20, 0),  // High walking
      createMockCandidate("transit", 30, 5, 2),   // Low walking, more transfers
    ];

    const learnedPreferences = {
      preferredWalkingTolerance: 1, // User doesn't like walking (10 min max)
      transferTolerance: 3,         // User is okay with transfers
      typicalCalmVsQuickBias: 0.5,
      recentPatterns: [],
    };

    const result = makeFallbackDecision(
      candidates,
      createBaseUserContext(),
      createBaseEnvironmentContext(),
      learnedPreferences
    );

    // Should prefer route with less walking based on learned preferences
    expect(result.selectedCandidate.metrics.walkingMinutes).toBe(5);
  });

  it("acknowledges tradeoffs in close decisions", () => {
    const candidates = [
      createMockCandidate("transit", 35, 5, 0),   // Calm but slower
      createMockCandidate("transit", 25, 15, 2),  // Fast but more complex
    ];

    const result = makeFallbackDecision(
      candidates,
      createBaseUserContext(),
      createBaseEnvironmentContext()
    );

    // Decision should be made with some reasoning
    expect(result.decision.reasoning).toBeTruthy();
  });
});

// ============================================
// TESTS: INTENT DIFFERENTIATION
// ============================================

describe("Different intents produce different results", () => {
  const candidates = [
    createMockCandidate("transit", 40, 5, 0),    // Very calm, slow
    createMockCandidate("transit", 25, 12, 2),   // Fast, complex
    createMockCandidate("driving", 20, 2, 0),    // Fastest, comfortable, expensive
  ];

  it("work intent values speed", () => {
    const result = makeFallbackDecision(
      candidates,
      { ...createBaseUserContext(), intent: "work" },
      createBaseEnvironmentContext()
    );

    // Should pick faster option
    expect(result.selectedCandidate.metrics.durationMinutes).toBeLessThan(40);
  });

  it("exploring intent values simplicity", () => {
    const result = makeFallbackDecision(
      candidates,
      { ...createBaseUserContext(), intent: "exploring" },
      createBaseEnvironmentContext()
    );

    // Should pick calmer option (fewer transfers)
    expect(result.selectedCandidate.metrics.transferCount).toBe(0);
  });

  it("time_sensitive intent prioritizes fastest", () => {
    const result = makeFallbackDecision(
      candidates,
      { ...createBaseUserContext(), intent: "time_sensitive" },
      createBaseEnvironmentContext()
    );

    // Should pick fastest option
    expect(result.selectedCandidate.metrics.durationMinutes).toBeLessThanOrEqual(25);
  });
});

// ============================================
// TESTS: ERROR HANDLING
// ============================================

describe("Error handling", () => {
  it("throws on empty candidates", () => {
    expect(() =>
      makeFallbackDecision(
        [],
        createBaseUserContext(),
        createBaseEnvironmentContext()
      )
    ).toThrow("No candidates to choose from");
  });
});
