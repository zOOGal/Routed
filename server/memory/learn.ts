import type { LearnedPreferences, UserEvent, UserEventType } from "@shared/schema";
import { DEFAULT_LEARNED_PREFERENCES } from "../depth/types";
import type { EventContext } from "./events";

/**
 * Learning rate constants - how much each event affects preferences
 */
const LEARNING_RATES = {
  // Walking tolerance
  walked_less_than_suggested: -0.05, // Decrease walking tolerance
  walked_more_than_suggested: 0.02, // Slightly increase tolerance

  // Calm vs quick preference
  chose_calmer_option: -0.03, // Shift toward calm
  chose_faster_option: 0.03, // Shift toward fast

  // Cost sensitivity
  override_to_cheaper: -0.03, // More cost sensitive
  override_to_premium: 0.03, // Less cost sensitive

  // Replan sensitivity
  replan_accepted: 0.02, // Slightly more aggressive replanning
  replan_declined: -0.03, // Less aggressive replanning

  // Confidence adjustments
  opened_maps_frequently: -0.02, // User checks maps often, add more detail
  trip_completed_smoothly: 0.01, // Trust is building

  // City familiarity
  trip_completed_in_city: 0.05, // Increase familiarity
  abandoned_in_city: -0.02, // Slight decrease in familiarity
};

/**
 * Apply a single event to learned preferences
 * Returns updated preferences
 */
export function applyEventToPreferences(
  currentPrefs: LearnedPreferences,
  event: UserEvent
): LearnedPreferences {
  const updated = { ...currentPrefs };
  const context = event.context as EventContext | null;
  const eventType = event.eventType as UserEventType;

  switch (eventType) {
    case "walked_less_than_suggested":
      // User avoided suggested walking - reduce walking tolerance
      updated.walkingToleranceMin = Math.max(
        5,
        updated.walkingToleranceMin + LEARNING_RATES.walked_less_than_suggested * 10
      );
      break;

    case "walked_more_than_suggested":
      // User walked more than suggested - slightly increase tolerance
      updated.walkingToleranceMin = Math.min(
        20,
        updated.walkingToleranceMin + LEARNING_RATES.walked_more_than_suggested * 10
      );
      break;

    case "chose_calmer_option":
      // User chose calmer/simpler option
      updated.calmQuickBias = Math.max(
        0,
        updated.calmQuickBias + LEARNING_RATES.chose_calmer_option
      );
      updated.transferTolerance = Math.max(1, updated.transferTolerance - 0.2);
      break;

    case "chose_faster_option":
      // User chose faster option
      updated.calmQuickBias = Math.min(
        1,
        updated.calmQuickBias + LEARNING_RATES.chose_faster_option
      );
      break;

    case "override_route":
      // Analyze what kind of override
      if (context?.newMode === "transit" && context?.originalMode === "rideshare") {
        // Chose cheaper option
        updated.saveSpendBias = Math.max(0, updated.saveSpendBias - 0.03);
      } else if (context?.newMode === "rideshare" && context?.originalMode === "transit") {
        // Chose premium option
        updated.saveSpendBias = Math.min(1, updated.saveSpendBias + 0.03);
      }
      break;

    case "replan_accepted":
      // User accepted replan suggestion
      updated.replanSensitivity = Math.min(
        0.9,
        updated.replanSensitivity + LEARNING_RATES.replan_accepted
      );
      break;

    case "replan_declined":
      // User declined replan - be less aggressive
      updated.replanSensitivity = Math.max(
        0.1,
        updated.replanSensitivity + LEARNING_RATES.replan_declined
      );
      break;

    case "opened_maps":
      // User opened maps - they may need more detail
      // Track this but don't heavily penalize
      break;

    case "trip_completed":
      // Successful trip - increase city familiarity
      if (context?.cityId) {
        const currentFamiliarity = updated.familiarityByCity[context.cityId] || 0;
        updated.familiarityByCity[context.cityId] = Math.min(
          1,
          currentFamiliarity + LEARNING_RATES.trip_completed_in_city
        );
      }
      break;

    case "abandoned_trip":
      // User abandoned trip - slight decrease in city familiarity
      if (context?.cityId) {
        const currentFamiliarity = updated.familiarityByCity[context.cityId] || 0;
        updated.familiarityByCity[context.cityId] = Math.max(
          0,
          currentFamiliarity + LEARNING_RATES.abandoned_in_city
        );
      }
      break;

    case "step_completed":
      // Analyze step completion timing
      if (context?.expectedDuration && context?.actualDuration) {
        const ratio = context.actualDuration / context.expectedDuration;
        // If consistently taking longer than expected, user may be slower walker
        if (ratio > 1.3 && context.stepIndex !== undefined) {
          updated.walkingToleranceMin = Math.max(5, updated.walkingToleranceMin - 0.5);
        }
      }
      break;

    default:
      // Unknown event type - no preference update
      break;
  }

  updated.lastUpdated = new Date().toISOString();
  return updated;
}

/**
 * Apply multiple events to preferences in sequence
 */
export function applyEventsToPreferences(
  currentPrefs: LearnedPreferences,
  events: UserEvent[]
): LearnedPreferences {
  let prefs = currentPrefs;
  for (const event of events) {
    prefs = applyEventToPreferences(prefs, event);
  }
  return prefs;
}

/**
 * Calculate preference confidence based on event history
 * More events = higher confidence in learned preferences
 */
export function calculatePreferenceConfidence(events: UserEvent[]): number {
  // Base confidence
  let confidence = 0.3;

  // More events = higher confidence (up to 0.9)
  const eventBonus = Math.min(0.4, events.length * 0.02);
  confidence += eventBonus;

  // Consistency bonus - check if events show consistent patterns
  const consistencyBonus = calculateConsistencyBonus(events);
  confidence += consistencyBonus;

  return Math.min(0.95, confidence);
}

/**
 * Calculate bonus for consistent behavior patterns
 */
function calculateConsistencyBonus(events: UserEvent[]): number {
  if (events.length < 5) return 0;

  // Check for consistent calm vs fast choices
  const calmChoices = events.filter((e) => e.eventType === "chose_calmer_option").length;
  const fastChoices = events.filter((e) => e.eventType === "chose_faster_option").length;
  const totalChoices = calmChoices + fastChoices;

  if (totalChoices >= 3) {
    const dominantRatio = Math.max(calmChoices, fastChoices) / totalChoices;
    if (dominantRatio >= 0.75) {
      return 0.15; // Strong consistent pattern
    }
    if (dominantRatio >= 0.6) {
      return 0.08; // Moderate consistent pattern
    }
  }

  return 0;
}

/**
 * Merge two preference objects, weighted by recency/confidence
 */
export function mergePreferences(
  oldPrefs: LearnedPreferences,
  newPrefs: LearnedPreferences,
  newWeight: number = 0.3
): LearnedPreferences {
  const oldWeight = 1 - newWeight;

  return {
    walkingToleranceMin:
      oldPrefs.walkingToleranceMin * oldWeight + newPrefs.walkingToleranceMin * newWeight,
    transferTolerance:
      oldPrefs.transferTolerance * oldWeight + newPrefs.transferTolerance * newWeight,
    calmQuickBias: oldPrefs.calmQuickBias * oldWeight + newPrefs.calmQuickBias * newWeight,
    saveSpendBias: oldPrefs.saveSpendBias * oldWeight + newPrefs.saveSpendBias * newWeight,
    familiarityByCity: {
      ...oldPrefs.familiarityByCity,
      ...newPrefs.familiarityByCity,
    },
    replanSensitivity:
      oldPrefs.replanSensitivity * oldWeight + newPrefs.replanSensitivity * newWeight,
    lastUpdated: newPrefs.lastUpdated,
  };
}

/**
 * Initialize preferences for a new user
 */
export function initializePreferences(): LearnedPreferences {
  return { ...DEFAULT_LEARNED_PREFERENCES };
}

/**
 * Check if preferences have changed significantly
 */
export function hasSignificantChange(
  oldPrefs: LearnedPreferences,
  newPrefs: LearnedPreferences,
  threshold: number = 0.1
): boolean {
  const diffs = [
    Math.abs(oldPrefs.walkingToleranceMin - newPrefs.walkingToleranceMin) / 20,
    Math.abs(oldPrefs.transferTolerance - newPrefs.transferTolerance) / 5,
    Math.abs(oldPrefs.calmQuickBias - newPrefs.calmQuickBias),
    Math.abs(oldPrefs.saveSpendBias - newPrefs.saveSpendBias),
    Math.abs(oldPrefs.replanSensitivity - newPrefs.replanSensitivity),
  ];

  const maxDiff = Math.max(...diffs);
  return maxDiff >= threshold;
}
