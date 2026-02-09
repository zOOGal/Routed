import type { UserEventType, UserEvent, InsertUserEvent } from "@shared/schema";

/**
 * Event context structure for different event types
 */
export interface EventContext {
  // Common fields
  weather?: string;
  temperature?: number;
  timeOfDay?: "morning" | "afternoon" | "evening" | "night";
  dayOfWeek?: number;

  // Route-specific
  routeMode?: string;
  stepIndex?: number;
  totalSteps?: number;

  // Override-specific
  originalMode?: string;
  newMode?: string;
  originalDuration?: number;
  newDuration?: number;

  // Timing-specific
  expectedDuration?: number;
  actualDuration?: number;

  // Location
  cityId?: string;
}

/**
 * Create a user event object
 */
export function createUserEvent(
  userId: string,
  eventType: UserEventType,
  tripId?: string,
  context?: EventContext,
  cityId?: string
): InsertUserEvent {
  return {
    userId,
    tripId: tripId || null,
    eventType,
    cityId: cityId || context?.cityId || null,
    context: context || null,
  };
}

/**
 * Determine time of day category
 */
export function getTimeOfDay(date: Date): EventContext["timeOfDay"] {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/**
 * Build context for step completion event
 */
export function buildStepCompletionContext(
  stepIndex: number,
  totalSteps: number,
  expectedDuration: number,
  actualDuration: number,
  weather?: string,
  cityId?: string
): EventContext {
  return {
    stepIndex,
    totalSteps,
    expectedDuration,
    actualDuration,
    weather,
    cityId,
    timeOfDay: getTimeOfDay(new Date()),
    dayOfWeek: new Date().getDay(),
  };
}

/**
 * Build context for route override event
 */
export function buildOverrideContext(
  originalMode: string,
  newMode: string,
  originalDuration: number,
  newDuration: number,
  cityId?: string
): EventContext {
  return {
    originalMode,
    newMode,
    originalDuration,
    newDuration,
    cityId,
    timeOfDay: getTimeOfDay(new Date()),
    dayOfWeek: new Date().getDay(),
  };
}

/**
 * Analyze events to find patterns
 */
export function findEventPatterns(
  events: UserEvent[],
  eventType: UserEventType,
  minOccurrences: number = 3
): boolean {
  const matchingEvents = events.filter((e) => e.eventType === eventType);
  return matchingEvents.length >= minOccurrences;
}

/**
 * Get recent events of a specific type
 */
export function getRecentEventsOfType(
  events: UserEvent[],
  eventType: UserEventType,
  limit: number = 10
): UserEvent[] {
  return events
    .filter((e) => e.eventType === eventType)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Calculate event frequency (events per day over last N days)
 */
export function calculateEventFrequency(
  events: UserEvent[],
  eventType: UserEventType,
  daysBack: number = 30
): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const recentEvents = events.filter(
    (e) => e.eventType === eventType && new Date(e.createdAt) >= cutoff
  );

  return recentEvents.length / daysBack;
}
