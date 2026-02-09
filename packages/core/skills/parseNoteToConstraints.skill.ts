/**
 * PARSE NOTE TO CONSTRAINTS SKILL
 *
 * Extracts hard constraints and soft biases from user notes.
 *
 * DETERMINISTIC: Keyword-based parsing with strict rules.
 * LLM: Optional for semantic parsing of complex notes (not core correctness).
 *
 * Keywords:
 * - "dog" / "dog walk" => preferOutdoors, avoidUnderground, minContinuousWalkMin: 15
 * - "date" => comfort + calm biases
 * - "tired" / "don't walk" => walking penalty, maxWalkMin
 * - "reservation" => arrival buffer tag
 * - "wheelchair" / "accessible" => requireAccessible
 */

import { z } from "zod";
import type { Skill, HardConstraints, SoftBiases } from "./types";
import { HardConstraintsSchema, SoftBiasesSchema, TripIntentSchema } from "./types";

// ============================================
// SCHEMAS
// ============================================

const ParseNoteInputSchema = z.object({
  noteText: z.string(),
  tripIntent: TripIntentSchema.optional(),
});

const ParseNoteOutputSchema = z.object({
  hardConstraints: HardConstraintsSchema,
  softBiases: SoftBiasesSchema,
  reasonTags: z.array(z.string()),
  arrivalBufferMinutes: z.number(),
  parsedKeywords: z.array(z.string()),
});

export type ParseNoteInput = z.infer<typeof ParseNoteInputSchema>;
export type ParseNoteOutput = z.infer<typeof ParseNoteOutputSchema>;

// ============================================
// KEYWORD RULES
// ============================================

interface KeywordRule {
  patterns: RegExp[];
  tag: string;
  apply: (constraints: HardConstraints, biases: SoftBiases, buffer: { value: number }) => void;
}

const KEYWORD_RULES: KeywordRule[] = [
  // Dog walking - needs outdoor route, avoid underground, continuous walk
  {
    patterns: [/\bdog\s*walk/i, /\bwalk(ing)?\s*(my|the|a)?\s*dog/i, /\bwith\s*(my|the|a)?\s*dog/i],
    tag: "dog_walk",
    apply: (constraints, biases) => {
      constraints.preferOutdoors = true;
      constraints.avoidUnderground = true;
      constraints.minContinuousWalkMin = 15;
      biases.calm += 0.2;
    },
  },

  // Just "dog" mentioned (less strict than dog walk)
  {
    patterns: [/\bdog\b/i, /\bpuppy\b/i, /\bpet\b/i],
    tag: "with_pet",
    apply: (constraints, biases) => {
      constraints.preferOutdoors = true;
      constraints.avoidUnderground = true;
      biases.calm += 0.1;
    },
  },

  // Date / romantic - prioritize comfort and calm
  {
    patterns: [/\bdate\b/i, /\bromantic/i, /\banniversary/i, /\bspecial\s*occasion/i],
    tag: "date",
    apply: (_, biases) => {
      biases.comfort += 0.3;
      biases.calm += 0.3;
      biases.fast -= 0.2;
    },
  },

  // Tired / exhausted - minimize walking
  {
    patterns: [/\btired\b/i, /\bexhausted/i, /\bfatigue/i, /\blong\s*day/i],
    tag: "tired",
    apply: (constraints, biases) => {
      constraints.maxWalkMin = 10;
      biases.comfort += 0.3;
      biases.fast += 0.1;
    },
  },

  // Don't want to walk
  {
    patterns: [/\bdon'?t\s*walk/i, /\bno\s*walk/i, /\bavoid\s*walk/i, /\bminimize\s*walk/i],
    tag: "no_walk",
    apply: (constraints, biases) => {
      constraints.maxWalkMin = 5;
      biases.comfort += 0.2;
    },
  },

  // Reservation / time constraint
  {
    patterns: [/\breservation/i, /\bbooking/i, /\bat\s+\d{1,2}(:\d{2})?/i, /\bby\s+\d{1,2}/i],
    tag: "reservation",
    apply: (_, __, buffer) => {
      buffer.value += 10;
    },
  },

  // Meeting / interview - reliability matters
  {
    patterns: [/\bmeeting\b/i, /\binterview\b/i, /\bimportant/i, /\bcan'?t\s*be\s*late/i],
    tag: "meeting",
    apply: (_, biases, buffer) => {
      biases.fast += 0.2;
      biases.calm += 0.1;
      buffer.value += 10;
    },
  },

  // Hurry / rush - speed priority
  {
    patterns: [/\bhurry/i, /\brush(ed|ing)?\b/i, /\burgent/i, /\b(running\s*)?late\b/i, /\bquick(ly)?\b/i],
    tag: "hurry",
    apply: (_, biases) => {
      biases.fast += 0.4;
      biases.calm -= 0.2;
      biases.comfort -= 0.1;
    },
  },

  // Luggage / bags - minimize walking and stairs
  {
    patterns: [/\bluggage/i, /\bsuitcase/i, /\bheavy\s*bags?/i, /\bcarrying/i],
    tag: "luggage",
    apply: (constraints, biases) => {
      constraints.maxWalkMin = 10;
      constraints.requireAccessible = true;
      biases.comfort += 0.3;
    },
  },

  // Family / kids - prefer comfort and simplicity
  {
    patterns: [/\bkid(s)?\b/i, /\bchild(ren)?\b/i, /\bfamily\b/i, /\bstroller/i, /\bbaby\b/i],
    tag: "family",
    apply: (constraints, biases) => {
      constraints.requireAccessible = true;
      biases.comfort += 0.3;
      biases.calm += 0.2;
    },
  },

  // Accessibility
  {
    patterns: [/\bwheelchair/i, /\baccessib/i, /\bmobility/i, /\belevator/i],
    tag: "accessible",
    apply: (constraints, biases) => {
      constraints.requireAccessible = true;
      biases.comfort += 0.2;
    },
  },

  // Scenic / exploring
  {
    patterns: [/\bscenic/i, /\bsightseeing/i, /\bexplor/i, /\btourist/i, /\bwander/i],
    tag: "exploring",
    apply: (constraints, biases) => {
      constraints.preferOutdoors = true;
      biases.calm += 0.3;
      biases.fast -= 0.2;
    },
  },

  // Budget conscious
  {
    patterns: [/\bbudget/i, /\bcheap/i, /\bsave\s*money/i, /\bafford/i],
    tag: "budget",
    apply: (_, biases) => {
      biases.cost += 0.4;
      biases.comfort -= 0.1;
    },
  },
];

// ============================================
// PARSING LOGIC
// ============================================

function parseNote(noteText: string, tripIntent?: string): ParseNoteOutput {
  const lower = noteText.toLowerCase();

  const hardConstraints: HardConstraints = {};
  const softBiases: SoftBiases = {
    calm: 0,
    fast: 0,
    comfort: 0,
    cost: 0,
  };
  const buffer = { value: 0 };
  const reasonTags: string[] = [];
  const parsedKeywords: string[] = [];

  // Apply keyword rules
  for (const rule of KEYWORD_RULES) {
    const matched = rule.patterns.some((pattern) => pattern.test(lower));
    if (matched) {
      rule.apply(hardConstraints, softBiases, buffer);
      reasonTags.push(rule.tag);
      parsedKeywords.push(rule.tag);
    }
  }

  // Apply intent baseline adjustments
  if (tripIntent) {
    switch (tripIntent) {
      case "work":
      case "appointment":
        softBiases.fast += 0.2;
        break;
      case "leisure":
      case "exploring":
        softBiases.calm += 0.2;
        break;
      case "time_sensitive":
        softBiases.fast += 0.3;
        buffer.value += 5;
        break;
    }
  }

  // Normalize biases to 0-1 range
  const maxBias = Math.max(
    Math.abs(softBiases.calm),
    Math.abs(softBiases.fast),
    Math.abs(softBiases.comfort),
    Math.abs(softBiases.cost),
    1
  );
  softBiases.calm = Math.max(0, Math.min(1, (softBiases.calm / maxBias + 1) / 2));
  softBiases.fast = Math.max(0, Math.min(1, (softBiases.fast / maxBias + 1) / 2));
  softBiases.comfort = Math.max(0, Math.min(1, (softBiases.comfort / maxBias + 1) / 2));
  softBiases.cost = Math.max(0, Math.min(1, (softBiases.cost / maxBias + 1) / 2));

  return {
    hardConstraints,
    softBiases,
    reasonTags,
    arrivalBufferMinutes: buffer.value,
    parsedKeywords,
  };
}

// ============================================
// SKILL DEFINITION
// ============================================

export const parseNoteToConstraintsSkill: Skill<ParseNoteInput, ParseNoteOutput> = {
  name: "parseNoteToConstraints",

  inputSchema: ParseNoteInputSchema,
  outputSchema: ParseNoteOutputSchema,

  async run(ctx, input) {
    const notes: string[] = [];

    // If note is empty, still apply intent adjustments
    if (!input.noteText.trim()) {
      notes.push("Empty note, applying intent defaults only");

      // Apply intent-only adjustments
      let arrivalBuffer = 0;
      const softBiases = { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 };

      if (input.tripIntent === "time_sensitive") {
        softBiases.fast += 0.15;
        arrivalBuffer = 5;
      } else if (input.tripIntent === "work" || input.tripIntent === "appointment") {
        softBiases.fast += 0.1;
      } else if (input.tripIntent === "leisure" || input.tripIntent === "exploring") {
        softBiases.calm += 0.1;
      }

      return {
        output: {
          hardConstraints: {},
          softBiases,
          reasonTags: [],
          arrivalBufferMinutes: arrivalBuffer,
          parsedKeywords: [],
        },
        meta: { ok: true, usedFallback: false, notes },
      };
    }

    // Parse the note
    const result = parseNote(input.noteText, input.tripIntent);

    notes.push(`Parsed ${result.parsedKeywords.length} keywords: ${result.parsedKeywords.join(", ")}`);

    if (Object.keys(result.hardConstraints).length > 0) {
      notes.push(`Hard constraints: ${JSON.stringify(result.hardConstraints)}`);
    }

    return {
      output: result,
      meta: {
        ok: true,
        usedFallback: false,
        notes,
      },
    };
  },

  fallback(input) {
    // Safe default: no constraints, balanced biases
    return {
      hardConstraints: {},
      softBiases: { calm: 0.5, fast: 0.5, comfort: 0.5, cost: 0.5 },
      reasonTags: [],
      arrivalBufferMinutes: 0,
      parsedKeywords: [],
    };
  },
};
