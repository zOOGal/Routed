/**
 * ORCHESTRATOR SCHEMAS
 *
 * Input/output types for the skill orchestration pipeline.
 */

import { z } from "zod";
import { TripIntentSchema, SkillResultMeta } from "../skills/types";
import { UserProfilePrefsSchema, CityFamiliaritySchema } from "../memory/types";

// ============================================
// ORCHESTRATOR INPUT
// ============================================

export const OrchestratorInputSchema = z.object({
  selectedCityCode: z.string(),
  originText: z.string().optional(),
  destinationText: z.string(),
  tripIntent: TripIntentSchema.optional(),
  userNote: z.string().optional(),
  userPrefs: z
    .object({
      calmVsFast: z.number().min(0).max(100).optional(),
      economyVsComfort: z.number().min(0).max(100).optional(),
    })
    .optional(),
  activePass: z
    .object({
      type: z.string(),
      validUntil: z.string().optional(),
    })
    .optional(),
  // User memory profile (learned preferences)
  userProfile: z
    .object({
      prefs: UserProfilePrefsSchema,
      cityFamiliarity: CityFamiliaritySchema,
      totalTrips: z.number().int().nonnegative(),
    })
    .optional(),
});

export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;

// ============================================
// DEPTH LAYER OUTPUT
// ============================================

export const DepthLayerOutputSchema = z.object({
  agentPresenceLine: z.string(),
  tripFramingLine: z.string(),
  contextualInsights: z.array(z.string()),
  responsibilityLine: z.string(),
  memoryCallbackLine: z.string().optional(),
});

export type DepthLayerOutput = z.infer<typeof DepthLayerOutputSchema>;

// ============================================
// STEP OUTPUT
// ============================================

export const RouteStepSchema = z.object({
  type: z.enum(["walk", "transit", "rideshare", "bike"]),
  instruction: z.string(),
  duration: z.number(),
  distance: z.number().optional(),
  line: z.string().optional(),
  transitDetails: z
    .object({
      departureStop: z.string(),
      arrivalStop: z.string(),
      numStops: z.number().optional(),
      headsign: z.string().optional(),
    })
    .optional(),
});

export type RouteStep = z.infer<typeof RouteStepSchema>;

// ============================================
// CHOSEN PLAN
// ============================================

export const ChosenPlanSchema = z.object({
  mode: z.enum(["transit", "walking", "driving", "bicycling", "mixed"]),
  summary: z.string(),
  estimatedDuration: z.number(),
  estimatedCost: z.number().optional(),
  costDisplay: z.string().optional(),
  confidence: z.number().min(0).max(1),
  archetype: z.enum(["calm", "fast", "comfort"]).optional(),
});

export type ChosenPlan = z.infer<typeof ChosenPlanSchema>;

// ============================================
// LLM DEBUG INFO
// ============================================

export const LLMDebugInfoSchema = z.object({
  called: z.boolean(),
  provider: z.enum(["gemini", "none"]),
  model: z.string().optional(),
  latencyMs: z.number().optional(),
  validated: z.boolean(),
  fallbackReason: z.string().optional(),
  rawPreview: z.string().optional(),
  inputTokensEstimate: z.number().optional(),
});

export type LLMDebugInfo = z.infer<typeof LLMDebugInfoSchema>;

// ============================================
// DEBUG OUTPUT
// ============================================

export const DebugOutputSchema = z.object({
  skillsRun: z.array(
    z.object({
      skillName: z.string(),
      startedAt: z.string(),
      endedAt: z.string(),
      durationMs: z.number(),
      ok: z.boolean(),
      usedFallback: z.boolean(),
      error: z.string().optional(),
      notes: z.array(z.string()).optional(),
    })
  ),
  candidateScores: z
    .array(
      z.object({
        id: z.string(),
        score: z.number(),
        breakdown: z.object({
          calm: z.number(),
          fast: z.number(),
          comfort: z.number(),
          cost: z.number(),
        }),
        violatesConstraints: z.boolean(),
      })
    )
    .optional(),
  constraintsApplied: z.record(z.any()).optional(),
  mismatchDetected: z.boolean().optional(),
  llm: LLMDebugInfoSchema.optional(),
  trace: z.string().optional(), // Single-line orchestrator trace
  // User profile debug info
  profileUsed: z.boolean().optional(),
  profileBiases: z
    .object({
      calm: z.number(),
      fast: z.number(),
      comfort: z.number(),
      cost: z.number(),
    })
    .optional(),
});

export type DebugOutput = z.infer<typeof DebugOutputSchema>;

// ============================================
// ORCHESTRATOR OUTPUT
// ============================================

export const OrchestratorOutputSchema = z.discriminatedUnion("type", [
  // Success case
  z.object({
    type: z.literal("plan"),
    resolvedContext: z.object({
      cityCode: z.string(),
      origin: z.string().nullable(),
      destination: z.string(),
    }),
    chosenPlan: ChosenPlanSchema,
    steps: z.array(RouteStepSchema),
    depthLayer: DepthLayerOutputSchema,
    debug: DebugOutputSchema.optional(),
  }),

  // City mismatch case
  z.object({
    type: z.literal("city_mismatch"),
    suggestedCityCode: z.string(),
    suggestedCityName: z.string(),
    message: z.string(),
    confidence: z.number(),
    debug: DebugOutputSchema.optional(),
  }),

  // Error case
  z.object({
    type: z.literal("error"),
    error: z.string(),
    debug: DebugOutputSchema.optional(),
  }),

  // No routes case
  z.object({
    type: z.literal("no_routes"),
    message: z.string(),
    debug: DebugOutputSchema.optional(),
  }),
]);

export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;
