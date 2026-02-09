/**
 * RESOLVE PLACES SKILL — TESTS
 */

import { describe, it, expect, vi } from "vitest";
import { runSkill, type SkillContext } from "../types";
import { resolvePlacesSkill } from "../resolvePlaces.skill";

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
  getCityProfile: (cityCode) => {
    const profiles: Record<string, { name: string; id: string }> = {
      nyc: { name: "New York City", id: "nyc" },
      berlin: { name: "Berlin", id: "berlin" },
      tokyo: { name: "Tokyo", id: "tokyo" },
    };
    return profiles[cityCode] as any;
  },
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

describe("ResolvePlacesSkill", () => {
  describe("Known Places Lookup", () => {
    it("resolves Central Park as NYC with high confidence", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "berlin",
        destinationText: "Central Park",
      });

      expect(result.output.destination.inferredCityCode).toBe("nyc");
      expect(result.output.destination.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.output.inferredCityCode).toBe("nyc");
    });

    it("resolves Alexanderplatz as Berlin", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "nyc",
        destinationText: "Alexanderplatz",
      });

      expect(result.output.destination.inferredCityCode).toBe("berlin");
      expect(result.output.destination.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("resolves Shibuya as Tokyo", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "berlin",
        destinationText: "Shibuya Crossing",
      });

      expect(result.output.destination.inferredCityCode).toBe("tokyo");
    });

    it("resolves The Met as NYC", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "berlin",
        destinationText: "the met",
      });

      expect(result.output.destination.inferredCityCode).toBe("nyc");
    });
  });

  describe("Keyword Heuristics", () => {
    it("detects NYC from Manhattan keyword", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "berlin",
        destinationText: "123 Manhattan Ave",
      });

      expect(result.output.destination.inferredCityCode).toBe("nyc");
      expect(result.output.destination.source).toBe("heuristic");
    });

    it("detects Berlin from Kreuzberg keyword", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "nyc",
        destinationText: "Cafe in Kreuzberg",
      });

      expect(result.output.destination.inferredCityCode).toBe("berlin");
    });
  });

  describe("Ambiguous Places", () => {
    it("returns low confidence for unknown places", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "berlin",
        destinationText: "Some Random Place",
      });

      expect(result.output.destination.confidence).toBeLessThan(0.5);
      expect(result.output.destination.inferredCityCode).toBe("berlin");
    });
  });

  describe("Origin and Destination", () => {
    it("resolves both origin and destination", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "nyc",
        originText: "Central Park",
        destinationText: "The Met",
      });

      expect(result.output.origin).not.toBeNull();
      expect(result.output.origin?.inferredCityCode).toBe("nyc");
      expect(result.output.destination.inferredCityCode).toBe("nyc");
    });

    it("infers city from highest confidence place", async () => {
      const ctx = createMockContext();
      const result = await runSkill(resolvePlacesSkill, ctx, {
        selectedCityCode: "berlin",
        originText: "Some Random Place",
        destinationText: "Central Park",
      });

      // Central Park has higher confidence, so inferredCityCode should be NYC
      expect(result.output.inferredCityCode).toBe("nyc");
    });
  });
});
