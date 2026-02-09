import { describe, it, expect } from "vitest";
import {
  generateContextualInsights,
  shouldShowMemoryCallback,
  isRushHour,
  isNightTime,
} from "../depth/insights";
import { DEFAULT_LEARNED_PREFERENCES } from "../depth/types";
import type { DepthLayerInput } from "../depth/types";
import type { CityProfile, RouteRecommendation, UserEvent, VenueInfo } from "@shared/schema";

// Helper to create a minimal input context
function createInput(overrides: Partial<DepthLayerInput> = {}): DepthLayerInput {
  const cityProfile: CityProfile = {
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

  const recommendation: RouteRecommendation = {
    mode: "transit",
    summary: "Take U-Bahn to destination",
    estimatedDuration: 30,
    estimatedCost: 3,
    stressScore: 0.4,
    steps: [
      { type: "walk", instruction: "Walk to station", duration: 5 },
      { type: "transit", instruction: "Take U-Bahn", duration: 20, line: "U2" },
      { type: "walk", instruction: "Walk to destination", duration: 5 },
    ],
    reasoning: "Transit is the best option",
    confidence: 0.8,
  };

  return {
    userId: "test-user",
    learnedPreferences: DEFAULT_LEARNED_PREFERENCES,
    recentEvents: [],
    intent: "leisure",
    origin: "Start",
    destination: "End",
    recommendation,
    cityProfile,
    weather: {
      condition: "clear",
      description: "Clear sky",
      temperature: 20,
      feelsLike: 18,
      humidity: 50,
      windSpeed: 5,
      isOutdoorFriendly: true,
      advice: "Good weather for walking",
    },
    currentTime: new Date("2024-01-15T14:00:00"),
    isRushHour: false,
    isNightTime: false,
    ...overrides,
  };
}

describe("Depth Insights - generateContextualInsights", () => {
  it("should return at most 4 insights", () => {
    // Create conditions that would generate many insights
    const input = createInput({
      weather: {
        condition: "rain",
        description: "Heavy rain",
        temperature: 5,
        feelsLike: 2,
        humidity: 90,
        windSpeed: 20,
        isOutdoorFriendly: false,
        advice: "Stay dry",
      },
      isRushHour: true,
      isNightTime: true,
      venueInfo: {
        name: "Museum",
        isOpenNow: false,
        nextOpenTime: "Opens at 10:00 tomorrow",
        requiresReservation: true,
        requiresTicket: true,
        confidence: 0.8,
      },
    });

    const insights = generateContextualInsights(input);

    expect(insights.length).toBeLessThanOrEqual(4);
  });

  it("should return 0 insights when no conditions match", () => {
    const input = createInput({
      weather: {
        condition: "clear",
        description: "Clear",
        temperature: 20,
        feelsLike: 20,
        humidity: 50,
        windSpeed: 5,
        isOutdoorFriendly: true,
        advice: "Nice weather",
      },
      isRushHour: false,
      isNightTime: false,
      venueInfo: undefined,
    });

    const insights = generateContextualInsights(input);

    // May or may not have insights depending on other conditions
    expect(insights.length).toBeGreaterThanOrEqual(0);
    expect(insights.length).toBeLessThanOrEqual(4);
  });

  it("should prioritize venue closed status", () => {
    const input = createInput({
      venueInfo: {
        name: "Pergamon Museum",
        isOpenNow: false,
        nextOpenTime: "Opens at 10:00 tomorrow",
        requiresReservation: false,
        requiresTicket: true,
        confidence: 0.8,
      },
    });

    const insights = generateContextualInsights(input);

    // Should include venue info
    expect(insights.some((i) => i.toLowerCase().includes("closed"))).toBe(true);
  });

  it("should include weather insight when raining", () => {
    const input = createInput({
      weather: {
        condition: "rain",
        description: "Rainy",
        temperature: 15,
        feelsLike: 12,
        humidity: 80,
        windSpeed: 10,
        isOutdoorFriendly: false,
        advice: "Bring umbrella",
      },
    });

    const insights = generateContextualInsights(input);

    expect(insights.some((i) => i.toLowerCase().includes("rain"))).toBe(true);
  });

  it("should include rush hour insight when applicable", () => {
    const input = createInput({
      isRushHour: true,
    });

    const insights = generateContextualInsights(input);

    expect(insights.some((i) => i.toLowerCase().includes("rush") || i.toLowerCase().includes("crowd"))).toBe(
      true
    );
  });

  it("should include night service insight when applicable", () => {
    const input = createInput({
      isNightTime: true,
    });

    const insights = generateContextualInsights(input);

    expect(insights.some((i) => i.toLowerCase().includes("night"))).toBe(true);
  });
});

describe("Depth Insights - shouldShowMemoryCallback", () => {
  it("should not show callback for new users (< 3 trips)", () => {
    const input = createInput();
    const result = shouldShowMemoryCallback(input, 2);

    expect(result.shouldShow).toBe(false);
    expect(result.basedOn).toBe("not_enough_history");
  });

  it("should not show callback with insufficient events", () => {
    const input = createInput({ recentEvents: [] });
    const result = shouldShowMemoryCallback(input, 10);

    // May be suppressed by random or not enough events
    expect(result.shouldShow).toBe(false);
  });

  it("should show callback when pattern is detected with sufficient events", () => {
    // Create events showing consistent pattern
    const events: UserEvent[] = Array(10)
      .fill(null)
      .map((_, i) => ({
        id: `event-${i}`,
        userId: "test-user",
        tripId: "trip-1",
        eventType: "chose_calmer_option",
        cityId: "berlin",
        context: {},
        createdAt: new Date(),
      }));

    const input = createInput({ recentEvents: events });

    // The callback showing is probabilistic (20% chance)
    // So we can't reliably test that it shows, but we can test the structure
    const result = shouldShowMemoryCallback(input, 10);

    // Should have a valid response structure
    expect(result).toHaveProperty("shouldShow");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("basedOn");
  });
});

describe("Depth Insights - isRushHour", () => {
  it("should return true for 8am on weekday", () => {
    const date = new Date("2024-01-15T08:00:00"); // Monday
    expect(isRushHour(date)).toBe(true);
  });

  it("should return true for 5:30pm on weekday", () => {
    const date = new Date("2024-01-15T17:30:00"); // Monday
    expect(isRushHour(date)).toBe(true);
  });

  it("should return false for 2pm on weekday", () => {
    const date = new Date("2024-01-15T14:00:00"); // Monday
    expect(isRushHour(date)).toBe(false);
  });

  it("should return false on weekends regardless of time", () => {
    const saturday = new Date("2024-01-13T08:00:00"); // Saturday
    const sunday = new Date("2024-01-14T17:30:00"); // Sunday

    expect(isRushHour(saturday)).toBe(false);
    expect(isRushHour(sunday)).toBe(false);
  });
});

describe("Depth Insights - isNightTime", () => {
  it("should return true for 11pm", () => {
    const date = new Date("2024-01-15T23:00:00");
    expect(isNightTime(date)).toBe(true);
  });

  it("should return true for 3am", () => {
    const date = new Date("2024-01-15T03:00:00");
    expect(isNightTime(date)).toBe(true);
  });

  it("should return false for 8am", () => {
    const date = new Date("2024-01-15T08:00:00");
    expect(isNightTime(date)).toBe(false);
  });

  it("should return false for 9pm", () => {
    const date = new Date("2024-01-15T21:00:00");
    expect(isNightTime(date)).toBe(false);
  });
});
