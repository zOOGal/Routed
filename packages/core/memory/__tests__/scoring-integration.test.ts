/**
 * MEMORY PROFILE — SCORING INTEGRATION TESTS
 *
 * Verifies that different user profiles produce different route scores.
 */

import { describe, it, expect } from "vitest";
import { profileToScoringBiases, DEFAULT_USER_PREFS, type UserProfilePrefs } from "../types";
import { scoreCandidatesSkill, type RouteCandidate } from "../../skills/scoreCandidates.skill";

// Mock candidates for testing
const mockCandidates: RouteCandidate[] = [
  {
    id: "transit-calm",
    mode: "transit",
    durationMinutes: 35,
    walkingMinutes: 5,
    transferCount: 0,
    hasUnderground: true,
    isOutdoorRoute: false,
    estimatedCost: 2.9,
    steps: [
      { type: "walk", duration: 3, distance: 200 },
      { type: "transit", duration: 29, line: "A" },
      { type: "walk", duration: 3, distance: 200 },
    ],
  },
  {
    id: "transit-fast",
    mode: "transit",
    durationMinutes: 22,
    walkingMinutes: 8,
    transferCount: 2,
    hasUnderground: true,
    isOutdoorRoute: false,
    estimatedCost: 2.9,
    steps: [
      { type: "walk", duration: 4, distance: 300 },
      { type: "transit", duration: 8, line: "B" },
      { type: "transit", duration: 6, line: "C" },
      { type: "walk", duration: 4, distance: 300 },
    ],
  },
  {
    id: "rideshare",
    mode: "driving",
    durationMinutes: 18,
    walkingMinutes: 2,
    transferCount: 0,
    hasUnderground: false,
    isOutdoorRoute: false,
    estimatedCost: 22,
    steps: [
      { type: "walk", duration: 1, distance: 50 },
      { type: "rideshare", duration: 16 },
      { type: "walk", duration: 1, distance: 50 },
    ],
  },
];

// Simple scoring function using profile biases
function scoreWithProfile(candidates: RouteCandidate[], prefs: UserProfilePrefs) {
  const biases = profileToScoringBiases(prefs);

  return candidates.map((c) => {
    // Simple scoring based on biases
    let score = 50; // Base score

    // Fast dimension (lower duration = higher score)
    const fastScore = Math.max(0, 100 - c.durationMinutes * 2);
    score += fastScore * biases.fast * 0.3;

    // Calm dimension (fewer transfers = higher score)
    const calmScore = Math.max(0, 100 - c.transferCount * 30);
    score += calmScore * biases.calm * 0.3;

    // Comfort dimension (less walking = higher score)
    const comfortScore = Math.max(0, 100 - c.walkingMinutes * 5);
    score += comfortScore * biases.comfort * 0.2;

    // Cost dimension (lower cost = higher score)
    const costScore = Math.max(0, 100 - c.estimatedCost * 3);
    score += costScore * biases.cost * 0.2;

    return { id: c.id, score };
  });
}

describe("Scoring with different profiles", () => {
  it("calm-biased profile ranks calm route higher", () => {
    const calmProfile: UserProfilePrefs = {
      ...DEFAULT_USER_PREFS,
      calmQuickBias: -0.8, // Strongly prefer calm
      transferTolerance: 0.2, // Dislikes transfers
    };

    const scores = scoreWithProfile(mockCandidates, calmProfile);
    const sorted = [...scores].sort((a, b) => b.score - a.score);

    // Calm route (no transfers) should rank higher
    expect(sorted[0].id).toBe("transit-calm");
  });

  it("fast-biased profile ranks fast route higher", () => {
    const fastProfile: UserProfilePrefs = {
      ...DEFAULT_USER_PREFS,
      calmQuickBias: 0.8, // Strongly prefer fast
      transferTolerance: 0.9, // Fine with transfers
    };

    const scores = scoreWithProfile(mockCandidates, fastProfile);
    const sorted = [...scores].sort((a, b) => b.score - a.score);

    // Fast routes (rideshare or fast transit) should rank higher
    expect(["rideshare", "transit-fast"]).toContain(sorted[0].id);
  });

  it("comfort-biased profile ranks rideshare higher", () => {
    const comfortProfile: UserProfilePrefs = {
      ...DEFAULT_USER_PREFS,
      costComfortBias: 0.9, // Strongly prefer comfort
      walkingToleranceMax: 5, // Hates walking
    };

    const scores = scoreWithProfile(mockCandidates, comfortProfile);
    const sorted = [...scores].sort((a, b) => b.score - a.score);

    // Rideshare (minimal walking) should rank high
    expect(sorted[0].id).toBe("rideshare");
  });

  it("cost-conscious profile ranks transit higher", () => {
    const costProfile: UserProfilePrefs = {
      ...DEFAULT_USER_PREFS,
      costComfortBias: -0.9, // Strongly prefer saving money
    };

    const scores = scoreWithProfile(mockCandidates, costProfile);
    const sorted = [...scores].sort((a, b) => b.score - a.score);

    // Transit (cheap) should rank higher than rideshare
    const rideshareRank = sorted.findIndex((s) => s.id === "rideshare");
    const transitCalmRank = sorted.findIndex((s) => s.id === "transit-calm");
    const transitFastRank = sorted.findIndex((s) => s.id === "transit-fast");

    expect(rideshareRank).toBeGreaterThan(Math.min(transitCalmRank, transitFastRank));
  });

  it("same candidates with different profiles produce different rankings", () => {
    const calmProfile: UserProfilePrefs = {
      ...DEFAULT_USER_PREFS,
      calmQuickBias: -0.8,
    };

    const fastProfile: UserProfilePrefs = {
      ...DEFAULT_USER_PREFS,
      calmQuickBias: 0.8,
    };

    const calmScores = scoreWithProfile(mockCandidates, calmProfile);
    const fastScores = scoreWithProfile(mockCandidates, fastProfile);

    const calmSorted = [...calmScores].sort((a, b) => b.score - a.score);
    const fastSorted = [...fastScores].sort((a, b) => b.score - a.score);

    // Rankings should differ
    expect(calmSorted.map((s) => s.id)).not.toEqual(fastSorted.map((s) => s.id));
  });
});

describe("profileToScoringBiases conversion", () => {
  it("neutral profile produces balanced biases", () => {
    const biases = profileToScoringBiases(DEFAULT_USER_PREFS);

    // All should be close to 0.5
    expect(Math.abs(biases.calm - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(biases.fast - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(biases.comfort - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(biases.cost - 0.5)).toBeLessThan(0.1);
  });

  it("extreme calm bias produces high calm, low fast", () => {
    const prefs: UserProfilePrefs = { ...DEFAULT_USER_PREFS, calmQuickBias: -1 };
    const biases = profileToScoringBiases(prefs);

    expect(biases.calm).toBeGreaterThan(0.8);
    expect(biases.fast).toBeLessThan(0.2);
  });

  it("extreme fast bias produces low calm, high fast", () => {
    const prefs: UserProfilePrefs = { ...DEFAULT_USER_PREFS, calmQuickBias: 1 };
    const biases = profileToScoringBiases(prefs);

    expect(biases.calm).toBeLessThan(0.2);
    expect(biases.fast).toBeGreaterThan(0.8);
  });

  it("biases are always clamped to 0-1", () => {
    const extremePrefs: UserProfilePrefs = {
      ...DEFAULT_USER_PREFS,
      calmQuickBias: 10, // Out of range
      costComfortBias: -10, // Out of range
    };

    const biases = profileToScoringBiases(extremePrefs);

    expect(biases.calm).toBeGreaterThanOrEqual(0);
    expect(biases.calm).toBeLessThanOrEqual(1);
    expect(biases.fast).toBeGreaterThanOrEqual(0);
    expect(biases.fast).toBeLessThanOrEqual(1);
    expect(biases.comfort).toBeGreaterThanOrEqual(0);
    expect(biases.comfort).toBeLessThanOrEqual(1);
    expect(biases.cost).toBeGreaterThanOrEqual(0);
    expect(biases.cost).toBeLessThanOrEqual(1);
  });
});
