/**
 * DETECT CITY MISMATCH SKILL
 *
 * Detects when resolved places don't match the selected city.
 * Returns early with a suggestion to switch cities.
 *
 * DETERMINISTIC: Simple confidence threshold check.
 * LLM: Not used.
 */

import { z } from "zod";
import type { Skill } from "./types";

// ============================================
// SCHEMAS
// ============================================

const DetectCityMismatchInputSchema = z.object({
  selectedCityCode: z.string(),
  inferredCityCode: z.string(),
  confidence: z.number().min(0).max(1),
  // Optional: place names for better messaging
  originName: z.string().optional(),
  destinationName: z.string().optional(),
});

const DetectCityMismatchOutputSchema = z.object({
  mismatch: z.boolean(),
  suggestedCityCode: z.string().optional(),
  suggestedCityName: z.string().optional(),
  message: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export type DetectCityMismatchInput = z.infer<typeof DetectCityMismatchInputSchema>;
export type DetectCityMismatchOutput = z.infer<typeof DetectCityMismatchOutputSchema>;

// ============================================
// CITY NAME MAPPING
// ============================================

const CITY_NAMES: Record<string, string> = {
  nyc: "New York City",
  berlin: "Berlin",
  tokyo: "Tokyo",
  london: "London",
  paris: "Paris",
  sf: "San Francisco",
};

// ============================================
// SKILL DEFINITION
// ============================================

const MISMATCH_CONFIDENCE_THRESHOLD = 0.8;

export const detectCityMismatchSkill: Skill<
  DetectCityMismatchInput,
  DetectCityMismatchOutput
> = {
  name: "detectCityMismatch",

  inputSchema: DetectCityMismatchInputSchema,
  outputSchema: DetectCityMismatchOutputSchema,

  async run(ctx, input) {
    const {
      selectedCityCode,
      inferredCityCode,
      confidence,
      originName,
      destinationName,
    } = input;

    const notes: string[] = [];

    // Rule: if confidence >= threshold AND cities differ => mismatch
    const isMismatch =
      confidence >= MISMATCH_CONFIDENCE_THRESHOLD &&
      inferredCityCode !== selectedCityCode;

    if (isMismatch) {
      const suggestedCityName =
        CITY_NAMES[inferredCityCode] || inferredCityCode;
      const selectedCityName = CITY_NAMES[selectedCityCode] || selectedCityCode;

      // Build contextual message
      let message: string;
      if (destinationName && originName) {
        message = `"${originName}" and "${destinationName}" appear to be in ${suggestedCityName}, not ${selectedCityName}. Would you like to switch?`;
      } else if (destinationName) {
        message = `"${destinationName}" appears to be in ${suggestedCityName}, not ${selectedCityName}. Would you like to switch?`;
      } else {
        message = `These places appear to be in ${suggestedCityName}, not ${selectedCityName}. Would you like to switch?`;
      }

      notes.push(
        `Mismatch detected: selected=${selectedCityCode}, inferred=${inferredCityCode}, confidence=${confidence}`
      );

      return {
        output: {
          mismatch: true,
          suggestedCityCode: inferredCityCode,
          suggestedCityName,
          message,
          confidence,
        },
        meta: {
          ok: true,
          usedFallback: false,
          notes,
        },
      };
    }

    // No mismatch
    notes.push(
      `No mismatch: selected=${selectedCityCode}, inferred=${inferredCityCode}, confidence=${confidence}`
    );

    return {
      output: {
        mismatch: false,
        confidence,
      },
      meta: {
        ok: true,
        usedFallback: false,
        notes,
      },
    };
  },

  fallback(input) {
    // Default to no mismatch (safe fallback)
    return {
      mismatch: false,
      confidence: input.confidence,
    };
  },
};
