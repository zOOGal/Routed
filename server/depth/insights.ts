import type { DepthLayerInput, PrioritizedInsight, MemoryCallbackContext } from "./types";
import { INSIGHT_TEMPLATES, MEMORY_CALLBACK_TEMPLATES } from "./templates";

const MAX_INSIGHTS = 4;
const PREFERRED_INSIGHTS = 3;

/**
 * Generate and prioritize contextual insights
 * Returns 0-4 insights, preferring 2-3
 */
export function generateContextualInsights(input: DepthLayerInput): string[] {
  const insights: PrioritizedInsight[] = [];

  // Evaluate each template
  for (const template of INSIGHT_TEMPLATES) {
    try {
      if (template.condition(input)) {
        const text = template.generate(input);
        if (text && text.length > 0) {
          insights.push({
            category: template.category as PrioritizedInsight["category"],
            text,
            priority: template.priority,
            confidence: 1.0,
          });
        }
      }
    } catch {
      // Skip failed templates
      continue;
    }
  }

  // Sort by priority (lower = higher priority)
  insights.sort((a, b) => a.priority - b.priority);

  // Apply category limits (max 1 per category for balance)
  const seenCategories = new Set<string>();
  const filteredInsights: PrioritizedInsight[] = [];

  for (const insight of insights) {
    // Allow venue_hours and weather_impact to have 2 entries max
    const maxPerCategory =
      insight.category === "venue_hours" || insight.category === "weather_impact" ? 2 : 1;
    const categoryCount = filteredInsights.filter((i) => i.category === insight.category).length;

    if (categoryCount < maxPerCategory) {
      filteredInsights.push(insight);
    }

    if (filteredInsights.length >= MAX_INSIGHTS) {
      break;
    }
  }

  // Prefer 2-3 insights if we have more
  const finalInsights = filteredInsights.slice(0, PREFERRED_INSIGHTS);

  // But include 4th if it's high priority (venue or weather)
  if (
    filteredInsights.length > PREFERRED_INSIGHTS &&
    filteredInsights[PREFERRED_INSIGHTS]?.priority <= 3
  ) {
    finalInsights.push(filteredInsights[PREFERRED_INSIGHTS]);
  }

  return finalInsights.map((i) => i.text);
}

/**
 * Determine if a memory callback should be shown
 * Shows at most 20% of trips and only when confidence is high
 */
export function shouldShowMemoryCallback(
  input: DepthLayerInput,
  tripCount: number
): MemoryCallbackContext {
  // Don't show on first few trips
  if (tripCount < 3) {
    return { shouldShow: false, confidence: 0, basedOn: "not_enough_history" };
  }

  // Random chance to not show (80% of time)
  // Use trip count as seed for determinism in testing
  const showChance = (tripCount * 7) % 10; // Pseudo-random based on trip count
  if (showChance >= 2) {
    return { shouldShow: false, confidence: 0, basedOn: "random_suppression" };
  }

  const recentEvents = input.recentEvents;
  if (recentEvents.length < 3) {
    return { shouldShow: false, confidence: 0, basedOn: "not_enough_events" };
  }

  // Check each memory callback template
  for (const template of MEMORY_CALLBACK_TEMPLATES) {
    try {
      if (template.contextMatch(input, recentEvents)) {
        const text = template.generate(input);
        if (text && text.length > 0) {
          return {
            shouldShow: true,
            text,
            confidence: template.minConfidence,
            basedOn: template.eventPattern,
          };
        }
      }
    } catch {
      continue;
    }
  }

  return { shouldShow: false, confidence: 0, basedOn: "no_pattern_match" };
}

/**
 * Check if current time is rush hour
 */
export function isRushHour(date: Date): boolean {
  const hour = date.getHours();
  const dayOfWeek = date.getDay();

  // Weekend - no rush hour
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // Morning rush: 7-9am
  if (hour >= 7 && hour < 9) {
    return true;
  }

  // Evening rush: 5-7pm
  if (hour >= 17 && hour < 19) {
    return true;
  }

  return false;
}

/**
 * Check if current time is night time
 */
export function isNightTime(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
}

/**
 * Calculate insight diversity score
 * Higher score = better variety of insight categories
 */
export function calculateInsightDiversity(insights: PrioritizedInsight[]): number {
  if (insights.length === 0) return 0;

  const categories = new Set(insights.map((i) => i.category));
  return categories.size / insights.length;
}
