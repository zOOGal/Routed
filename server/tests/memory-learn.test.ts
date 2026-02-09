import { describe, it, expect } from "vitest";
import {
  applyEventToPreferences,
  applyEventsToPreferences,
  calculatePreferenceConfidence,
  hasSignificantChange,
  initializePreferences,
} from "../memory/learn";
import { DEFAULT_LEARNED_PREFERENCES } from "../depth/types";
import type { UserEvent, LearnedPreferences } from "@shared/schema";

// Helper to create a mock event
function createEvent(
  eventType: string,
  context: Record<string, unknown> = {},
  cityId?: string
): UserEvent {
  return {
    id: "test-event-id",
    userId: "test-user-id",
    tripId: "test-trip-id",
    eventType,
    cityId: cityId || null,
    context,
    createdAt: new Date(),
  };
}

describe("Memory Learning - applyEventToPreferences", () => {
  it("should decrease walking tolerance when user walked less than suggested", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, walkingToleranceMin: 10 };
    const event = createEvent("walked_less_than_suggested");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.walkingToleranceMin).toBeLessThan(prefs.walkingToleranceMin);
  });

  it("should increase walking tolerance when user walked more than suggested", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, walkingToleranceMin: 10 };
    const event = createEvent("walked_more_than_suggested");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.walkingToleranceMin).toBeGreaterThan(prefs.walkingToleranceMin);
  });

  it("should shift calmQuickBias toward calm when user chose calmer option", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.5 };
    const event = createEvent("chose_calmer_option");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.calmQuickBias).toBeLessThan(prefs.calmQuickBias);
  });

  it("should shift calmQuickBias toward fast when user chose faster option", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.5 };
    const event = createEvent("chose_faster_option");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.calmQuickBias).toBeGreaterThan(prefs.calmQuickBias);
  });

  it("should decrease replan sensitivity when user declines replan", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, replanSensitivity: 0.5 };
    const event = createEvent("replan_declined");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.replanSensitivity).toBeLessThan(prefs.replanSensitivity);
  });

  it("should increase replan sensitivity when user accepts replan", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, replanSensitivity: 0.5 };
    const event = createEvent("replan_accepted");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.replanSensitivity).toBeGreaterThan(prefs.replanSensitivity);
  });

  it("should increase city familiarity on trip completion", () => {
    const prefs = {
      ...DEFAULT_LEARNED_PREFERENCES,
      familiarityByCity: { berlin: 0.3 },
    };
    const event = createEvent("trip_completed", { cityId: "berlin" }, "berlin");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.familiarityByCity.berlin).toBeGreaterThan(0.3);
  });

  it("should decrease city familiarity on abandoned trip", () => {
    const prefs = {
      ...DEFAULT_LEARNED_PREFERENCES,
      familiarityByCity: { berlin: 0.5 },
    };
    const event = createEvent("abandoned_trip", { cityId: "berlin" }, "berlin");

    const updated = applyEventToPreferences(prefs, event);

    expect(updated.familiarityByCity.berlin).toBeLessThan(0.5);
  });

  it("should update lastUpdated timestamp", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES };
    const oldTimestamp = prefs.lastUpdated;
    const event = createEvent("chose_calmer_option");

    // Small delay to ensure timestamp is different
    const updated = applyEventToPreferences(prefs, event);

    expect(updated.lastUpdated).not.toEqual(oldTimestamp);
  });

  it("should not modify preferences for unknown event types", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES };
    const event = createEvent("unknown_event_type");

    const updated = applyEventToPreferences(prefs, event);

    // Only lastUpdated should change
    expect(updated.walkingToleranceMin).toEqual(prefs.walkingToleranceMin);
    expect(updated.calmQuickBias).toEqual(prefs.calmQuickBias);
    expect(updated.replanSensitivity).toEqual(prefs.replanSensitivity);
  });

  it("should respect minimum bounds (walkingToleranceMin >= 5)", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, walkingToleranceMin: 5.1 };

    // Apply many "walked less" events
    let current = prefs;
    for (let i = 0; i < 20; i++) {
      current = applyEventToPreferences(current, createEvent("walked_less_than_suggested"));
    }

    expect(current.walkingToleranceMin).toBeGreaterThanOrEqual(5);
  });

  it("should respect maximum bounds (calmQuickBias <= 1)", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.98 };

    // Apply many "chose faster" events
    let current = prefs;
    for (let i = 0; i < 20; i++) {
      current = applyEventToPreferences(current, createEvent("chose_faster_option"));
    }

    expect(current.calmQuickBias).toBeLessThanOrEqual(1);
  });
});

describe("Memory Learning - applyEventsToPreferences", () => {
  it("should apply multiple events in sequence", () => {
    const prefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.5 };
    const events = [
      createEvent("chose_calmer_option"),
      createEvent("chose_calmer_option"),
      createEvent("chose_calmer_option"),
    ];

    const updated = applyEventsToPreferences(prefs, events);

    expect(updated.calmQuickBias).toBeLessThan(0.5);
    expect(updated.calmQuickBias).toBeLessThan(
      applyEventToPreferences(prefs, events[0]).calmQuickBias
    );
  });
});

describe("Memory Learning - calculatePreferenceConfidence", () => {
  it("should return low confidence with no events", () => {
    const confidence = calculatePreferenceConfidence([]);
    expect(confidence).toBeLessThan(0.5);
  });

  it("should increase confidence with more events", () => {
    const fewEvents = [createEvent("trip_completed")];
    const manyEvents = Array(20)
      .fill(null)
      .map(() => createEvent("trip_completed"));

    const lowConfidence = calculatePreferenceConfidence(fewEvents);
    const highConfidence = calculatePreferenceConfidence(manyEvents);

    expect(highConfidence).toBeGreaterThan(lowConfidence);
  });

  it("should not exceed 0.95 confidence", () => {
    const manyEvents = Array(100)
      .fill(null)
      .map(() => createEvent("trip_completed"));

    const confidence = calculatePreferenceConfidence(manyEvents);

    expect(confidence).toBeLessThanOrEqual(0.95);
  });
});

describe("Memory Learning - hasSignificantChange", () => {
  it("should detect significant changes", () => {
    const oldPrefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.3 };
    const newPrefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.8 };

    expect(hasSignificantChange(oldPrefs, newPrefs)).toBe(true);
  });

  it("should not flag minor changes as significant", () => {
    const oldPrefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.5 };
    const newPrefs = { ...DEFAULT_LEARNED_PREFERENCES, calmQuickBias: 0.52 };

    expect(hasSignificantChange(oldPrefs, newPrefs)).toBe(false);
  });
});

describe("Memory Learning - initializePreferences", () => {
  it("should return default preferences", () => {
    const prefs = initializePreferences();

    expect(prefs.walkingToleranceMin).toBe(DEFAULT_LEARNED_PREFERENCES.walkingToleranceMin);
    expect(prefs.calmQuickBias).toBe(DEFAULT_LEARNED_PREFERENCES.calmQuickBias);
    expect(prefs.transferTolerance).toBe(DEFAULT_LEARNED_PREFERENCES.transferTolerance);
  });
});
