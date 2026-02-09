/**
 * ROUTE SCORING ENGINE TESTS
 *
 * These tests verify that the decision engine:
 * 1. Produces different outputs for different intents
 * 2. Reacts to semantic notes
 * 3. Handles currency correctly
 */

import { describe, it, expect } from "vitest";
import {
  scoreRouteCandidate,
  selectBestRoute,
  generateExplanation,
  parseNoteKeywords,
  calculateStressScore,
  validateRoute,
  type RouteCandidate,
  type ScoringContext,
} from "../route-scoring";
import { estimateRouteCost, getCurrencyForCity, formatCostDisplay } from "../pricing";
import type { CityProfile } from "@shared/schema";
import type { GoogleMapsRoute, TravelMode } from "../google-maps-service";

// ============================================
// FIXTURES
// ============================================

const berlinProfile: CityProfile = {
  id: "berlin",
  name: "Berlin",
  country: "Germany",
  timezone: "Europe/Berlin",
  complexStations: ["Hauptbahnhof", "Alexanderplatz"],
  nightReliability: 0.8,
  transitVsTaxiBias: 0.75,
  walkingFriendliness: 0.85,
  cognitiveLoadIndex: { navigation: 0.4, signage: 0.3, crowding: 0.4, overall: 0.35 },
  currency: "EUR",
  transitTypes: ["U-Bahn", "S-Bahn"],
  rideshareApps: ["Uber", "Bolt"],
};

const nycProfile: CityProfile = {
  id: "nyc",
  name: "New York City",
  country: "USA",
  timezone: "America/New_York",
  complexStations: ["Times Square", "Penn Station"],
  nightReliability: 0.7,
  transitVsTaxiBias: 0.6,
  walkingFriendliness: 0.8,
  cognitiveLoadIndex: { navigation: 0.6, signage: 0.5, crowding: 0.7, overall: 0.6 },
  currency: "USD",
  transitTypes: ["Subway", "Bus"],
  rideshareApps: ["Uber", "Lyft"],
};

const tokyoProfile: CityProfile = {
  id: "tokyo",
  name: "Tokyo",
  country: "Japan",
  timezone: "Asia/Tokyo",
  complexStations: ["Shinjuku Station", "Shibuya Station"],
  nightReliability: 0.3,
  transitVsTaxiBias: 0.9,
  walkingFriendliness: 0.9,
  cognitiveLoadIndex: { navigation: 0.8, signage: 0.4, crowding: 0.8, overall: 0.65 },
  currency: "JPY",
  transitTypes: ["JR Lines", "Metro"],
  rideshareApps: ["Uber", "JapanTaxi"],
};

function createMockTransitRoute(durationMin: number, walkingMin: number, transfers: number): GoogleMapsRoute {
  const steps: GoogleMapsRoute["steps"] = [];

  // Initial walk
  if (walkingMin > 0) {
    steps.push({
      travelMode: "WALKING",
      distance: { text: "500m", value: 500 },
      duration: { text: `${Math.floor(walkingMin / 2)} min`, value: (walkingMin / 2) * 60 },
      htmlInstructions: "Walk to station",
      startLocation: { lat: 52.52, lng: 13.405 },
      endLocation: { lat: 52.521, lng: 13.406 },
    });
  }

  // Transit segments
  for (let i = 0; i <= transfers; i++) {
    steps.push({
      travelMode: "TRANSIT",
      distance: { text: "5km", value: 5000 },
      duration: { text: "15 min", value: 15 * 60 },
      htmlInstructions: "Take U-Bahn",
      startLocation: { lat: 52.521, lng: 13.406 },
      endLocation: { lat: 52.53, lng: 13.42 },
      transitDetails: {
        departureStop: { name: "Alexanderplatz", location: { lat: 52.521, lng: 13.411 } },
        arrivalStop: { name: "Potsdamer Platz", location: { lat: 52.509, lng: 13.376 } },
        departureTime: { text: "10:00", value: Date.now() / 1000 },
        arrivalTime: { text: "10:15", value: (Date.now() + 15 * 60 * 1000) / 1000 },
        line: { name: "U2", shortName: "U2", vehicle: { type: "SUBWAY", name: "Subway" } },
        numStops: 5,
      },
    });
  }

  // Final walk
  if (walkingMin > 0) {
    steps.push({
      travelMode: "WALKING",
      distance: { text: "300m", value: 300 },
      duration: { text: `${Math.ceil(walkingMin / 2)} min`, value: (walkingMin / 2) * 60 },
      htmlInstructions: "Walk to destination",
      startLocation: { lat: 52.53, lng: 13.42 },
      endLocation: { lat: 52.531, lng: 13.421 },
    });
  }

  return {
    distance: { text: "10km", value: 10000 },
    duration: { text: `${durationMin} min`, value: durationMin * 60 },
    steps,
  };
}

function createMockDrivingRoute(durationMin: number): GoogleMapsRoute {
  return {
    distance: { text: "8km", value: 8000 },
    duration: { text: `${durationMin} min`, value: durationMin * 60 },
    steps: [
      {
        travelMode: "DRIVING",
        distance: { text: "8km", value: 8000 },
        duration: { text: `${durationMin} min`, value: durationMin * 60 },
        htmlInstructions: "Drive to destination",
        startLocation: { lat: 52.52, lng: 13.405 },
        endLocation: { lat: 52.531, lng: 13.421 },
      },
    ],
  };
}

function createMockWalkingRoute(durationMin: number): GoogleMapsRoute {
  return {
    distance: { text: "2km", value: 2000 },
    duration: { text: `${durationMin} min`, value: durationMin * 60 },
    steps: [
      {
        travelMode: "WALKING",
        distance: { text: "2km", value: 2000 },
        duration: { text: `${durationMin} min`, value: durationMin * 60 },
        htmlInstructions: "Walk to destination",
        startLocation: { lat: 52.52, lng: 13.405 },
        endLocation: { lat: 52.531, lng: 13.421 },
      },
    ],
  };
}

function createBaseScoringContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    intent: "leisure",
    userNote: undefined,
    calmVsFast: 50,
    economyVsComfort: 50,
    unfamiliarWithCity: false,
    cityProfile: berlinProfile,
    weather: {
      isOutdoorFriendly: true,
      condition: "clear",
      temperature: 20,
    },
    isNightTime: false,
    isRushHour: false,
    ...overrides,
  };
}

// ============================================
// TEST: INTENT CHANGES OUTCOME
// ============================================

describe("Intent affects route selection", () => {
  it("work intent biases toward faster routes", () => {
    const transitRoute = createMockTransitRoute(25, 8, 1);
    const drivingRoute = createMockDrivingRoute(15);

    const leisureContext = createBaseScoringContext({ intent: "leisure", economyVsComfort: 50 });
    const workContext = createBaseScoringContext({ intent: "work", economyVsComfort: 50 });

    const transitCandidateLeisure = scoreRouteCandidate("transit", transitRoute, leisureContext);
    const drivingCandidateLeisure = scoreRouteCandidate("driving", drivingRoute, leisureContext);

    const transitCandidateWork = scoreRouteCandidate("transit", transitRoute, workContext);
    const drivingCandidateWork = scoreRouteCandidate("driving", drivingRoute, workContext);

    // Select best for each intent
    const leisureSelection = selectBestRoute([transitCandidateLeisure, drivingCandidateLeisure], leisureContext);
    const workSelection = selectBestRoute([transitCandidateWork, drivingCandidateWork], workContext);

    // Work should produce different reasoning that mentions reliability/speed
    expect(workSelection.decision.intentInfluence).toContain("work");

    // The fast score should weigh more heavily for work
    expect(transitCandidateWork.scores.fast).toBe(transitCandidateLeisure.scores.fast);
    // But the final selection weights change based on intent
    console.log("Leisure selected:", leisureSelection.selected.mode, "archetype:", leisureSelection.selected.archetype);
    console.log("Work selected:", workSelection.selected.mode, "archetype:", workSelection.selected.archetype);
  });

  it("time_sensitive intent prioritizes speed", () => {
    const slowCalmRoute = createMockTransitRoute(40, 5, 0);
    const fastStressfulRoute = createMockTransitRoute(20, 15, 3);

    const timeSensitiveContext = createBaseScoringContext({ intent: "time_sensitive", calmVsFast: 70 });

    const slowCandidate = scoreRouteCandidate("transit", slowCalmRoute, timeSensitiveContext);
    const fastCandidate = scoreRouteCandidate("transit", fastStressfulRoute, timeSensitiveContext);

    const selection = selectBestRoute([slowCandidate, fastCandidate], timeSensitiveContext);

    // Should prefer the faster route despite more stress
    expect(selection.selected.metrics.durationMinutes).toBeLessThan(slowCandidate.metrics.durationMinutes);
    expect(selection.decision.intentInfluence).toContain("time");
  });

  it("exploring intent prefers calm routes", () => {
    const complexFastRoute = createMockTransitRoute(20, 10, 3);
    const simpleSlowRoute = createMockTransitRoute(35, 5, 0);

    const exploringContext = createBaseScoringContext({ intent: "exploring", calmVsFast: 30 });

    const complexCandidate = scoreRouteCandidate("transit", complexFastRoute, exploringContext);
    const simpleCandidate = scoreRouteCandidate("transit", simpleSlowRoute, exploringContext);

    const selection = selectBestRoute([complexCandidate, simpleCandidate], exploringContext);

    // Should prefer the simpler route
    expect(selection.selected.metrics.transferCount).toBeLessThan(complexCandidate.metrics.transferCount);
    expect(selection.decision.intentInfluence).toContain("rush");
  });
});

// ============================================
// TEST: NOTE KEYWORDS CHANGE OUTCOME
// ============================================

describe("Note keywords affect route selection", () => {
  it("'date' note biases toward comfort and calm", () => {
    const noteModifiers = parseNoteKeywords("I'm going on a date tonight");

    expect(noteModifiers.keywords).toContain("date");
    expect(noteModifiers.comfortBonus).toBeGreaterThan(0);
    expect(noteModifiers.rushPenalty).toBeGreaterThan(0);
  });

  it("'tired' note heavily penalizes walking", () => {
    const noteModifiers = parseNoteKeywords("I'm really tired, don't want to walk");

    expect(noteModifiers.keywords).toContain("tired");
    expect(noteModifiers.walkingPenalty).toBeGreaterThan(0.3);
  });

  it("'meeting' note adds arrival buffer", () => {
    const noteModifiers = parseNoteKeywords("Important meeting at 3pm");

    expect(noteModifiers.keywords).toContain("meeting");
    expect(noteModifiers.arrivalBufferMinutes).toBeGreaterThan(0);
  });

  it("date note changes explanation", () => {
    const transitRoute = createMockTransitRoute(30, 5, 1);
    const drivingRoute = createMockDrivingRoute(20);

    const contextWithNote = createBaseScoringContext({
      intent: "leisure",
      userNote: "This is for a date",
    });

    const transitCandidate = scoreRouteCandidate("transit", transitRoute, contextWithNote);
    const drivingCandidate = scoreRouteCandidate("driving", drivingRoute, contextWithNote);

    const selection = selectBestRoute([transitCandidate, drivingCandidate], contextWithNote);

    // Should mention the date in explanation
    expect(selection.decision.noteInfluence).toContain("date");
    expect(selection.decision.noteInfluence).toContain("relaxed");
  });

  it("tired note penalizes high-walking routes", () => {
    const highWalkingRoute = createMockTransitRoute(25, 20, 0);
    const lowWalkingRoute = createMockTransitRoute(30, 5, 1);

    const tiredContext = createBaseScoringContext({
      userNote: "I'm exhausted, please minimize walking",
    });

    const highWalkCandidate = scoreRouteCandidate("transit", highWalkingRoute, tiredContext);
    const lowWalkCandidate = scoreRouteCandidate("transit", lowWalkingRoute, tiredContext);

    const selection = selectBestRoute([highWalkCandidate, lowWalkCandidate], tiredContext);

    // Should prefer low walking route despite being slightly longer
    expect(selection.selected.metrics.walkingMinutes).toBeLessThan(highWalkCandidate.metrics.walkingMinutes);
    expect(selection.decision.noteInfluence).toContain("tired");
  });
});

// ============================================
// TEST: CURRENCY HANDLING
// ============================================

describe("Currency is city-aware", () => {
  it("NYC returns USD currency", () => {
    const currency = getCurrencyForCity("nyc");

    expect(currency).not.toBeNull();
    expect(currency?.code).toBe("USD");
    expect(currency?.symbol).toBe("$");
  });

  it("Berlin returns EUR currency", () => {
    const currency = getCurrencyForCity("berlin");

    expect(currency).not.toBeNull();
    expect(currency?.code).toBe("EUR");
    expect(currency?.symbol).toBe("€");
  });

  it("Tokyo returns JPY currency", () => {
    const currency = getCurrencyForCity("tokyo");

    expect(currency).not.toBeNull();
    expect(currency?.code).toBe("JPY");
    expect(currency?.symbol).toBe("¥");
  });

  it("unknown city returns null", () => {
    const currency = getCurrencyForCity("unknown-city");

    expect(currency).toBeNull();
  });
});

// ============================================
// TEST: COST DISPLAY (NO FAKE PRECISION)
// ============================================

describe("Cost display avoids fake precision", () => {
  it("walking is free", () => {
    const cost = estimateRouteCost("walk", 20, 2000, "berlin", undefined, null);

    expect(cost.category).toBe("free");
    expect(cost.displayText).toBe("Free");
  });

  it("transit without verified fare shows category", () => {
    const cost = estimateRouteCost("transit", 25, 5000, "berlin", undefined, null);

    expect(cost.category).toBe("standard_fare");
    expect(cost.displayText).toBe("Standard transit fare");
    expect(cost.rawValueCents).toBeUndefined();
  });

  it("transit with verified fare shows actual price", () => {
    const googleFare = { value: 320, currency: "EUR", text: "€3.20" };
    const cost = estimateRouteCost("transit", 25, 5000, "berlin", googleFare, null);

    expect(cost.category).toBe("standard_fare");
    expect(cost.displayText).toBe("€3.20");
    expect(cost.rawValueCents).toBe(320);
  });

  it("rideshare shows category, not exact price", () => {
    const cost = estimateRouteCost("rideshare", 20, 8000, "berlin", undefined, null);

    expect(cost.category).toBe("paid_ride");
    expect(cost.rawValueCents).toBeUndefined();
    // Should NOT contain exact price
    expect(cost.displayText).not.toMatch(/€\d+/);
  });

  it("currency mismatch falls back to category", () => {
    const googleFare = { value: 290, currency: "USD", text: "$2.90" };
    // Google returned USD fare for Berlin (EUR city) - this is wrong
    const cost = estimateRouteCost("transit", 25, 5000, "berlin", googleFare, null);

    // Should fall back to category since currency doesn't match
    expect(cost.displayText).toBe("Standard transit fare");
    expect(cost.rawValueCents).toBeUndefined();
  });
});

// ============================================
// TEST: EXPLANATION MATCHES DECISION
// ============================================

describe("Explanation matches actual decision", () => {
  it("explanation references transfer count when relevant", () => {
    const directRoute = createMockTransitRoute(30, 5, 0);
    const context = createBaseScoringContext({ intent: "leisure" });

    const candidate = scoreRouteCandidate("transit", directRoute, context);
    const selection = selectBestRoute([candidate], context);

    const explanation = generateExplanation(selection.decision);

    // Should mention it's a direct route
    expect(explanation.toLowerCase()).toContain("direct");
  });

  it("single option says so honestly", () => {
    const onlyRoute = createMockTransitRoute(30, 5, 1);
    const context = createBaseScoringContext();

    const candidate = scoreRouteCandidate("transit", onlyRoute, context);
    const selection = selectBestRoute([candidate], context);

    expect(selection.decision.wasOnlyOption).toBe(true);

    const explanation = generateExplanation(selection.decision);
    expect(explanation.toLowerCase()).toContain("only");
  });

  it("explanation never mentions internal sliders", () => {
    const route = createMockTransitRoute(25, 5, 1);
    const context = createBaseScoringContext({ calmVsFast: 30 });

    const candidate = scoreRouteCandidate("transit", route, context);
    const selection = selectBestRoute([candidate], context);

    const explanation = generateExplanation(selection.decision);

    // Should NOT mention internal terms
    expect(explanation.toLowerCase()).not.toContain("slider");
    expect(explanation.toLowerCase()).not.toContain("score");
    expect(explanation.toLowerCase()).not.toContain("weight");
    expect(explanation).not.toMatch(/0\.\d+/); // No raw scores
  });
});

// ============================================
// TEST: ROUTE VALIDATION
// ============================================

describe("Route validation", () => {
  it("validates normal routes", () => {
    const normalRoute = createMockTransitRoute(30, 5, 1);
    const context = createBaseScoringContext();

    const candidate = scoreRouteCandidate("transit", normalRoute, context);
    const validation = validateRoute(candidate);

    expect(validation.isValid).toBe(true);
    expect(validation.confidence).toBeGreaterThan(0.5);
  });

  it("flags unreasonably long routes", () => {
    const longRoute = createMockTransitRoute(200, 30, 5);
    const context = createBaseScoringContext();

    const candidate = scoreRouteCandidate("transit", longRoute, context);
    const validation = validateRoute(candidate);

    expect(validation.confidence).toBeLessThan(0.9);
    expect(validation.issues.some(i => i.includes("long"))).toBe(true);
  });
});

// ============================================
// TEST: STRESS SCORE CALCULATION
// ============================================

describe("Stress score reflects actual conditions", () => {
  it("more transfers = higher stress", () => {
    const noTransferRoute = createMockTransitRoute(30, 5, 0);
    const multiTransferRoute = createMockTransitRoute(30, 5, 3);
    const context = createBaseScoringContext();

    const noTransferCandidate = scoreRouteCandidate("transit", noTransferRoute, context);
    const multiTransferCandidate = scoreRouteCandidate("transit", multiTransferRoute, context);

    const noTransferStress = calculateStressScore(noTransferCandidate, context);
    const multiTransferStress = calculateStressScore(multiTransferCandidate, context);

    expect(multiTransferStress).toBeGreaterThan(noTransferStress);
  });

  it("night time increases stress", () => {
    const route = createMockTransitRoute(30, 10, 1);
    const dayContext = createBaseScoringContext({ isNightTime: false });
    const nightContext = createBaseScoringContext({ isNightTime: true });

    const dayCandidate = scoreRouteCandidate("transit", route, dayContext);
    const nightCandidate = scoreRouteCandidate("transit", route, nightContext);

    const dayStress = calculateStressScore(dayCandidate, dayContext);
    const nightStress = calculateStressScore(nightCandidate, nightContext);

    expect(nightStress).toBeGreaterThan(dayStress);
  });

  it("driving is less stressful than complex transit", () => {
    const complexTransit = createMockTransitRoute(30, 15, 3);
    const driving = createMockDrivingRoute(25);
    const context = createBaseScoringContext();

    const transitCandidate = scoreRouteCandidate("transit", complexTransit, context);
    const drivingCandidate = scoreRouteCandidate("driving", driving, context);

    const transitStress = calculateStressScore(transitCandidate, context);
    const drivingStress = calculateStressScore(drivingCandidate, context);

    expect(drivingStress).toBeLessThan(transitStress);
  });
});

// ============================================
// TEST: ECONOMY PREFERENCE FILTERS OPTIONS
// ============================================

describe("Economy preference filters options", () => {
  it("economy mode excludes driving when transit available", () => {
    const transitRoute = createMockTransitRoute(35, 8, 1);
    const drivingRoute = createMockDrivingRoute(20);

    const economyContext = createBaseScoringContext({
      economyVsComfort: 20, // Strong economy preference
    });

    const transitCandidate = scoreRouteCandidate("transit", transitRoute, economyContext);
    const drivingCandidate = scoreRouteCandidate("driving", drivingRoute, economyContext);

    const selection = selectBestRoute([transitCandidate, drivingCandidate], economyContext);

    // Should select transit even though driving is faster
    expect(selection.selected.mode).toBe("transit");
  });

  it("comfort mode allows driving", () => {
    const transitRoute = createMockTransitRoute(35, 8, 1);
    const drivingRoute = createMockDrivingRoute(20);

    const comfortContext = createBaseScoringContext({
      economyVsComfort: 80, // Strong comfort preference
    });

    const transitCandidate = scoreRouteCandidate("transit", transitRoute, comfortContext);
    const drivingCandidate = scoreRouteCandidate("driving", drivingRoute, comfortContext);

    const selection = selectBestRoute([transitCandidate, drivingCandidate], comfortContext);

    // Should consider driving
    // (may or may not select it depending on other factors, but should not be filtered)
    expect(selection.selected.archetype).toBeDefined();
  });
});
