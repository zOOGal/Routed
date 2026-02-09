/**
 * USER MEMORY LEARNING RULES — TESTS
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyEvent,
  applyEvents,
  calculateConfidence,
  hasSignificantDivergence,
  shouldShowMemoryCallback,
} from "../learn";
import {
  createDefaultProfile,
  DEFAULT_USER_PREFS,
  profileToScoringBiases,
  generateMemoryInsight,
} from "../types";
import type { UserProfile, ProfileEvent } from "../types";

function createEvent(
  type: ProfileEvent["type"],
  payload?: ProfileEvent["payload"]
): ProfileEvent {
  return {
    id: `event-${Math.random().toString(36).slice(2)}`,
    userId: "test-user",
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
}

describe("applyEvent", () => {
  let profile: UserProfile;

  beforeEach(() => {
    profile = createDefaultProfile("test-user");
  });

  describe("walking behavior", () => {
    it("increases walking tolerance when user walks more than expected", () => {
      const event = createEvent("walked_more_than_expected");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.walkingToleranceMin).toBeGreaterThan(profile.prefs.walkingToleranceMin);
      expect(updated.prefs.walkingToleranceMax).toBeGreaterThan(profile.prefs.walkingToleranceMax);
    });

    it("decreases walking tolerance when user walks less than expected", () => {
      const event = createEvent("walked_less_than_expected");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.walkingToleranceMin).toBeLessThan(profile.prefs.walkingToleranceMin);
      expect(updated.prefs.walkingToleranceMax).toBeLessThan(profile.prefs.walkingToleranceMax);
    });
  });

  describe("speed preference", () => {
    it("shifts bias toward fast when user chooses faster option", () => {
      const event = createEvent("chose_faster_option");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.calmQuickBias).toBeGreaterThan(profile.prefs.calmQuickBias);
    });

    it("shifts bias toward calm when user chooses calmer option", () => {
      const event = createEvent("chose_calmer_option");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.calmQuickBias).toBeLessThan(profile.prefs.calmQuickBias);
    });
  });

  describe("cost preference", () => {
    it("shifts bias toward cost when user chooses cheaper option", () => {
      const event = createEvent("chose_cheaper_option");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.costComfortBias).toBeLessThan(profile.prefs.costComfortBias);
    });

    it("shifts bias toward comfort when user chooses comfort option", () => {
      const event = createEvent("chose_comfort_option");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.costComfortBias).toBeGreaterThan(profile.prefs.costComfortBias);
    });
  });

  describe("route override", () => {
    it("adjusts preferences when overriding to rideshare", () => {
      const event = createEvent("route_override", {
        originalMode: "transit",
        chosenMode: "rideshare",
      });
      const updated = applyEvent(profile, event);

      expect(updated.prefs.costComfortBias).toBeGreaterThan(profile.prefs.costComfortBias);
      expect(updated.prefs.walkingToleranceMax).toBeLessThan(profile.prefs.walkingToleranceMax);
    });

    it("adjusts preferences when overriding to walk", () => {
      const event = createEvent("route_override", {
        originalMode: "transit",
        chosenMode: "walk",
      });
      const updated = applyEvent(profile, event);

      expect(updated.prefs.walkingToleranceMax).toBeGreaterThan(profile.prefs.walkingToleranceMax);
      expect(updated.prefs.outdoorBias).toBeGreaterThan(profile.prefs.outdoorBias);
    });

    it("responds to reason keywords like tired", () => {
      const event = createEvent("route_override", {
        originalMode: "transit",
        chosenMode: "rideshare",
        overrideReason: "I'm tired today",
      });
      const updated = applyEvent(profile, event);

      // Should have extra decreases for tired
      expect(updated.prefs.walkingToleranceMax).toBeLessThan(profile.prefs.walkingToleranceMax - 2);
    });
  });

  describe("trip completion", () => {
    it("increases total trips on trip_completed", () => {
      const event = createEvent("trip_completed", { cityCode: "berlin" });
      const updated = applyEvent(profile, event);

      expect(updated.totalTrips).toBe(1);
    });

    it("increases city familiarity on trip_completed", () => {
      const event = createEvent("trip_completed", { cityCode: "berlin" });
      const updated = applyEvent(profile, event);

      expect(updated.cityFamiliarity["berlin"]).toBeGreaterThan(0);
    });

    it("sets lastTripAt on trip_completed", () => {
      const event = createEvent("trip_completed", { cityCode: "berlin" });
      const updated = applyEvent(profile, event);

      expect(updated.lastTripAt).toBeTruthy();
    });
  });

  describe("replan behavior", () => {
    it("increases replan sensitivity when accepted", () => {
      const event = createEvent("replan_accepted");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.replanSensitivity).toBeGreaterThan(profile.prefs.replanSensitivity);
    });

    it("decreases replan sensitivity when declined", () => {
      const event = createEvent("replan_declined");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.replanSensitivity).toBeLessThan(profile.prefs.replanSensitivity);
    });
  });

  describe("in-app ride request", () => {
    it("signals comfort preference", () => {
      const event = createEvent("requested_in_app_ride");
      const updated = applyEvent(profile, event);

      expect(updated.prefs.costComfortBias).toBeGreaterThan(profile.prefs.costComfortBias);
    });
  });

  describe("note keywords", () => {
    it("responds to urgency keywords", () => {
      const event = createEvent("note_added", { keywords: ["urgent", "meeting"] });
      const updated = applyEvent(profile, event);

      expect(updated.prefs.calmQuickBias).toBeGreaterThan(profile.prefs.calmQuickBias);
    });

    it("responds to comfort keywords", () => {
      const event = createEvent("note_added", { keywords: ["date", "romantic"] });
      const updated = applyEvent(profile, event);

      expect(updated.prefs.costComfortBias).toBeGreaterThan(profile.prefs.costComfortBias);
    });

    it("responds to budget keywords", () => {
      const event = createEvent("note_added", { keywords: ["budget", "cheap"] });
      const updated = applyEvent(profile, event);

      expect(updated.prefs.costComfortBias).toBeLessThan(profile.prefs.costComfortBias);
    });
  });
});

describe("clamping", () => {
  it("clamps values within valid ranges", () => {
    let profile = createDefaultProfile("test-user");

    // Apply many events to push values to extremes
    for (let i = 0; i < 100; i++) {
      profile = applyEvent(profile, createEvent("chose_faster_option"));
    }

    expect(profile.prefs.calmQuickBias).toBeLessThanOrEqual(1);
    expect(profile.prefs.calmQuickBias).toBeGreaterThanOrEqual(-1);
  });

  it("maintains walkingToleranceMin <= walkingToleranceMax", () => {
    let profile = createDefaultProfile("test-user");
    // Set min high
    profile.prefs.walkingToleranceMin = 25;
    profile.prefs.walkingToleranceMax = 20;

    // Apply event to trigger clamping
    const updated = applyEvent(profile, createEvent("trip_completed"));

    expect(updated.prefs.walkingToleranceMin).toBeLessThanOrEqual(updated.prefs.walkingToleranceMax);
  });
});

describe("applyEvents", () => {
  it("applies multiple events in sequence", () => {
    const profile = createDefaultProfile("test-user");

    const events = [
      createEvent("chose_faster_option"),
      createEvent("chose_faster_option"),
      createEvent("chose_faster_option"),
      createEvent("trip_completed", { cityCode: "nyc" }),
    ];

    const updated = applyEvents(profile, events);

    expect(updated.prefs.calmQuickBias).toBeGreaterThan(profile.prefs.calmQuickBias + 0.1);
    expect(updated.totalTrips).toBe(1);
    expect(updated.cityFamiliarity["nyc"]).toBeGreaterThan(0);
  });
});

describe("calculateConfidence", () => {
  it("returns low confidence for new users", () => {
    const profile = createDefaultProfile("test-user");
    const confidence = calculateConfidence(profile, []);

    expect(confidence).toBeLessThan(0.5);
  });

  it("increases confidence with more trips", () => {
    const profile = createDefaultProfile("test-user");
    profile.totalTrips = 10;

    const confidence = calculateConfidence(profile, []);

    expect(confidence).toBeGreaterThan(0.4);
  });

  it("boosts confidence with consistent choices", () => {
    const profile = createDefaultProfile("test-user");
    profile.totalTrips = 10;

    const consistentEvents = [
      createEvent("chose_faster_option"),
      createEvent("chose_faster_option"),
      createEvent("chose_faster_option"),
      createEvent("chose_faster_option"),
    ];

    const confidence = calculateConfidence(profile, consistentEvents);

    expect(confidence).toBeGreaterThan(0.6);
  });
});

describe("hasSignificantDivergence", () => {
  it("returns false for default preferences", () => {
    const prefs = { ...DEFAULT_USER_PREFS };
    expect(hasSignificantDivergence(prefs)).toBe(false);
  });

  it("returns true for significant divergence", () => {
    const prefs = { ...DEFAULT_USER_PREFS, calmQuickBias: 0.5 };
    expect(hasSignificantDivergence(prefs)).toBe(true);
  });
});

describe("profileToScoringBiases", () => {
  it("converts neutral profile to balanced biases", () => {
    const biases = profileToScoringBiases(DEFAULT_USER_PREFS);

    expect(biases.calm).toBeCloseTo(0.5, 1);
    expect(biases.fast).toBeCloseTo(0.5, 1);
    expect(biases.comfort).toBeCloseTo(0.5, 1);
    expect(biases.cost).toBeCloseTo(0.5, 1);
  });

  it("converts calm-biased profile correctly", () => {
    const prefs = { ...DEFAULT_USER_PREFS, calmQuickBias: -0.8 };
    const biases = profileToScoringBiases(prefs);

    expect(biases.calm).toBeGreaterThan(0.7);
    expect(biases.fast).toBeLessThan(0.3);
  });

  it("converts fast-biased profile correctly", () => {
    const prefs = { ...DEFAULT_USER_PREFS, calmQuickBias: 0.8 };
    const biases = profileToScoringBiases(prefs);

    expect(biases.calm).toBeLessThan(0.3);
    expect(biases.fast).toBeGreaterThan(0.7);
  });

  it("converts cost-conscious profile correctly", () => {
    const prefs = { ...DEFAULT_USER_PREFS, costComfortBias: -0.8 };
    const biases = profileToScoringBiases(prefs);

    expect(biases.cost).toBeGreaterThan(0.7);
    expect(biases.comfort).toBeLessThan(0.3);
  });

  it("converts comfort-seeking profile correctly", () => {
    const prefs = { ...DEFAULT_USER_PREFS, costComfortBias: 0.8 };
    const biases = profileToScoringBiases(prefs);

    expect(biases.cost).toBeLessThan(0.3);
    expect(biases.comfort).toBeGreaterThan(0.7);
  });
});

describe("generateMemoryInsight", () => {
  it("returns null for new users", () => {
    const profile = createDefaultProfile("test-user");
    const insight = generateMemoryInsight(profile, {});

    expect(insight).toBeNull();
  });

  it("returns insight for experienced user with strong preferences", () => {
    const profile = createDefaultProfile("test-user");
    profile.totalTrips = 15;
    profile.prefs.calmQuickBias = -0.7; // Strong calm preference (confidence = 0.7 > 0.5)

    const insight = generateMemoryInsight(profile, {});

    expect(insight).not.toBeNull();
    expect(insight?.line).toContain("calm");
  });

  it("returns transfer-related insight when relevant", () => {
    const profile = createDefaultProfile("test-user");
    profile.totalTrips = 15;
    profile.prefs.transferTolerance = 0.2; // Dislikes transfers

    const insight = generateMemoryInsight(profile, { hasTransfers: false });

    expect(insight).not.toBeNull();
    expect(insight?.line).toContain("transfer");
  });

  it("returns city familiarity insight", () => {
    const profile = createDefaultProfile("test-user");
    profile.totalTrips = 10;
    profile.cityFamiliarity["berlin"] = 0.8;

    const insight = generateMemoryInsight(profile, { cityCode: "berlin" });

    expect(insight).not.toBeNull();
    expect(insight?.line).toContain("know this city");
  });
});

describe("shouldShowMemoryCallback", () => {
  it("returns false for new users", () => {
    const profile = createDefaultProfile("test-user");
    expect(shouldShowMemoryCallback(profile, 0.8)).toBe(false);
  });

  it("returns false for low confidence", () => {
    const profile = createDefaultProfile("test-user");
    profile.totalTrips = 20;
    expect(shouldShowMemoryCallback(profile, 0.3)).toBe(false);
  });

  it("returns false when no significant divergence", () => {
    const profile = createDefaultProfile("test-user");
    profile.totalTrips = 20;
    // prefs are still default
    expect(shouldShowMemoryCallback(profile, 0.8)).toBe(false);
  });
});

describe("scoring with different profiles", () => {
  it("profiles with different biases produce different scoring weights", () => {
    const calmProfile = { ...DEFAULT_USER_PREFS, calmQuickBias: -0.8 };
    const fastProfile = { ...DEFAULT_USER_PREFS, calmQuickBias: 0.8 };

    const calmBiases = profileToScoringBiases(calmProfile);
    const fastBiases = profileToScoringBiases(fastProfile);

    // These should be significantly different
    expect(Math.abs(calmBiases.calm - fastBiases.calm)).toBeGreaterThan(0.5);
    expect(Math.abs(calmBiases.fast - fastBiases.fast)).toBeGreaterThan(0.5);
  });
});
