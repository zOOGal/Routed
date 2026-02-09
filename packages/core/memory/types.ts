/**
 * USER MEMORY PROFILE — TYPES
 *
 * Structured mobility preferences learned from user behavior.
 * No chatbot memory - just weights that influence routing decisions.
 */

import { z } from "zod";

// ============================================
// USER PROFILE SCHEMA
// ============================================

export const UserProfilePrefsSchema = z.object({
  // Walking tolerance: learned minimum/maximum in minutes
  walkingToleranceMin: z.number().min(0).max(60).default(10),
  walkingToleranceMax: z.number().min(5).max(60).default(30),

  // Transfer tolerance: 0 = avoid all transfers, 1 = don't mind transfers
  transferTolerance: z.number().min(0).max(1).default(0.5),

  // Calm vs Quick bias: -1 = strongly prefer calm, +1 = strongly prefer fast
  calmQuickBias: z.number().min(-1).max(1).default(0),

  // Cost vs Comfort bias: -1 = strongly prefer saving, +1 = strongly prefer comfort
  costComfortBias: z.number().min(-1).max(1).default(0),

  // Outdoor bias: -1 = avoid outdoor exposure, +1 = prefer outdoor routes
  outdoorBias: z.number().min(-1).max(1).default(0),

  // Replan sensitivity: 0 = don't suggest replans, 1 = aggressive replanning
  replanSensitivity: z.number().min(0).max(1).default(0.5),
});

export type UserProfilePrefs = z.infer<typeof UserProfilePrefsSchema>;

export const CityFamiliaritySchema = z.record(
  z.string(), // cityCode
  z.number().min(0).max(1) // familiarity score
);

export type CityFamiliarity = z.infer<typeof CityFamiliaritySchema>;

export const UserProfileSchema = z.object({
  userId: z.string(),
  prefs: UserProfilePrefsSchema,
  cityFamiliarity: CityFamiliaritySchema,
  totalTrips: z.number().int().nonnegative().default(0),
  lastTripAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// ============================================
// EVENT TYPES
// ============================================

export const ProfileEventTypeSchema = z.enum([
  // Trip lifecycle
  "plan_accepted",
  "plan_declined",
  "trip_started",
  "trip_completed",
  "trip_abandoned",

  // Route decisions
  "route_override",
  "chose_faster_option",
  "chose_calmer_option",
  "chose_cheaper_option",
  "chose_comfort_option",

  // Step-level behavior
  "step_completed",
  "walked_more_than_expected",
  "walked_less_than_expected",

  // Replan responses
  "replan_shown",
  "replan_accepted",
  "replan_declined",

  // Feature usage
  "opened_system_map",
  "requested_in_app_ride",

  // City/context
  "city_switch_suggested",
  "city_switch_accepted",
  "city_switch_declined",

  // User input
  "note_added",
]);

export type ProfileEventType = z.infer<typeof ProfileEventTypeSchema>;

export const ProfileEventPayloadSchema = z.object({
  // Common context
  cityCode: z.string().optional(),
  weather: z.string().optional(),
  timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]).optional(),

  // Route override
  originalMode: z.string().optional(),
  chosenMode: z.string().optional(),
  overrideReason: z.string().optional(),

  // Step completion
  stepIndex: z.number().int().optional(),
  expectedDurationMin: z.number().optional(),
  actualDurationMin: z.number().optional(),
  stepType: z.string().optional(),

  // Walking
  expectedWalkMin: z.number().optional(),
  actualWalkMin: z.number().optional(),

  // Note keywords (extracted from user note)
  keywords: z.array(z.string()).optional(),

  // Replan
  replanReason: z.string().optional(),

  // Generic metadata
  confidence: z.number().min(0).max(1).optional(),
});

export type ProfileEventPayload = z.infer<typeof ProfileEventPayloadSchema>;

export const ProfileEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  tripId: z.string().optional(),
  type: ProfileEventTypeSchema,
  payload: ProfileEventPayloadSchema.optional(),
  createdAt: z.string().datetime(),
});

export type ProfileEvent = z.infer<typeof ProfileEventSchema>;

// ============================================
// DEFAULTS
// ============================================

export const DEFAULT_USER_PREFS: UserProfilePrefs = {
  walkingToleranceMin: 15,  // Minutes - user's comfortable walking threshold
  walkingToleranceMax: 30,
  transferTolerance: 0.5,   // 0 = avoid transfers, 1 = don't mind
  calmQuickBias: 0,         // -1 = prefer calm, +1 = prefer fast (speedBias)
  costComfortBias: 0,       // -1 = prefer cheap, +1 = prefer comfort (comfortBias)
  outdoorBias: 0,
  replanSensitivity: 0.5,
};

export function createDefaultProfile(userId: string): UserProfile {
  const now = new Date().toISOString();
  return {
    userId,
    prefs: { ...DEFAULT_USER_PREFS },
    cityFamiliarity: {},
    totalTrips: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================
// PROFILE TO SCORING BIASES CONVERSION
// ============================================

/**
 * Convert learned profile preferences to scoring biases.
 * Returns values in 0-1 range for the scoring skill.
 */
export interface ScoringBiases {
  calm: number; // 0-1, higher = prefer calmer routes
  fast: number; // 0-1, higher = prefer faster routes
  comfort: number; // 0-1, higher = prefer comfort
  cost: number; // 0-1, higher = prefer cheaper
}

export function profileToScoringBiases(prefs: UserProfilePrefs): ScoringBiases {
  // Convert from -1..+1 biases to 0..1 scoring weights
  // calmQuickBias: -1 = calm, +1 = fast
  const calmFastMidpoint = 0.5;
  const calm = calmFastMidpoint - prefs.calmQuickBias * 0.4; // -1 -> 0.9, 0 -> 0.5, +1 -> 0.1
  const fast = calmFastMidpoint + prefs.calmQuickBias * 0.4; // -1 -> 0.1, 0 -> 0.5, +1 -> 0.9

  // costComfortBias: -1 = cost conscious, +1 = comfort seeking
  const costComfortMidpoint = 0.5;
  const cost = costComfortMidpoint - prefs.costComfortBias * 0.4;
  const comfort = costComfortMidpoint + prefs.costComfortBias * 0.4;

  return {
    calm: Math.max(0, Math.min(1, calm)),
    fast: Math.max(0, Math.min(1, fast)),
    comfort: Math.max(0, Math.min(1, comfort)),
    cost: Math.max(0, Math.min(1, cost)),
  };
}

// ============================================
// MEMORY CALLBACK GENERATION
// ============================================

export interface MemoryInsight {
  line: string;
  confidence: number;
  prefKey: keyof UserProfilePrefs;
}

/**
 * Generate a memory callback line based on profile.
 * Only returns insight if confidence is high enough.
 */
export function generateMemoryInsight(
  profile: UserProfile,
  context: { cityCode?: string; hasTransfers?: boolean; hasLongWalk?: boolean }
): MemoryInsight | null {
  const { prefs, totalTrips, cityFamiliarity } = profile;

  // Need enough trips to have meaningful learned preferences
  if (totalTrips < 5) return null;

  const insights: MemoryInsight[] = [];

  // Check for strong preferences (threshold: |bias| > 0.3)
  if (prefs.calmQuickBias < -0.3) {
    insights.push({
      line: "I kept it simple since you usually prefer calmer routes.",
      confidence: Math.abs(prefs.calmQuickBias),
      prefKey: "calmQuickBias",
    });
  }

  if (prefs.calmQuickBias > 0.3) {
    insights.push({
      line: "I prioritized speed since you're usually in a hurry.",
      confidence: prefs.calmQuickBias,
      prefKey: "calmQuickBias",
    });
  }

  if (prefs.transferTolerance < 0.3 && context.hasTransfers === false) {
    insights.push({
      line: "I avoided transfers since you prefer direct routes.",
      confidence: 1 - prefs.transferTolerance,
      prefKey: "transferTolerance",
    });
  }

  if (prefs.walkingToleranceMax < 15 && context.hasLongWalk === false) {
    insights.push({
      line: "I minimized walking since you prefer shorter walks.",
      confidence: 0.7,
      prefKey: "walkingToleranceMax",
    });
  }

  if (prefs.costComfortBias > 0.3) {
    insights.push({
      line: "I chose comfort over cost since that's your preference.",
      confidence: prefs.costComfortBias,
      prefKey: "costComfortBias",
    });
  }

  if (prefs.costComfortBias < -0.3) {
    insights.push({
      line: "I found the most economical option for you.",
      confidence: Math.abs(prefs.costComfortBias),
      prefKey: "costComfortBias",
    });
  }

  // City familiarity
  if (context.cityCode && cityFamiliarity[context.cityCode] >= 0.7) {
    insights.push({
      line: "You know this city well, so I kept recommendations brief.",
      confidence: cityFamiliarity[context.cityCode],
      prefKey: "transferTolerance", // Placeholder, not directly a pref
    });
  }

  if (context.cityCode && cityFamiliarity[context.cityCode] < 0.3 && totalTrips > 0) {
    insights.push({
      line: "Since you're new to this city, I chose simpler routes.",
      confidence: 0.6,
      prefKey: "transferTolerance",
    });
  }

  // Return highest confidence insight, if any meet threshold
  if (insights.length === 0) return null;

  const sorted = insights.sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];

  // Only return if confidence > 0.5
  return best.confidence > 0.5 ? best : null;
}
