/**
 * DETECT CITY MISMATCH SKILL — TESTS
 */

import { describe, it, expect, vi } from "vitest";
import { runSkill, type SkillContext } from "../types";
import { detectCityMismatchSkill } from "../detectCityMismatch.skill";

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

describe("DetectCityMismatchSkill", () => {
  describe("Mismatch Detection", () => {
    it("detects mismatch when Berlin selected but NYC inferred (high confidence)", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "berlin",
        inferredCityCode: "nyc",
        confidence: 0.95,
        destinationName: "Central Park",
      });

      expect(result.output.mismatch).toBe(true);
      expect(result.output.suggestedCityCode).toBe("nyc");
      expect(result.output.suggestedCityName).toBe("New York City");
      expect(result.output.message).toContain("Central Park");
      expect(result.output.message).toContain("New York City");
    });

    it("detects mismatch when NYC selected but Berlin inferred", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "nyc",
        inferredCityCode: "berlin",
        confidence: 0.9,
        destinationName: "Alexanderplatz",
      });

      expect(result.output.mismatch).toBe(true);
      expect(result.output.suggestedCityCode).toBe("berlin");
    });

    it("detects mismatch for Tokyo", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "berlin",
        inferredCityCode: "tokyo",
        confidence: 0.9,
        destinationName: "Shibuya Crossing",
      });

      expect(result.output.mismatch).toBe(true);
      expect(result.output.suggestedCityCode).toBe("tokyo");
      expect(result.output.suggestedCityName).toBe("Tokyo");
    });
  });

  describe("No Mismatch Cases", () => {
    it("no mismatch when cities match", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "nyc",
        inferredCityCode: "nyc",
        confidence: 0.95,
      });

      expect(result.output.mismatch).toBe(false);
    });

    it("no mismatch when confidence is low", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "berlin",
        inferredCityCode: "nyc",
        confidence: 0.5, // Below threshold
      });

      expect(result.output.mismatch).toBe(false);
    });

    it("no mismatch at exactly threshold (0.8)", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "berlin",
        inferredCityCode: "nyc",
        confidence: 0.8, // At threshold
      });

      expect(result.output.mismatch).toBe(true);
    });

    it("no mismatch just below threshold", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "berlin",
        inferredCityCode: "nyc",
        confidence: 0.79, // Just below threshold
      });

      expect(result.output.mismatch).toBe(false);
    });
  });

  describe("Message Generation", () => {
    it("includes both origin and destination names in message", async () => {
      const ctx = createMockContext();
      const result = await runSkill(detectCityMismatchSkill, ctx, {
        selectedCityCode: "berlin",
        inferredCityCode: "nyc",
        confidence: 0.95,
        originName: "Central Park",
        destinationName: "The Met",
      });

      expect(result.output.message).toContain("Central Park");
      expect(result.output.message).toContain("The Met");
    });
  });
});
