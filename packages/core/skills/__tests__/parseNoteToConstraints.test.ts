/**
 * PARSE NOTE TO CONSTRAINTS SKILL — TESTS
 */

import { describe, it, expect, vi } from "vitest";
import { runSkill, type SkillContext } from "../types";
import { parseNoteToConstraintsSkill } from "../parseNoteToConstraints.skill";

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

describe("ParseNoteToConstraintsSkill", () => {
  describe("Dog Walking", () => {
    it("dog walk => preferOutdoors and avoidUnderground and minContinuousWalkMin", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "going for a dog walk",
      });

      expect(result.output.hardConstraints.preferOutdoors).toBe(true);
      expect(result.output.hardConstraints.avoidUnderground).toBe(true);
      expect(result.output.hardConstraints.minContinuousWalkMin).toBe(15);
      expect(result.output.reasonTags).toContain("dog_walk");
    });

    it("walking the dog => same constraints", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "walking my dog to the park",
      });

      expect(result.output.hardConstraints.preferOutdoors).toBe(true);
      expect(result.output.hardConstraints.avoidUnderground).toBe(true);
    });

    it("with my dog => preferOutdoors (less strict)", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "traveling with my dog",
      });

      expect(result.output.hardConstraints.preferOutdoors).toBe(true);
      expect(result.output.hardConstraints.avoidUnderground).toBe(true);
    });
  });

  describe("Date / Romantic Context", () => {
    it("date => comfort and calm biases", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "going on a date",
      });

      expect(result.output.reasonTags).toContain("date");
      // Comfort and calm should be higher than default (0.5)
      expect(result.output.softBiases.comfort).toBeGreaterThan(0.5);
      expect(result.output.softBiases.calm).toBeGreaterThan(0.5);
    });

    it("romantic evening => same as date", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "romantic evening planned",
      });

      expect(result.output.reasonTags).toContain("date");
    });
  });

  describe("Tired / Exhausted", () => {
    it("tired => maxWalkMin constraint", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "I'm really tired today",
      });

      expect(result.output.hardConstraints.maxWalkMin).toBeDefined();
      expect(result.output.hardConstraints.maxWalkMin).toBeLessThanOrEqual(10);
      expect(result.output.reasonTags).toContain("tired");
    });

    it("don't want to walk => maxWalkMin constraint", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "don't walk too much please",
      });

      expect(result.output.hardConstraints.maxWalkMin).toBeDefined();
      expect(result.output.reasonTags).toContain("no_walk");
    });
  });

  describe("Reservation / Time Constraint", () => {
    it("reservation => arrival buffer", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "have a reservation at 7pm",
      });

      expect(result.output.arrivalBufferMinutes).toBeGreaterThan(0);
      expect(result.output.reasonTags).toContain("reservation");
    });

    it("meeting at specific time => buffer", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "important meeting at 3",
      });

      expect(result.output.arrivalBufferMinutes).toBeGreaterThan(0);
    });
  });

  describe("Combined Keywords", () => {
    it("dog walk date => preferOutdoors AND avoidUnderground AND comfort bias", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "dog walk date in the park",
      });

      expect(result.output.hardConstraints.preferOutdoors).toBe(true);
      expect(result.output.hardConstraints.avoidUnderground).toBe(true);
      expect(result.output.reasonTags).toContain("dog_walk");
      expect(result.output.reasonTags).toContain("date");
    });

    it("tired with luggage => maxWalkMin and requireAccessible", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "I'm tired and have heavy luggage",
      });

      expect(result.output.hardConstraints.maxWalkMin).toBeDefined();
      expect(result.output.hardConstraints.requireAccessible).toBe(true);
      expect(result.output.reasonTags).toContain("tired");
      expect(result.output.reasonTags).toContain("luggage");
    });
  });

  describe("Hurry / Rush", () => {
    it("in a hurry => fast bias", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "I'm in a hurry",
      });

      expect(result.output.reasonTags).toContain("hurry");
      expect(result.output.softBiases.fast).toBeGreaterThan(0.5);
    });

    it("running late => fast bias", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "running late to my appointment",
      });

      expect(result.output.reasonTags).toContain("hurry");
    });
  });

  describe("Intent Adjustments", () => {
    it("time_sensitive intent adds buffer", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "",
        tripIntent: "time_sensitive",
      });

      expect(result.output.arrivalBufferMinutes).toBeGreaterThan(0);
    });
  });

  describe("Empty Note", () => {
    it("empty note returns defaults", async () => {
      const ctx = createMockContext();
      const result = await runSkill(parseNoteToConstraintsSkill, ctx, {
        noteText: "",
      });

      expect(result.output.hardConstraints).toEqual({});
      expect(result.output.reasonTags).toEqual([]);
      expect(result.output.arrivalBufferMinutes).toBe(0);
    });
  });
});
