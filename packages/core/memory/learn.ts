/**
 * USER MEMORY PROFILE — LEARNING RULES
 *
 * Applies events to update user profile preferences.
 * Uses small deltas and clamping to prevent runaway values.
 */

import type {
  UserProfile,
  UserProfilePrefs,
  ProfileEvent,
  ProfileEventType,
} from "./types";
import { DEFAULT_USER_PREFS } from "./types";

// ============================================
// LEARNING RATES
// ============================================

/**
 * Small deltas for preference updates.
 * Positive = increase value, negative = decrease.
 *
 * Key learning rules:
 * - step_done with walk >= 10min completed → walkingToleranceMin += 1
 * - plan_rejected with transfers >= 2 → transferTolerance -= 0.05
 * - requested_ride_in_app → comfortBias += 0.08, walkingToleranceMin -= 1
 * - plan_accepted with urgent intent → speedBias += 0.05
 * - trip_completed → totalTrips++, cityFamiliarity += 0.1
 */
const LEARNING_RATES: Partial<Record<ProfileEventType, Partial<Record<keyof UserProfilePrefs, number>>>> = {
  // Walking behavior
  walked_more_than_expected: {
    walkingToleranceMin: 1, // minutes increase
    walkingToleranceMax: 2,
  },
  walked_less_than_expected: {
    walkingToleranceMin: -1,
    walkingToleranceMax: -2,
  },

  // Speed preference (calmQuickBias: -1=calm, +1=fast)
  chose_faster_option: {
    calmQuickBias: 0.05, // shift toward "fast"
  },
  chose_calmer_option: {
    calmQuickBias: -0.05, // shift toward "calm"
  },

  // Cost/Comfort preference (costComfortBias: -1=cheap, +1=comfort)
  chose_cheaper_option: {
    costComfortBias: -0.05, // shift toward "cost conscious"
  },
  chose_comfort_option: {
    costComfortBias: 0.05, // shift toward "comfort seeking"
  },

  // Route override - strongest signals
  route_override: {
    // Applied based on payload, see applyRouteOverride
  },

  // Replan behavior
  replan_accepted: {
    replanSensitivity: 0.03,
  },
  replan_declined: {
    replanSensitivity: -0.05,
  },

  // Trip completion - general familiarity boost (handled specially)
  trip_completed: {},

  // Trip abandoned - negative signal
  trip_abandoned: {
    replanSensitivity: 0.02,
  },

  // Ridehail usage signals comfort preference and lower walking tolerance
  requested_in_app_ride: {
    costComfortBias: 0.08,      // Strong comfort signal
    walkingToleranceMin: -1,   // Decrease walking tolerance
  },

  // Plan rejected - handled specially based on payload
  plan_rejected: {},

  // Plan accepted - handled specially based on payload (urgent intent)
  plan_accepted: {},
};

// ============================================
// CLAMPING HELPERS
// ============================================

interface ClampRange {
  min: number;
  max: number;
}

const CLAMP_RANGES: Record<keyof UserProfilePrefs, ClampRange> = {
  walkingToleranceMin: { min: 0, max: 60 },
  walkingToleranceMax: { min: 5, max: 60 },
  transferTolerance: { min: 0, max: 1 },
  calmQuickBias: { min: -1, max: 1 },
  costComfortBias: { min: -1, max: 1 },
  outdoorBias: { min: -1, max: 1 },
  replanSensitivity: { min: 0, max: 1 },
};

function clampPref(key: keyof UserProfilePrefs, value: number): number {
  const range = CLAMP_RANGES[key];
  return Math.max(range.min, Math.min(range.max, value));
}

function clampAllPrefs(prefs: UserProfilePrefs): UserProfilePrefs {
  const clamped = { ...prefs };
  for (const key of Object.keys(CLAMP_RANGES) as (keyof UserProfilePrefs)[]) {
    clamped[key] = clampPref(key, clamped[key]);
  }

  // Ensure walkingToleranceMin <= walkingToleranceMax
  if (clamped.walkingToleranceMin > clamped.walkingToleranceMax) {
    const mid = (clamped.walkingToleranceMin + clamped.walkingToleranceMax) / 2;
    clamped.walkingToleranceMin = mid - 2;
    clamped.walkingToleranceMax = mid + 2;
  }

  return clamped;
}

// ============================================
// EVENT APPLICATION
// ============================================

/**
 * Apply a single event to a user profile.
 * Returns updated profile (or same profile if no changes).
 */
export function applyEvent(profile: UserProfile, event: ProfileEvent): UserProfile {
  const updatedPrefs = { ...profile.prefs };
  let cityFamiliarity = { ...profile.cityFamiliarity };
  let totalTrips = profile.totalTrips;

  const eventType = event.type;
  const payload = event.payload || {};

  // Apply standard learning rates
  const rates = LEARNING_RATES[eventType];
  if (rates) {
    for (const [key, delta] of Object.entries(rates) as [keyof UserProfilePrefs, number][]) {
      if (delta !== undefined && key in updatedPrefs) {
        updatedPrefs[key] = updatedPrefs[key] + delta;
      }
    }
  }

  // Special handling by event type
  switch (eventType) {
    case "route_override":
      applyRouteOverride(updatedPrefs, payload);
      break;

    case "trip_completed":
      totalTrips += 1;
      // City familiarity += 0.1 (clamped to 1)
      if (payload.cityCode) {
        const current = cityFamiliarity[payload.cityCode] || 0;
        cityFamiliarity[payload.cityCode] = Math.min(1, current + 0.1);
      }
      break;

    case "trip_abandoned":
      // Slight familiarity decrease for abandoned trips
      if (payload.cityCode) {
        const current = cityFamiliarity[payload.cityCode] || 0;
        cityFamiliarity[payload.cityCode] = Math.max(0, current - 0.02);
      }
      break;

    case "city_switch_accepted":
      // Reset familiarity for new city if switching
      if (payload.cityCode) {
        cityFamiliarity[payload.cityCode] = cityFamiliarity[payload.cityCode] || 0.1;
      }
      break;

    case "step_completed":
      applyStepCompleted(updatedPrefs, payload);
      break;

    case "step_done" as ProfileEventType:
      // step_done with mode="walk" and durationMin >= 10 → walkingToleranceMin += 1
      if (payload.stepType === "walk" || payload.mode === "walk") {
        const duration = payload.actualDurationMin || payload.expectedDurationMin || 0;
        if (duration >= 10) {
          updatedPrefs.walkingToleranceMin = updatedPrefs.walkingToleranceMin + 1;
        }
      }
      break;

    case "plan_rejected" as ProfileEventType:
      // plan_rejected with transfers >= 2 → transferTolerance -= 0.05
      const transfers = (payload.transfers as number) || 0;
      if (transfers >= 2) {
        updatedPrefs.transferTolerance = updatedPrefs.transferTolerance - 0.05;
      }
      break;

    case "plan_accepted" as ProfileEventType:
      // plan_accepted with urgent/time_sensitive intent → speedBias += 0.05
      const intent = payload.tripIntent as string;
      if (intent === "time_sensitive" || intent === "urgent" || intent === "work") {
        updatedPrefs.calmQuickBias = updatedPrefs.calmQuickBias + 0.05;
      }
      break;

    case "note_added":
      applyNoteKeywords(updatedPrefs, payload);
      break;
  }

  // Clamp all values
  const clampedPrefs = clampAllPrefs(updatedPrefs);

  return {
    ...profile,
    prefs: clampedPrefs,
    cityFamiliarity,
    totalTrips,
    updatedAt: new Date().toISOString(),
    lastTripAt: eventType === "trip_completed" ? new Date().toISOString() : profile.lastTripAt,
  };
}

/**
 * Apply multiple events in sequence.
 */
export function applyEvents(profile: UserProfile, events: ProfileEvent[]): UserProfile {
  return events.reduce((p, e) => applyEvent(p, e), profile);
}

// ============================================
// SPECIALIZED HANDLERS
// ============================================

function applyRouteOverride(
  prefs: UserProfilePrefs,
  payload: ProfileEvent["payload"]
): void {
  if (!payload) return;

  const { originalMode, chosenMode, overrideReason } = payload;

  // Override to ridehail/comfort
  if (chosenMode === "rideshare" || chosenMode === "ridehail") {
    prefs.costComfortBias += 0.08;
    prefs.walkingToleranceMax -= 2;
    prefs.transferTolerance += 0.05; // Less averse if they can always take a car
  }

  // Override to walking
  if (chosenMode === "walk" && originalMode !== "walk") {
    prefs.walkingToleranceMax += 3;
    prefs.outdoorBias += 0.05;
  }

  // Override from transit to ridehail (strong signal)
  if (originalMode === "transit" && (chosenMode === "rideshare" || chosenMode === "ridehail")) {
    prefs.transferTolerance -= 0.05;
    prefs.calmQuickBias += 0.03; // Might have been in a hurry
  }

  // Reason-based adjustments
  if (overrideReason) {
    const reason = overrideReason.toLowerCase();
    if (reason.includes("tired") || reason.includes("exhausted")) {
      prefs.walkingToleranceMax -= 3;
      prefs.costComfortBias += 0.05;
    }
    if (reason.includes("hurry") || reason.includes("late") || reason.includes("urgent")) {
      prefs.calmQuickBias += 0.08;
    }
    if (reason.includes("rain") || reason.includes("weather") || reason.includes("cold")) {
      prefs.outdoorBias -= 0.05;
    }
  }
}

function applyStepCompleted(
  prefs: UserProfilePrefs,
  payload: ProfileEvent["payload"]
): void {
  if (!payload) return;

  const { stepType, expectedDurationMin, actualDurationMin } = payload;

  // Walking step analysis
  if (stepType === "walk" && expectedDurationMin && actualDurationMin) {
    const ratio = actualDurationMin / expectedDurationMin;

    if (ratio < 0.8) {
      // Completed much faster - they walk fast, might tolerate more
      prefs.walkingToleranceMax += 1;
    } else if (ratio > 1.3) {
      // Took much longer - struggled with the walk
      prefs.walkingToleranceMax -= 1;
    }
  }

  // Transfer step analysis
  if (stepType === "transfer" && expectedDurationMin && actualDurationMin) {
    const ratio = actualDurationMin / expectedDurationMin;

    if (ratio > 1.5) {
      // Transfer took much longer - negative experience
      prefs.transferTolerance -= 0.02;
    }
  }
}

function applyNoteKeywords(
  prefs: UserProfilePrefs,
  payload: ProfileEvent["payload"]
): void {
  if (!payload?.keywords) return;

  const keywords = payload.keywords.map((k) => k.toLowerCase());

  // Urgency keywords
  const urgencyKeywords = ["urgent", "hurry", "rush", "late", "important", "meeting", "interview"];
  if (keywords.some((k) => urgencyKeywords.includes(k))) {
    prefs.calmQuickBias += 0.03;
  }

  // Comfort keywords
  const comfortKeywords = ["date", "romantic", "special", "impress", "celebration", "nice"];
  if (keywords.some((k) => comfortKeywords.includes(k))) {
    prefs.costComfortBias += 0.03;
  }

  // Tired/accessibility keywords
  const tiredKeywords = ["tired", "exhausted", "heavy", "bags", "luggage", "injured", "mobility"];
  if (keywords.some((k) => tiredKeywords.includes(k))) {
    prefs.walkingToleranceMax -= 2;
    prefs.costComfortBias += 0.02;
  }

  // Budget keywords
  const budgetKeywords = ["budget", "cheap", "save", "affordable", "free"];
  if (keywords.some((k) => budgetKeywords.includes(k))) {
    prefs.costComfortBias -= 0.03;
  }

  // Scenic/explore keywords
  const exploreKeywords = ["scenic", "explore", "adventure", "walk", "stroll"];
  if (keywords.some((k) => exploreKeywords.includes(k))) {
    prefs.walkingToleranceMax += 2;
    prefs.outdoorBias += 0.03;
    prefs.calmQuickBias -= 0.02;
  }
}

// ============================================
// CONFIDENCE CALCULATION
// ============================================

/**
 * Calculate confidence in learned preferences based on event count and consistency.
 */
export function calculateConfidence(profile: UserProfile, recentEvents: ProfileEvent[]): number {
  const { totalTrips } = profile;

  // Base confidence from trip count
  // 0 trips = 0.2, 5 trips = 0.5, 20+ trips = 0.8
  const tripConfidence = Math.min(0.8, 0.2 + totalTrips * 0.03);

  // Check consistency of recent decisions
  if (recentEvents.length < 3) {
    return tripConfidence;
  }

  // Count calm vs fast choices
  const calmChoices = recentEvents.filter((e) => e.type === "chose_calmer_option").length;
  const fastChoices = recentEvents.filter((e) => e.type === "chose_faster_option").length;
  const totalChoices = calmChoices + fastChoices;

  if (totalChoices >= 3) {
    const dominance = Math.max(calmChoices, fastChoices) / totalChoices;
    if (dominance >= 0.75) {
      return Math.min(0.95, tripConfidence + 0.15);
    }
    if (dominance >= 0.6) {
      return Math.min(0.9, tripConfidence + 0.08);
    }
  }

  return tripConfidence;
}

// ============================================
// PROFILE VALIDATION & RESET
// ============================================

/**
 * Check if profile has diverged significantly from defaults.
 */
export function hasSignificantDivergence(prefs: UserProfilePrefs): boolean {
  const threshold = 0.15;

  return (
    Math.abs(prefs.calmQuickBias - DEFAULT_USER_PREFS.calmQuickBias) > threshold ||
    Math.abs(prefs.costComfortBias - DEFAULT_USER_PREFS.costComfortBias) > threshold ||
    Math.abs(prefs.transferTolerance - DEFAULT_USER_PREFS.transferTolerance) > threshold ||
    Math.abs(prefs.walkingToleranceMax - DEFAULT_USER_PREFS.walkingToleranceMax) > 5
  );
}

/**
 * Reset profile preferences to defaults (keeping familiarity and trip count).
 */
export function resetPrefs(profile: UserProfile): UserProfile {
  return {
    ...profile,
    prefs: { ...DEFAULT_USER_PREFS },
    updatedAt: new Date().toISOString(),
  };
}

// ============================================
// MEMORY CALLBACK THROTTLING
// ============================================

const MEMORY_CALLBACK_PROBABILITY = 0.2; // 20% of trips

/**
 * Determine if we should show a memory callback line.
 * Throttled to ~20% of trips with high-confidence preferences.
 */
export function shouldShowMemoryCallback(
  profile: UserProfile,
  confidence: number
): boolean {
  // Need enough trips
  if (profile.totalTrips < 5) return false;

  // Need high confidence
  if (confidence < 0.6) return false;

  // Need significant learned preferences
  if (!hasSignificantDivergence(profile.prefs)) return false;

  // Random throttle
  return Math.random() < MEMORY_CALLBACK_PROBABILITY;
}
