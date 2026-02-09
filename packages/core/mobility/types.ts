/**
 * MOBILITY ABSTRACTION LAYER — Types
 *
 * Provider-agnostic mobility types that the UI consumes.
 * The UI should ONLY use MobilityPlan, never raw provider objects.
 *
 * CRITICAL RULES:
 * - Provider names must come from the provider catalog, never hardcoded
 * - Coverage must reflect actual entitlement status
 * - Execution types provide actionable deep links
 */

import { z } from "zod";

// ============================================
// CITY CODES
// ============================================

export const CityCodeSchema = z.enum(["nyc", "berlin", "tokyo"]);
export type CityCode = z.infer<typeof CityCodeSchema>;

export const CITY_NAMES: Record<CityCode, string> = {
  nyc: "New York City",
  berlin: "Berlin",
  tokyo: "Tokyo",
};

// ============================================
// TRANSPORT MODES
// ============================================

export const ModeSchema = z.enum(["walk", "transit", "ridehail", "bike"]);
export type Mode = z.infer<typeof ModeSchema>;

// ============================================
// COVERAGE STATUS
// ============================================

/**
 * Coverage indicates whether a step is covered by the user's entitlements
 *
 * - "included": Fully covered by active pass (verified)
 * - "discounted": Partially covered (e.g., 20% off ridehail)
 * - "pay": User must pay standard fare
 * - "unknown": Entitlement status could not be determined
 */
export const CoverageSchema = z.enum(["included", "discounted", "pay", "unknown"]);
export type Coverage = z.infer<typeof CoverageSchema>;

// ============================================
// EXECUTION TYPES
// ============================================

/**
 * Execution defines how the user acts on a step
 */
export const ExecutionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("walk"),
  }),
  z.object({
    type: z.literal("deeplink"),
    url: z.string().url(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("ticket"),
    url: z.string().url().optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("system_map"),
    url: z.string().url(),
    label: z.string().optional(),
  }),
]);

export type Execution = z.infer<typeof ExecutionSchema>;

// ============================================
// MOBILITY STEP
// ============================================

export const MobilityStepSchema = z.object({
  mode: ModeSchema,
  providerId: z.string().optional(),
  providerName: z.string().optional(),
  instruction: z.string(),
  durationMin: z.number().optional(),
  distanceM: z.number().optional(),
  stops: z.number().optional(),
  coverage: CoverageSchema,
  costLabel: z.string().optional(), // "Covered by pass", "Standard fare", etc.
  execution: ExecutionSchema.optional(),
  // Transit-specific details
  transitDetails: z.object({
    line: z.string().optional(),
    direction: z.string().optional(),
    departureStop: z.string().optional(),
    arrivalStop: z.string().optional(),
    departureTime: z.string().optional(),
    arrivalTime: z.string().optional(),
    vehicleType: z.string().optional(),
  }).optional(),
});

export type MobilityStep = z.infer<typeof MobilityStepSchema>;

// ============================================
// STRESS LEVEL
// ============================================

export const StressLevelSchema = z.enum(["low", "med", "high"]);
export type StressLevel = z.infer<typeof StressLevelSchema>;

// ============================================
// LOCATION
// ============================================

export const LocationSchema = z.object({
  name: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export type Location = z.infer<typeof LocationSchema>;

// ============================================
// MOBILITY PLAN
// ============================================

/**
 * MobilityPlan is the ONLY type the UI should consume for trip display.
 * It is provider-agnostic and includes coverage/entitlement information.
 */
export const MobilityPlanSchema = z.object({
  cityCode: CityCodeSchema,
  origin: LocationSchema,
  destination: LocationSchema,
  steps: z.array(MobilityStepSchema),
  totals: z.object({
    durationMin: z.number(),
    walkingMin: z.number(),
    transfers: z.number(),
  }),
  labels: z.object({
    stress: StressLevelSchema,
    costLabel: z.string(), // Overall cost label (e.g., "Covered by pass", "Standard transit fare")
  }),
  // Deep links for each provider used in the plan
  deepLinks: z.array(z.object({
    providerId: z.string(),
    providerName: z.string(),
    url: z.string(),
    label: z.string().optional(),
  })),
  // Entitlement summary for UI display
  entitlementSummary: z.object({
    hasActivePass: z.boolean(),
    passName: z.string().optional(),
    transitCovered: z.boolean(),
    ridehailDiscount: z.number().optional(), // percentage
    bikeBenefit: z.string().optional(),
  }).optional(),
  // Debug information (only in dev mode)
  debug: z.object({
    entitlementsApplied: z.array(z.string()).optional(),
    coverageSummary: z.record(z.string(), CoverageSchema).optional(),
    providerIdsUsed: z.array(z.string()).optional(),
    llmUsed: z.boolean().optional(),
    decisionReason: z.string().optional(),
  }).optional(),
});

export type MobilityPlan = z.infer<typeof MobilityPlanSchema>;

// ============================================
// PLAN RESULT (with error handling)
// ============================================

export const MobilityPlanResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("plan"),
    mobilityPlan: MobilityPlanSchema,
  }),
  z.object({
    type: z.literal("city_mismatch"),
    suggestedCityCode: CityCodeSchema,
    suggestedCityName: z.string(),
    message: z.string(),
    confidence: z.number(),
  }),
  z.object({
    type: z.literal("no_routes"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    error: z.string(),
  }),
]);

export type MobilityPlanResult = z.infer<typeof MobilityPlanResultSchema>;

// ============================================
// HELPER FUNCTIONS
// ============================================

export function stressScoreToLevel(score: number): StressLevel {
  if (score <= 0.33) return "low";
  if (score <= 0.66) return "med";
  return "high";
}

export function getCoverageLabel(coverage: Coverage, discountPercent?: number): string {
  switch (coverage) {
    case "included":
      return "Covered by pass";
    case "discounted":
      return discountPercent ? `${discountPercent}% off with pass` : "Discounted";
    case "pay":
      return "Standard fare";
    case "unknown":
      return "Fare varies";
  }
}
