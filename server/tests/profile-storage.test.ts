/**
 * PROFILE STORAGE TESTS
 *
 * Tests for in-memory profile persistence.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  profileStorage,
  DEFAULT_PROFILE_PREFS,
  profileToOrchestratorFormat,
  applyLearningEvent,
} from "../profile-storage";

// Note: profileStorage is a singleton, so we need to be careful about test isolation.
// For now, we use unique userIds per test.

describe("Profile Storage", () => {
  describe("getOrCreateProfile", () => {
    it("should create a new profile for new user", async () => {
      const userId = `test-user-${Date.now()}-1`;
      const profile = await profileStorage.getOrCreateProfile(userId);

      expect(profile.userId).toBe(userId);
      expect(profile.prefsJson).toEqual(DEFAULT_PROFILE_PREFS);
      expect(profile.cityFamiliarityJson).toEqual({});
      expect(profile.totalTrips).toBe(0);
      expect(profile.lastTripAt).toBeNull();
      expect(profile.createdAt).toBeInstanceOf(Date);
      expect(profile.updatedAt).toBeInstanceOf(Date);
    });

    it("should return existing profile for known user", async () => {
      const userId = `test-user-${Date.now()}-2`;

      // Create profile
      const profile1 = await profileStorage.getOrCreateProfile(userId);

      // Get same profile again
      const profile2 = await profileStorage.getOrCreateProfile(userId);

      expect(profile2.userId).toBe(userId);
      expect(profile2.createdAt).toEqual(profile1.createdAt);
    });
  });

  describe("getProfile", () => {
    it("should return undefined for unknown user", async () => {
      const profile = await profileStorage.getProfile("nonexistent-user");
      expect(profile).toBeUndefined();
    });

    it("should return profile for existing user", async () => {
      const userId = `test-user-${Date.now()}-3`;
      await profileStorage.getOrCreateProfile(userId);

      const profile = await profileStorage.getProfile(userId);
      expect(profile).toBeDefined();
      expect(profile?.userId).toBe(userId);
    });
  });

  describe("updateProfile", () => {
    it("should update profile preferences", async () => {
      const userId = `test-user-${Date.now()}-4`;
      await profileStorage.getOrCreateProfile(userId);

      const updated = await profileStorage.updateProfile(userId, {
        prefsJson: {
          ...DEFAULT_PROFILE_PREFS,
          calmQuickBias: 0.5,
        },
      });

      expect(updated.prefsJson.calmQuickBias).toBe(0.5);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        updated.createdAt.getTime()
      );
    });

    it("should update city familiarity", async () => {
      const userId = `test-user-${Date.now()}-5`;
      await profileStorage.getOrCreateProfile(userId);

      const updated = await profileStorage.updateProfile(userId, {
        cityFamiliarityJson: { london: 0.7, paris: 0.3 },
      });

      expect(updated.cityFamiliarityJson).toEqual({ london: 0.7, paris: 0.3 });
    });

    it("should update total trips", async () => {
      const userId = `test-user-${Date.now()}-6`;
      await profileStorage.getOrCreateProfile(userId);

      const updated = await profileStorage.updateProfile(userId, {
        totalTrips: 5,
      });

      expect(updated.totalTrips).toBe(5);
    });
  });

  describe("recordEvent", () => {
    it("should record a profile event", async () => {
      const userId = `test-user-${Date.now()}-7`;

      const event = await profileStorage.recordEvent(userId, "trip_completed", {
        cityCode: "london",
      });

      expect(event.id).toBeDefined();
      expect(event.userId).toBe(userId);
      expect(event.type).toBe("trip_completed");
      expect(event.payloadJson).toEqual({ cityCode: "london" });
      expect(event.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("getRecentEvents", () => {
    it("should return recent events sorted by date", async () => {
      const userId = `test-user-${Date.now()}-8`;

      // Record multiple events with small delays to ensure different timestamps
      await profileStorage.recordEvent(userId, "trip_started");
      await new Promise((resolve) => setTimeout(resolve, 5));
      await profileStorage.recordEvent(userId, "step_completed");
      await new Promise((resolve) => setTimeout(resolve, 5));
      await profileStorage.recordEvent(userId, "trip_completed");

      const events = await profileStorage.getRecentEvents(userId, 10);

      expect(events.length).toBe(3);
      // Should be sorted newest first
      expect(events[0].type).toBe("trip_completed");
      expect(events[2].type).toBe("trip_started");
    });

    it("should respect limit", async () => {
      const userId = `test-user-${Date.now()}-9`;

      for (let i = 0; i < 10; i++) {
        await profileStorage.recordEvent(userId, "step_completed");
      }

      const events = await profileStorage.getRecentEvents(userId, 5);
      expect(events.length).toBe(5);
    });
  });

  describe("profileToOrchestratorFormat", () => {
    it("should convert profile to orchestrator format", async () => {
      const userId = `test-user-${Date.now()}-10`;
      const profile = await profileStorage.getOrCreateProfile(userId);

      const orchestratorFormat = profileToOrchestratorFormat(profile);

      expect(orchestratorFormat).toEqual({
        prefs: profile.prefsJson,
        cityFamiliarity: profile.cityFamiliarityJson,
        totalTrips: profile.totalTrips,
      });
    });
  });

  describe("applyLearningEvent", () => {
    it("should increment totalTrips on trip_completed", async () => {
      const userId = `test-user-${Date.now()}-11`;
      await profileStorage.getOrCreateProfile(userId);

      const updated = await applyLearningEvent(userId, "trip_completed", {
        cityCode: "london",
      });

      expect(updated.totalTrips).toBe(1);
    });

    it("should increase city familiarity on trip_completed", async () => {
      const userId = `test-user-${Date.now()}-12`;
      await profileStorage.getOrCreateProfile(userId);

      const updated = await applyLearningEvent(userId, "trip_completed", {
        cityCode: "paris",
      });

      expect(updated.cityFamiliarityJson.paris).toBeGreaterThan(0);
    });

    it("should shift calmQuickBias towards fast on chose_faster_option", async () => {
      const userId = `test-user-${Date.now()}-13`;
      const initial = await profileStorage.getOrCreateProfile(userId);
      const initialBias = initial.prefsJson.calmQuickBias;

      const updated = await applyLearningEvent(userId, "chose_faster_option");

      expect(updated.prefsJson.calmQuickBias).toBeGreaterThan(initialBias);
    });

    it("should shift calmQuickBias towards calm on chose_calmer_option", async () => {
      const userId = `test-user-${Date.now()}-14`;
      const initial = await profileStorage.getOrCreateProfile(userId);
      const initialBias = initial.prefsJson.calmQuickBias;

      const updated = await applyLearningEvent(userId, "chose_calmer_option");

      expect(updated.prefsJson.calmQuickBias).toBeLessThan(initialBias);
    });

    it("should shift costComfortBias towards cost on chose_cheaper_option", async () => {
      const userId = `test-user-${Date.now()}-15`;
      const initial = await profileStorage.getOrCreateProfile(userId);
      const initialBias = initial.prefsJson.costComfortBias;

      const updated = await applyLearningEvent(userId, "chose_cheaper_option");

      expect(updated.prefsJson.costComfortBias).toBeLessThan(initialBias);
    });

    it("should increase walkingToleranceMax on walked_more_than_expected", async () => {
      const userId = `test-user-${Date.now()}-16`;
      const initial = await profileStorage.getOrCreateProfile(userId);
      const initialTolerance = initial.prefsJson.walkingToleranceMax;

      const updated = await applyLearningEvent(
        userId,
        "walked_more_than_expected"
      );

      expect(updated.prefsJson.walkingToleranceMax).toBeGreaterThan(
        initialTolerance
      );
    });
  });
});
