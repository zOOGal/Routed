/**
 * USER PROFILE STORAGE
 *
 * Manages user profile persistence for anonymous users.
 * Works with in-memory storage for development.
 */

import { randomUUID } from "crypto";
import type { UserProfile as DBUserProfile } from "@shared/schema";

// Default preferences for new users (matches packages/core/memory/types.ts)
export const DEFAULT_PROFILE_PREFS = {
  walkingToleranceMin: 15,  // Minutes - user's comfortable walking threshold
  walkingToleranceMax: 30,
  transferTolerance: 0.5,   // 0 = avoid transfers, 1 = don't mind
  calmQuickBias: 0,         // -1 = prefer calm, +1 = prefer fast (speedBias)
  costComfortBias: 0,       // -1 = prefer cheap, +1 = prefer comfort (comfortBias)
  outdoorBias: 0,
  replanSensitivity: 0.5,
};

// Profile event types
export type ProfileEventType =
  | "plan_generated"
  | "plan_accepted"
  | "plan_rejected"
  | "plan_declined"
  | "trip_started"
  | "trip_completed"
  | "trip_abandoned"
  | "route_override"
  | "chose_faster_option"
  | "chose_calmer_option"
  | "chose_cheaper_option"
  | "chose_comfort_option"
  | "step_completed"
  | "step_done"
  | "walked_more_than_expected"
  | "walked_less_than_expected"
  | "replan_shown"
  | "replan_accepted"
  | "replan_declined"
  | "opened_system_map"
  | "requested_in_app_ride"
  | "city_switch_suggested"
  | "city_switch_accepted"
  | "city_switch_declined"
  | "note_added";

export interface ProfileEvent {
  id: string;
  userId: string;
  type: ProfileEventType;
  payloadJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface UserProfileData {
  userId: string;
  prefsJson: typeof DEFAULT_PROFILE_PREFS;
  cityFamiliarityJson: Record<string, number>;
  totalTrips: number;
  lastTripAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// IN-MEMORY PROFILE STORAGE
// ============================================

class ProfileStorage {
  private profiles = new Map<string, UserProfileData>();
  private events = new Map<string, ProfileEvent>();

  /**
   * Get or create a user profile.
   */
  async getOrCreateProfile(userId: string): Promise<UserProfileData> {
    let profile = this.profiles.get(userId);

    if (!profile) {
      const now = new Date();
      profile = {
        userId,
        prefsJson: { ...DEFAULT_PROFILE_PREFS },
        cityFamiliarityJson: {},
        totalTrips: 0,
        lastTripAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.profiles.set(userId, profile);
      console.log(`[profile-storage] Created profile for user ${userId.slice(0, 8)}...`);
    }

    return profile;
  }

  /**
   * Get a user profile (returns undefined if not exists).
   */
  async getProfile(userId: string): Promise<UserProfileData | undefined> {
    return this.profiles.get(userId);
  }

  /**
   * Update a user profile.
   */
  async updateProfile(
    userId: string,
    updates: Partial<Pick<UserProfileData, "prefsJson" | "cityFamiliarityJson" | "totalTrips" | "lastTripAt">>
  ): Promise<UserProfileData> {
    const profile = await this.getOrCreateProfile(userId);

    const updated: UserProfileData = {
      ...profile,
      ...updates,
      updatedAt: new Date(),
    };

    this.profiles.set(userId, updated);
    return updated;
  }

  /**
   * Record a profile event.
   */
  async recordEvent(
    userId: string,
    type: ProfileEventType,
    payload?: Record<string, unknown>
  ): Promise<ProfileEvent> {
    const event: ProfileEvent = {
      id: randomUUID(),
      userId,
      type,
      payloadJson: payload || null,
      createdAt: new Date(),
    };

    this.events.set(event.id, event);
    return event;
  }

  /**
   * Get recent events for a user.
   */
  async getRecentEvents(userId: string, limit: number = 20): Promise<ProfileEvent[]> {
    return Array.from(this.events.values())
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * Get all profiles (for debugging).
   */
  async getAllProfiles(): Promise<UserProfileData[]> {
    return Array.from(this.profiles.values());
  }

  /**
   * Get profile count (for debugging).
   */
  getProfileCount(): number {
    return this.profiles.size;
  }

  /**
   * Get event count (for debugging).
   */
  getEventCount(): number {
    return this.events.size;
  }
}

// Singleton instance
export const profileStorage = new ProfileStorage();

// ============================================
// PROFILE HELPERS
// ============================================

/**
 * Convert profile data to the format expected by orchestrator.
 */
export function profileToOrchestratorFormat(profile: UserProfileData) {
  return {
    prefs: profile.prefsJson,
    cityFamiliarity: profile.cityFamiliarityJson,
    totalTrips: profile.totalTrips,
  };
}

/**
 * Apply learning event to profile (integration with core memory module).
 * Note: For now, this is a placeholder that just records the event.
 * Full learning integration requires wiring up the core/memory module.
 */
export async function applyLearningEvent(
  userId: string,
  eventType: ProfileEventType,
  payload?: Record<string, unknown>
): Promise<UserProfileData> {
  // Get current profile
  const profile = await profileStorage.getOrCreateProfile(userId);

  // Record event
  await profileStorage.recordEvent(userId, eventType, payload);

  // Apply basic learning rules (simplified version)
  const updates: Partial<Pick<UserProfileData, "prefsJson" | "totalTrips" | "cityFamiliarityJson">> = {};
  const prefs = { ...profile.prefsJson };
  let modified = false;

  // Learning deltas (small adjustments)
  const DELTA_SMALL = 0.02;
  const DELTA_MEDIUM = 0.05;

  switch (eventType) {
    case "trip_completed":
      updates.totalTrips = profile.totalTrips + 1;
      // Increase city familiarity
      if (payload?.cityCode) {
        const city = payload.cityCode as string;
        const currentFamiliarity = profile.cityFamiliarityJson[city] || 0.1;
        updates.cityFamiliarityJson = {
          ...profile.cityFamiliarityJson,
          [city]: Math.min(1, currentFamiliarity + DELTA_MEDIUM),
        };
      }
      break;

    case "chose_faster_option":
      prefs.calmQuickBias = Math.min(1, prefs.calmQuickBias + DELTA_SMALL);
      modified = true;
      break;

    case "chose_calmer_option":
      prefs.calmQuickBias = Math.max(-1, prefs.calmQuickBias - DELTA_SMALL);
      modified = true;
      break;

    case "chose_cheaper_option":
      prefs.costComfortBias = Math.max(-1, prefs.costComfortBias - DELTA_SMALL);
      modified = true;
      break;

    case "chose_comfort_option":
      prefs.costComfortBias = Math.min(1, prefs.costComfortBias + DELTA_SMALL);
      modified = true;
      break;

    case "walked_more_than_expected":
      // User walked more than expected, increase walking tolerance
      prefs.walkingToleranceMax = Math.min(60, prefs.walkingToleranceMax + 1);
      modified = true;
      break;

    case "walked_less_than_expected":
      // User walked less than expected, decrease walking tolerance
      prefs.walkingToleranceMax = Math.max(10, prefs.walkingToleranceMax - 1);
      modified = true;
      break;

    case "requested_in_app_ride":
      // Requesting ride signals comfort preference and lower walking tolerance
      prefs.costComfortBias = Math.min(1, prefs.costComfortBias + 0.08);
      prefs.walkingToleranceMin = Math.max(5, prefs.walkingToleranceMin - 1);
      modified = true;
      break;

    case "plan_rejected":
      // Plan rejected - if had many transfers, decrease transfer tolerance
      const transfers = (payload?.transfers as number) || 0;
      if (transfers >= 2) {
        prefs.transferTolerance = Math.max(0, prefs.transferTolerance - 0.05);
        modified = true;
      }
      break;

    case "plan_accepted":
      // Plan accepted with urgent intent -> increase speedBias
      const intent = payload?.tripIntent as string;
      if (intent === "time_sensitive" || intent === "work") {
        prefs.calmQuickBias = Math.min(1, prefs.calmQuickBias + 0.05);
        modified = true;
      }
      break;

    case "step_completed":
      // If step was walk and duration >= 10min, increase walking tolerance
      if (payload?.stepType === "walk") {
        const duration = (payload?.expectedDurationMin as number) || 0;
        if (duration >= 10) {
          prefs.walkingToleranceMin = Math.min(60, prefs.walkingToleranceMin + 1);
          modified = true;
        }
      }
      break;

    case "opened_system_map":
      // Using system map might indicate unfamiliarity or interest in transit
      break;
  }

  if (modified) {
    updates.prefsJson = prefs;
  }

  // Update storage if there are changes
  if (Object.keys(updates).length > 0) {
    return profileStorage.updateProfile(userId, updates);
  }

  return profile;
}
