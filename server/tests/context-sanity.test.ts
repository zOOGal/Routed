/**
 * CONTEXT SANITY LAYER TESTS
 *
 * Verifies that the context sanity layer correctly:
 * 1. Resolves places with city inference
 * 2. Detects city mismatches
 * 3. Validates transit naming per city
 */

import { describe, it, expect } from "vitest";
import {
  resolvePlace,
  detectCityMismatch,
  validateTransitNaming,
  sanitizeTransitName,
  runSanityGate,
  validateFinalOutput,
} from "../context-sanity";

describe("Place Resolution", () => {
  describe("Known places lookup", () => {
    it("resolves Central Park as NYC with high confidence", () => {
      const result = resolvePlace("Central Park", "berlin");

      expect(result.inferredCityCode).toBe("nyc");
      expect(result.inferredCityName).toBe("New York City");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.source).toBe("lookup");
    });

    it("resolves Alexanderplatz as Berlin with high confidence", () => {
      const result = resolvePlace("Alexanderplatz", "nyc");

      expect(result.inferredCityCode).toBe("berlin");
      expect(result.inferredCityName).toBe("Berlin");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("resolves Shibuya as Tokyo with high confidence", () => {
      const result = resolvePlace("Shibuya Crossing", "berlin");

      expect(result.inferredCityCode).toBe("tokyo");
      expect(result.inferredCityName).toBe("Tokyo");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("resolves The Met as NYC", () => {
      const result = resolvePlace("the met", "berlin");

      expect(result.inferredCityCode).toBe("nyc");
      expect(result.inferredCityName).toBe("New York City");
    });

    it("resolves Brandenburg Gate as Berlin", () => {
      const result = resolvePlace("Brandenburg Gate", "nyc");

      expect(result.inferredCityCode).toBe("berlin");
      expect(result.inferredCityName).toBe("Berlin");
    });
  });

  describe("Heuristic keyword detection", () => {
    it("detects NYC from Manhattan keyword", () => {
      const result = resolvePlace("123 Manhattan Ave", "berlin");

      expect(result.inferredCityCode).toBe("nyc");
      expect(result.source).toBe("heuristic");
    });

    it("detects Berlin from Kreuzberg keyword", () => {
      const result = resolvePlace("Cafe in Kreuzberg", "nyc");

      expect(result.inferredCityCode).toBe("berlin");
    });

    it("detects Tokyo from Shinjuku keyword", () => {
      const result = resolvePlace("Restaurant near Shinjuku", "berlin");

      expect(result.inferredCityCode).toBe("tokyo");
    });
  });

  describe("Ambiguous places", () => {
    it("returns low confidence for unknown places", () => {
      const result = resolvePlace("Some Random Place", "berlin");

      expect(result.confidence).toBeLessThan(0.5);
      expect(result.inferredCityCode).toBe("berlin"); // Falls back to selected
    });
  });
});

describe("City Mismatch Detection", () => {
  describe("Clear mismatches", () => {
    it("detects mismatch: Central Park + Met in Berlin", () => {
      const result = detectCityMismatch("berlin", "Central Park", "The Met");

      expect(result.mismatch).toBe(true);
      expect(result.suggestedCityCode).toBe("nyc");
      expect(result.suggestedCityName).toBe("New York City");
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("detects mismatch: Alexanderplatz in NYC", () => {
      const result = detectCityMismatch("nyc", "Times Square", "Alexanderplatz");

      expect(result.mismatch).toBe(true);
      expect(result.suggestedCityCode).toBe("berlin");
    });

    it("detects mismatch: Shibuya in Berlin", () => {
      const result = detectCityMismatch("berlin", "Alexanderplatz", "Shibuya Crossing");

      expect(result.mismatch).toBe(true);
      expect(result.suggestedCityCode).toBe("tokyo");
    });
  });

  describe("No mismatch", () => {
    it("no mismatch: Central Park to Met in NYC", () => {
      const result = detectCityMismatch("nyc", "Central Park", "The Met");

      expect(result.mismatch).toBe(false);
    });

    it("no mismatch: Alexanderplatz to Brandenburger Tor in Berlin", () => {
      const result = detectCityMismatch("berlin", "Alexanderplatz", "Brandenburger Tor");

      expect(result.mismatch).toBe(false);
    });

    it("no mismatch: Shibuya to Tokyo Station in Tokyo", () => {
      const result = detectCityMismatch("tokyo", "Shibuya Crossing", "Tokyo Station");

      expect(result.mismatch).toBe(false);
    });
  });

  describe("Ambiguous cases", () => {
    it("no mismatch for unknown places (low confidence)", () => {
      const result = detectCityMismatch("berlin", "Some Place", "Another Place");

      expect(result.mismatch).toBe(false);
      expect(result.confidence).toBeLessThan(0.8);
    });
  });
});

describe("Transit Naming Validation", () => {
  describe("NYC transit naming", () => {
    it("NYC plan must not contain U-Bahn", () => {
      const result = validateTransitNaming("nyc", "Take the U-Bahn to Central Park");

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain("U-Bahn");
    });

    it("NYC plan must not contain S-Bahn", () => {
      const result = validateTransitNaming("nyc", "Transfer to S-Bahn");

      expect(result.valid).toBe(false);
      expect(result.violations[0]).toContain("S-Bahn");
    });

    it("NYC plan can contain Subway and MTA", () => {
      const result = validateTransitNaming("nyc", "Take the Subway (MTA) to 42nd Street");

      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  describe("Berlin transit naming", () => {
    it("Berlin plan must not contain MTA", () => {
      const result = validateTransitNaming("berlin", "Take the MTA to Alexanderplatz");

      expect(result.valid).toBe(false);
      expect(result.violations[0]).toContain("MTA");
    });

    it("Berlin plan can contain U-Bahn and S-Bahn", () => {
      const result = validateTransitNaming("berlin", "Take U-Bahn U2, transfer to S-Bahn S5");

      expect(result.valid).toBe(true);
    });
  });

  describe("Tokyo transit naming", () => {
    it("Tokyo plan must not contain U-Bahn", () => {
      const result = validateTransitNaming("tokyo", "Take U-Bahn to Shibuya");

      expect(result.valid).toBe(false);
    });

    it("Tokyo plan can contain JR and Metro", () => {
      const result = validateTransitNaming("tokyo", "Take JR Yamanote Line, transfer to Metro");

      expect(result.valid).toBe(true);
    });
  });
});

describe("Transit Name Sanitization", () => {
  it("sanitizes U-Bahn to Transit in NYC context", () => {
    const result = sanitizeTransitName("U-Bahn U2", "nyc");

    expect(result).toBe("Transit");
  });

  it("keeps U-Bahn in Berlin context", () => {
    const result = sanitizeTransitName("U-Bahn U2", "berlin");

    expect(result).toBe("U-Bahn U2");
  });

  it("sanitizes MTA to Transit in Berlin context", () => {
    const result = sanitizeTransitName("MTA Subway", "berlin");

    expect(result).toBe("Transit");
  });
});

describe("Sanity Gate", () => {
  it("blocks request when city mismatch detected", () => {
    const result = runSanityGate("berlin", "Central Park", "The Met");

    expect(result.passed).toBe(false);
    expect(result.blockReason).toBeDefined();
    expect(result.mismatch?.mismatch).toBe(true);
    expect(result.mismatch?.suggestedCityCode).toBe("nyc");
  });

  it("passes request when no mismatch", () => {
    const result = runSanityGate("nyc", "Central Park", "The Met");

    expect(result.passed).toBe(true);
    expect(result.mismatch?.mismatch).toBe(false);
  });

  it("passes request for same-city places in Berlin", () => {
    const result = runSanityGate("berlin", "Alexanderplatz", "Potsdamer Platz");

    expect(result.passed).toBe(true);
  });
});

describe("Final Output Validation", () => {
  it("validates NYC output has no Berlin transit names", () => {
    const recommendation = {
      summary: "Take Subway to destination",
      steps: [
        { instruction: "Walk to 42nd Street Station", line: "A" },
        { instruction: "Take A train to Penn Station" },
      ],
    };

    const result = validateFinalOutput("nyc", recommendation);
    expect(result.valid).toBe(true);
  });

  it("catches U-Bahn in NYC output", () => {
    const recommendation = {
      summary: "Take U-Bahn to destination",
      steps: [
        { instruction: "Walk to station" },
        { instruction: "Take U-Bahn U2 to destination", line: "U2" },
      ],
    };

    const result = validateFinalOutput("nyc", recommendation);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
