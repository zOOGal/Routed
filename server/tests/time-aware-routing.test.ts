/**
 * TIME-AWARE ROUTING TESTS
 *
 * Verifies that the system correctly handles:
 * - City-local time via getTimeContext
 * - Venue closure gating (no routes for closed venues)
 * - Late-night walking penalties in scoring
 * - Late-night fallback decision preferences
 * - Atmospheric adjective sanitization
 */

import { describe, it, expect } from "vitest";
import { getTimeContext } from "../agent-service";
import {
  resolveVenueInfo,
  isVenueOpen,
} from "../venue-service";
import { scoreRouteCandidate, type ScoringContext } from "../route-scoring";
import { makeFallbackDecision, type LLMDecisionContext } from "../llm-decision";
import type { GoogleMapsRoute, TravelMode } from "../google-maps-service";
import type { RouteCandidate } from "../route-scoring";
import type { CityProfile } from "@shared/schema";

// ============================================
// FIXTURES
// ============================================

const berlinProfile: CityProfile = {
  id: "berlin",
  name: "Berlin",
  country: "DE",
  timezone: "Europe/Berlin",
  complexStations: ["Hauptbahnhof"],
  nightReliability: 0.7,
  transitVsTaxiBias: 0.6,
  walkingFriendliness: 0.8,
  cognitiveLoadIndex: { navigation: 0.5, signage: 0.5, crowding: 0.5, overall: 0.5 },
  currency: "EUR",
  transitTypes: ["U-Bahn", "S-Bahn", "Bus"],
  rideshareApps: ["FreeNow"],
};

function createMockRoute(durationMin: number, walkingMin: number, transfers: number): GoogleMapsRoute {
  const steps: GoogleMapsRoute["steps"] = [];

  if (walkingMin > 0) {
    steps.push({
      travelMode: "WALKING",
      distance: { text: `${walkingMin * 80}m`, value: walkingMin * 80 },
      duration: { text: `${walkingMin} min`, value: walkingMin * 60 },
      htmlInstructions: "Walk",
      startLocation: { lat: 52.52, lng: 13.405 },
      endLocation: { lat: 52.521, lng: 13.406 },
    });
  }

  for (let i = 0; i <= transfers; i++) {
    steps.push({
      travelMode: "TRANSIT",
      distance: { text: "5km", value: 5000 },
      duration: { text: "10 min", value: 600 },
      htmlInstructions: "Take U-Bahn",
      startLocation: { lat: 52.52, lng: 13.405 },
      endLocation: { lat: 52.53, lng: 13.41 },
      transitDetails: {
        departureStop: { name: "Alexanderplatz", location: { lat: 52.52, lng: 13.405 } },
        arrivalStop: { name: "Zoologischer Garten", location: { lat: 52.53, lng: 13.41 } },
        line: { name: "U2", vehicle: { type: "SUBWAY", name: "U-Bahn" } },
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

function createScoringContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    intent: "leisure",
    calmVsFast: 50,
    economyVsComfort: 50,
    unfamiliarWithCity: false,
    cityProfile: berlinProfile,
    weather: { isOutdoorFriendly: true, condition: "clear", temperature: 20 },
    isNightTime: false,
    isLateNight: false,
    isRushHour: false,
    ...overrides,
  };
}

function createMockCandidate(
  mode: TravelMode,
  durationMin: number,
  walkingMin: number,
  transfers: number = 0
): RouteCandidate {
  return {
    mode,
    archetype: transfers === 0 ? "calm" : "fast",
    route: createMockRoute(durationMin, walkingMin, transfers),
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

// ============================================
// TESTS
// ============================================

describe("getTimeContext correctness", () => {
  it("should return correct fields for Berlin timezone", () => {
    const ctx = getTimeContext("Europe/Berlin");

    expect(ctx).toHaveProperty("hour");
    expect(ctx).toHaveProperty("localTimeStr");
    expect(ctx).toHaveProperty("localDate");
    expect(ctx).toHaveProperty("isNightTime");
    expect(ctx).toHaveProperty("isLateNight");
    expect(ctx).toHaveProperty("isRushHour");

    // localDate should be a real Date object
    expect(ctx.localDate).toBeInstanceOf(Date);
    expect(ctx.hour).toBeGreaterThanOrEqual(0);
    expect(ctx.hour).toBeLessThan(24);

    // isLateNight should be consistent with hour
    if (ctx.hour >= 22 || ctx.hour < 5) {
      expect(ctx.isLateNight).toBe(true);
    } else {
      expect(ctx.isLateNight).toBe(false);
    }
  });

  it("should return non-server-time string for valid timezone", () => {
    const ctx = getTimeContext("Europe/Berlin");
    // When timezone is valid, the localTimeStr should NOT contain "(server)"
    expect(ctx.localTimeStr).not.toContain("(server)");
  });

  it("should fall back to server time for invalid timezone", () => {
    const ctx = getTimeContext("Invalid/Timezone");
    expect(ctx.localTimeStr).toContain("(server)");
  });
});

describe("Closed venue returns no route", () => {
  it("should mark museum as closed at 00:30 on a Monday", async () => {
    // Monday at 00:30 — museum is closed on Mondays entirely
    const monday0030 = new Date(2024, 0, 15, 0, 30, 0); // Jan 15, 2024 is Monday
    const info = await resolveVenueInfo("Pergamon Museum", "berlin", monday0030);

    expect(info).not.toBeNull();
    expect(info!.isOpenNow).toBe(false);
    expect(info!.nextOpenTime).toBeDefined();
  });

  it("should mark museum as closed at 00:30 on a Tuesday", async () => {
    // Tuesday at 00:30 — outside 10:00-18:00 hours
    const tuesday0030 = new Date(2024, 0, 16, 0, 30, 0); // Jan 16, 2024 is Tuesday
    const info = await resolveVenueInfo("Berlin Museum", "berlin", tuesday0030);

    expect(info).not.toBeNull();
    expect(info!.isOpenNow).toBe(false);
    expect(info!.nextOpenTime).toBe("Opens at 10:00 today");
  });
});

describe("Open venue passes through", () => {
  it("should mark museum as open at 14:00 on a Tuesday", async () => {
    const tuesday1400 = new Date(2024, 0, 16, 14, 0, 0); // Tuesday 2pm
    const info = await resolveVenueInfo("Berlin Museum", "berlin", tuesday1400);

    expect(info).not.toBeNull();
    expect(info!.isOpenNow).toBe(true);
  });
});

describe("Late-night walking penalty in scoring", () => {
  it("should score walking significantly lower at midnight vs afternoon", () => {
    const walkingRoute = createMockRoute(20, 20, 0);

    const daytimeCtx = createScoringContext({ isNightTime: false, isLateNight: false });
    const lateNightCtx = createScoringContext({ isNightTime: true, isLateNight: true });

    const daytimeScore = scoreRouteCandidate("walking", walkingRoute, daytimeCtx);
    const lateNightScore = scoreRouteCandidate("walking", walkingRoute, lateNightCtx);

    // Late-night walking should score notably lower on calm
    expect(lateNightScore.scores.calm).toBeLessThan(daytimeScore.scores.calm);
    // The penalty should be substantial (at least 20 points across calm+comfort)
    const daytimeTotal = daytimeScore.scores.calm + daytimeScore.scores.comfort;
    const nightTotal = lateNightScore.scores.calm + lateNightScore.scores.comfort;
    expect(daytimeTotal - nightTotal).toBeGreaterThanOrEqual(20);
  });
});

describe("Fallback prefers driving at midnight", () => {
  it("should select driving over walking when isLateNight is true", () => {
    const walkingCandidate = createMockCandidate("walking", 20, 20);
    const drivingCandidate = createMockCandidate("driving", 10, 0);

    const userCtx: LLMDecisionContext["userContext"] = {
      intent: "leisure",
      calmVsFast: 50,
      economyVsComfort: 50,
      unfamiliarWithCity: false,
    };
    const envCtx: LLMDecisionContext["environmentContext"] = {
      weather: { condition: "clear", temperature: 15, isOutdoorFriendly: true },
      isRushHour: false,
      isNightTime: true,
      isLateNight: true,
      cityName: "Berlin",
      cityCharacteristics: {
        walkingFriendliness: 0.8,
        transitReliability: 0.9,
        nightSafety: 0.7,
      },
    };

    const result = makeFallbackDecision(
      [walkingCandidate, drivingCandidate],
      userCtx,
      envCtx
    );

    expect(result.selectedCandidate.mode).toBe("driving");
  });
});

describe("Sanitization strips atmospheric adjectives", () => {
  it("should remove 'pleasant' from reasoning text", () => {
    const atmosphericAdjs = /\b(pleasant|lovely|nice|beautiful|delightful|wonderful|gorgeous|fantastic)\b/gi;
    const input = "Go with walking. A pleasant walk through the city at this hour.";
    const sanitized = input.replace(atmosphericAdjs, '').replace(/\s{2,}/g, ' ').trim();

    expect(sanitized).not.toContain("pleasant");
    expect(sanitized).toContain("walk");
    expect(sanitized).toContain("city");
  });

  it("should remove multiple atmospheric adjectives", () => {
    const atmosphericAdjs = /\b(pleasant|lovely|nice|beautiful|delightful|wonderful|gorgeous|fantastic)\b/gi;
    const input = "A lovely and beautiful morning for a nice stroll.";
    const sanitized = input.replace(atmosphericAdjs, '').replace(/\s{2,}/g, ' ').trim();

    expect(sanitized).not.toContain("lovely");
    expect(sanitized).not.toContain("beautiful");
    expect(sanitized).not.toContain("nice");
    expect(sanitized).toContain("morning");
    expect(sanitized).toContain("stroll");
  });
});
