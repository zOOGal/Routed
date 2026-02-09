/**
 * SCORE CANDIDATES SKILL — TESTS
 */

import { describe, it, expect, vi } from "vitest";
import { runSkill, type SkillContext } from "../types";
import { scoreCandidatesSkill, type RouteCandidate } from "../scoreCandidates.skill";

// Mock context
const createMockContext = (): SkillContext => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  now: new Date(),
  timezone: "America/New_York",
  getCityProfile: vi.fn(),
  getWeather: vi.fn(),
  getVenueInfo: vi.fn(),
  llm: {
    generate: vi.fn(),
    isAvailable: () => true,
  },
  flags: {
    debugMode: false,
    useLLM: false,
    mockExternalCalls: true,
  },
});

// Test candidates
const createTestCandidates = (): RouteCandidate[] => [
  {
    id: "transit-direct",
    mode: "transit",
    durationMinutes: 25,
    walkingMinutes: 8,
    transferCount: 0,
    hasUnderground: true,
    isOutdoorRoute: false,
    estimatedCost: 2.9,
    steps: [
      { type: "walk", duration: 4, distance: 300 },
      { type: "transit", duration: 17, line: "A" },
      { type: "walk", duration: 4, distance: 350 },
    ],
  },
  {
    id: "transit-fast",
    mode: "transit",
    durationMinutes: 18,
    walkingMinutes: 6,
    transferCount: 2,
    hasUnderground: true,
    isOutdoorRoute: false,
    estimatedCost: 2.9,
    steps: [
      { type: "walk", duration: 3, distance: 200 },
      { type: "transit", duration: 5, line: "B" },
      { type: "transit", duration: 4, line: "C" },
      { type: "transit", duration: 3, line: "D" },
      { type: "walk", duration: 3, distance: 250 },
    ],
  },
  {
    id: "walking",
    mode: "walking",
    durationMinutes: 35,
    walkingMinutes: 35,
    transferCount: 0,
    hasUnderground: false,
    isOutdoorRoute: true,
    estimatedCost: 0,
    steps: [{ type: "walk", duration: 35, distance: 2800 }],
  },
  {
    id: "rideshare",
    mode: "driving",
    durationMinutes: 15,
    walkingMinutes: 2,
    transferCount: 0,
    hasUnderground: false,
    isOutdoorRoute: false,
    estimatedCost: 18,
    steps: [
      { type: "walk", duration: 1, distance: 50 },
      { type: "rideshare", duration: 13 },
      { type: "walk", duration: 1, distance: 50 },
    ],
  },
];

describe("ScoreCandidatesSkill", () => {
  describe("Constraint Vetoing", () => {
    it("vetoes underground-heavy route when avoidUnderground is true", async () => {
      const ctx = createMockContext();
      const candidates = createTestCandidates();

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        constraints: { avoidUnderground: true },
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      // Underground routes should be marked as violating constraints
      const transitDirect = result.output.scoredCandidates.find(
        (c) => c.id === "transit-direct"
      );
      const transitFast = result.output.scoredCandidates.find(
        (c) => c.id === "transit-fast"
      );
      const walking = result.output.scoredCandidates.find((c) => c.id === "walking");

      expect(transitDirect?.violatesConstraints).toBe(true);
      expect(transitFast?.violatesConstraints).toBe(true);
      expect(walking?.violatesConstraints).toBe(false);
    });

    it("vetoes walking route when minContinuousWalkMin is not met", async () => {
      const ctx = createMockContext();
      // Create a candidate with short walking segments
      const candidates: RouteCandidate[] = [
        {
          id: "short-walks",
          mode: "transit",
          durationMinutes: 20,
          walkingMinutes: 10,
          transferCount: 0,
          hasUnderground: false,
          isOutdoorRoute: false,
          estimatedCost: 3,
          steps: [
            { type: "walk", duration: 5, distance: 400 },
            { type: "transit", duration: 10, line: "A" },
            { type: "walk", duration: 5, distance: 400 },
          ],
        },
        {
          id: "long-walk",
          mode: "walking",
          durationMinutes: 30,
          walkingMinutes: 30,
          transferCount: 0,
          hasUnderground: false,
          isOutdoorRoute: true,
          estimatedCost: 0,
          steps: [{ type: "walk", duration: 30, distance: 2400 }],
        },
      ];

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        constraints: { minContinuousWalkMin: 15 },
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      const shortWalks = result.output.scoredCandidates.find(
        (c) => c.id === "short-walks"
      );
      const longWalk = result.output.scoredCandidates.find((c) => c.id === "long-walk");

      expect(shortWalks?.violatesConstraints).toBe(true);
      expect(longWalk?.violatesConstraints).toBe(false);
    });

    it("vetoes routes exceeding maxWalkMin", async () => {
      const ctx = createMockContext();
      const candidates = createTestCandidates();

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        constraints: { maxWalkMin: 10 },
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      const walking = result.output.scoredCandidates.find((c) => c.id === "walking");
      const transitDirect = result.output.scoredCandidates.find(
        (c) => c.id === "transit-direct"
      );

      expect(walking?.violatesConstraints).toBe(true); // 35 min walking
      expect(transitDirect?.violatesConstraints).toBe(false); // 8 min walking
    });
  });

  describe("Intent-Based Scoring", () => {
    it("time_sensitive intent prefers fastest route", async () => {
      const ctx = createMockContext();
      const candidates = createTestCandidates();

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        tripIntent: "time_sensitive",
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      // Rideshare (15 min) or transit-fast (18 min) should win over transit-direct (25 min)
      const bestId = result.output.bestCandidateId;
      expect(["rideshare", "transit-fast"]).toContain(bestId);
    });

    it("leisure intent prefers calmer route", async () => {
      const ctx = createMockContext();
      const candidates = createTestCandidates();

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        tripIntent: "leisure",
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      // transit-direct (0 transfers) should score higher on calm than transit-fast (2 transfers)
      const transitDirect = result.output.scoredCandidates.find(
        (c) => c.id === "transit-direct"
      );
      const transitFast = result.output.scoredCandidates.find(
        (c) => c.id === "transit-fast"
      );

      expect(transitDirect?.breakdown.calm).toBeGreaterThan(
        transitFast?.breakdown.calm || 0
      );
    });

    it("different intents produce different winners", async () => {
      const ctx = createMockContext();
      const candidates = createTestCandidates();

      // Time sensitive
      const urgentResult = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        tripIntent: "time_sensitive",
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      // Exploring (calm)
      const exploringResult = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        tripIntent: "exploring",
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      // The order of candidates should differ
      const urgentOrder = urgentResult.output.scoredCandidates.map((c) => c.id);
      const exploringOrder = exploringResult.output.scoredCandidates.map((c) => c.id);

      // At minimum, the ranking should be different
      expect(urgentOrder).not.toEqual(exploringOrder);
    });
  });

  describe("Soft Biases", () => {
    it("high cost bias prefers cheaper options", async () => {
      const ctx = createMockContext();
      const candidates = createTestCandidates();

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.9 }, // High cost sensitivity
        cityCode: "nyc",
      });

      const walking = result.output.scoredCandidates.find((c) => c.id === "walking");
      const rideshare = result.output.scoredCandidates.find((c) => c.id === "rideshare");

      // Walking ($0) should have higher cost score than rideshare ($18)
      expect(walking?.breakdown.cost).toBeGreaterThan(rideshare?.breakdown.cost || 0);
    });
  });

  describe("Weather Impact", () => {
    it("bad weather penalizes walking routes", async () => {
      const ctx = createMockContext();
      const candidates = createTestCandidates();

      const goodWeatherResult = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        weather: { isOutdoorFriendly: true, temperature: 20 },
        cityCode: "nyc",
      });

      const badWeatherResult = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        weather: { isOutdoorFriendly: false, temperature: 5 },
        cityCode: "nyc",
      });

      const walkingGoodWeather = goodWeatherResult.output.scoredCandidates.find(
        (c) => c.id === "walking"
      );
      const walkingBadWeather = badWeatherResult.output.scoredCandidates.find(
        (c) => c.id === "walking"
      );

      // Walking comfort score should be lower in bad weather
      expect(walkingGoodWeather?.breakdown.comfort).toBeGreaterThan(
        walkingBadWeather?.breakdown.comfort || 0
      );
    });
  });

  describe("Edge Cases", () => {
    it("returns empty result for no candidates", async () => {
      const ctx = createMockContext();

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates: [],
        constraints: {},
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      expect(result.output.scoredCandidates).toEqual([]);
      expect(result.output.bestCandidateId).toBeNull();
      expect(result.output.totalCandidates).toBe(0);
    });

    it("selects highest scoring even if all violate constraints", async () => {
      const ctx = createMockContext();
      // All candidates use underground
      const candidates: RouteCandidate[] = [
        {
          id: "transit-1",
          mode: "transit",
          durationMinutes: 20,
          walkingMinutes: 5,
          transferCount: 0,
          hasUnderground: true,
          isOutdoorRoute: false,
          estimatedCost: 3,
          steps: [{ type: "transit", duration: 20, line: "A" }],
        },
        {
          id: "transit-2",
          mode: "transit",
          durationMinutes: 30,
          walkingMinutes: 10,
          transferCount: 1,
          hasUnderground: true,
          isOutdoorRoute: false,
          estimatedCost: 3,
          steps: [{ type: "transit", duration: 30, line: "B" }],
        },
      ];

      const result = await runSkill(scoreCandidatesSkill, ctx, {
        candidates,
        constraints: { avoidUnderground: true },
        biases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
        cityCode: "nyc",
      });

      // Should still return a best candidate, even though all violate
      expect(result.output.bestCandidateId).toBeDefined();
      expect(result.output.viableCandidates).toBe(0);
    });
  });
});
