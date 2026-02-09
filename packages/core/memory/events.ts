/**
 * USER MEMORY EVENTS — LOGGING HELPERS
 *
 * Centralized event logging for user behavior tracking.
 * Events feed into the learning system to update profiles.
 */

import { z } from "zod";

// ============================================
// EVENT TYPES
// ============================================

export const UserEventTypeSchema = z.enum([
  // Plan lifecycle
  "plan_generated",
  "plan_accepted",
  "plan_rejected",

  // Trip execution
  "step_done",
  "trip_completed",
  "trip_abandoned",

  // Feature usage
  "requested_ride_in_app",
  "opened_system_map",

  // Route decisions
  "chose_faster_option",
  "chose_calmer_option",
  "chose_cheaper_option",
  "chose_comfort_option",
]);

export type UserEventType = z.infer<typeof UserEventTypeSchema>;

// ============================================
// EVENT PAYLOAD SCHEMAS
// ============================================

export const PlanGeneratedPayloadSchema = z.object({
  planId: z.string().optional(),
  mode: z.string(),
  durationMin: z.number(),
  walkMin: z.number(),
  transfers: z.number(),
  estimatedCost: z.number().optional(),
  archetype: z.enum(["calm", "fast", "comfort"]).optional(),
});

export const PlanAcceptedPayloadSchema = z.object({
  planId: z.string().optional(),
  mode: z.string(),
  durationMin: z.number(),
  walkMin: z.number(),
  transfers: z.number(),
  tripIntent: z.string().optional(),
});

export const PlanRejectedPayloadSchema = z.object({
  planId: z.string().optional(),
  mode: z.string(),
  transfers: z.number(),
  reason: z.string().optional(),
});

export const StepDonePayloadSchema = z.object({
  tripId: z.string().optional(),
  stepIndex: z.number(),
  stepType: z.enum(["walk", "transit", "rideshare", "bike"]),
  expectedDurationMin: z.number().optional(),
  actualDurationMin: z.number().optional(),
  mode: z.string().optional(),
});

export const TripCompletedPayloadSchema = z.object({
  tripId: z.string().optional(),
  totalDurationMin: z.number().optional(),
  mode: z.string().optional(),
  stepsCompleted: z.number().optional(),
});

export const RideRequestedPayloadSchema = z.object({
  tripId: z.string().optional(),
  providerId: z.string().optional(),
  reason: z.string().optional(),
});

// ============================================
// USER EVENT SCHEMA
// ============================================

export const UserEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  cityCode: z.string(),
  type: UserEventTypeSchema,
  payload: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type UserEvent = z.infer<typeof UserEventSchema>;

// ============================================
// IN-MEMORY EVENT STORE (for hackathon PoC)
// ============================================

class EventStore {
  private events = new Map<string, UserEvent[]>();

  /**
   * Log a user event.
   */
  async logEvent(
    userId: string,
    cityCode: string,
    type: UserEventType,
    payload?: Record<string, unknown>
  ): Promise<UserEvent> {
    const event: UserEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      cityCode,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };

    const userEvents = this.events.get(userId) || [];
    userEvents.push(event);
    this.events.set(userId, userEvents);

    console.log(`[memory] Event logged: ${type} for user ${userId.slice(0, 8)}...`);

    return event;
  }

  /**
   * List recent events for a user.
   */
  async listRecentEvents(userId: string, limit: number = 50): Promise<UserEvent[]> {
    const userEvents = this.events.get(userId) || [];
    return userEvents
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * List events by type for a user.
   */
  async listEventsByType(userId: string, type: UserEventType, limit: number = 20): Promise<UserEvent[]> {
    const userEvents = this.events.get(userId) || [];
    return userEvents
      .filter((e) => e.type === type)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Count events by type for a user.
   */
  async countEventsByType(userId: string, type: UserEventType): Promise<number> {
    const userEvents = this.events.get(userId) || [];
    return userEvents.filter((e) => e.type === type).length;
  }

  /**
   * Get event stats for a user.
   */
  async getEventStats(userId: string): Promise<Record<UserEventType, number>> {
    const userEvents = this.events.get(userId) || [];
    const stats: Partial<Record<UserEventType, number>> = {};

    for (const event of userEvents) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }

    return stats as Record<UserEventType, number>;
  }

  /**
   * Clear all events for a user.
   */
  async clearEvents(userId: string): Promise<void> {
    this.events.delete(userId);
  }

  /**
   * Get total event count.
   */
  getTotalEventCount(): number {
    let count = 0;
    for (const events of this.events.values()) {
      count += events.length;
    }
    return count;
  }
}

// Singleton instance
export const eventStore = new EventStore();

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

export async function logEvent(
  userId: string,
  cityCode: string,
  type: UserEventType,
  payload?: Record<string, unknown>
): Promise<UserEvent> {
  return eventStore.logEvent(userId, cityCode, type, payload);
}

export async function listRecentEvents(userId: string, limit: number = 50): Promise<UserEvent[]> {
  return eventStore.listRecentEvents(userId, limit);
}
