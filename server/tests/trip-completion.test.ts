/**
 * TRIP COMPLETION TESTS
 *
 * Tests that completing a trip properly increments tripsCompleted
 * and updates the profile.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  profileStorage,
  applyLearningEvent,
  DEFAULT_PROFILE_PREFS,
} from "../profile-storage";

describe("Trip Completion", () => {
  describe("applyLearningEvent trip_completed", () => {
    it("should increment totalTrips when trip is completed", async () => {
      const userId = `test-trip-${Date.now()}-1`;

      // Create profile
      const initialProfile = await profileStorage.getOrCreateProfile(userId);
      expect(initialProfile.totalTrips).toBe(0);

      // Complete a trip
      await applyLearningEvent(userId, "trip_completed", {
        cityCode: "london",
      });

      // Check profile was updated
      const updatedProfile = await profileStorage.getOrCreateProfile(userId);
      expect(updatedProfile.totalTrips).toBe(1);
    });

    it("should increment totalTrips multiple times", async () => {
      const userId = `test-trip-${Date.now()}-2`;

      // Create profile
      await profileStorage.getOrCreateProfile(userId);

      // Complete 3 trips
      await applyLearningEvent(userId, "trip_completed", { cityCode: "london" });
      await applyLearningEvent(userId, "trip_completed", { cityCode: "london" });
      await applyLearningEvent(userId, "trip_completed", { cityCode: "berlin" });

      // Check profile was updated
      const profile = await profileStorage.getOrCreateProfile(userId);
      expect(profile.totalTrips).toBe(3);
    });

    it("should update city familiarity on trip completion", async () => {
      const userId = `test-trip-${Date.now()}-3`;

      // Create profile
      const initialProfile = await profileStorage.getOrCreateProfile(userId);
      expect(initialProfile.cityFamiliarityJson).toEqual({});

      // Complete a trip in London
      await applyLearningEvent(userId, "trip_completed", {
        cityCode: "london",
      });

      // Check city familiarity was updated
      const profile = await profileStorage.getOrCreateProfile(userId);
      expect(profile.cityFamiliarityJson.london).toBeGreaterThan(0);
    });

    it("should accumulate city familiarity over multiple trips", async () => {
      const userId = `test-trip-${Date.now()}-4`;

      // Create profile
      await profileStorage.getOrCreateProfile(userId);

      // Complete 3 trips in London
      await applyLearningEvent(userId, "trip_completed", { cityCode: "london" });
      const after1 = await profileStorage.getOrCreateProfile(userId);
      const familiarity1 = after1.cityFamiliarityJson.london;

      await applyLearningEvent(userId, "trip_completed", { cityCode: "london" });
      const after2 = await profileStorage.getOrCreateProfile(userId);
      const familiarity2 = after2.cityFamiliarityJson.london;

      await applyLearningEvent(userId, "trip_completed", { cityCode: "london" });
      const after3 = await profileStorage.getOrCreateProfile(userId);
      const familiarity3 = after3.cityFamiliarityJson.london;

      // Familiarity should increase with each trip
      expect(familiarity2).toBeGreaterThan(familiarity1);
      expect(familiarity3).toBeGreaterThan(familiarity2);
    });

    it("should clamp city familiarity to max 1.0", async () => {
      const userId = `test-trip-${Date.now()}-5`;

      // Create profile
      await profileStorage.getOrCreateProfile(userId);

      // Complete many trips to try to exceed 1.0
      for (let i = 0; i < 50; i++) {
        await applyLearningEvent(userId, "trip_completed", { cityCode: "tokyo" });
      }

      // Check familiarity is clamped
      const profile = await profileStorage.getOrCreateProfile(userId);
      expect(profile.cityFamiliarityJson.tokyo).toBeLessThanOrEqual(1.0);
    });
  });

  describe("Profile persistence", () => {
    it("should persist profile across getOrCreateProfile calls", async () => {
      const userId = `test-persist-${Date.now()}`;

      // Create profile and complete trip
      await profileStorage.getOrCreateProfile(userId);
      await applyLearningEvent(userId, "trip_completed", { cityCode: "nyc" });

      // Get profile again (simulating refresh)
      const profile1 = await profileStorage.getOrCreateProfile(userId);
      expect(profile1.totalTrips).toBe(1);

      // Get profile a third time
      const profile2 = await profileStorage.getOrCreateProfile(userId);
      expect(profile2.totalTrips).toBe(1);
      expect(profile2.userId).toBe(userId);
    });
  });

  describe("User authorization", () => {
    it("should not allow completing another user's trip (simulated)", async () => {
      // This is a simulation - the actual HTTP test would be in an integration test
      const user1 = `test-auth-${Date.now()}-1`;
      const user2 = `test-auth-${Date.now()}-2`;

      // User 1 creates profile
      await profileStorage.getOrCreateProfile(user1);

      // User 1 completes trip
      await applyLearningEvent(user1, "trip_completed", { cityCode: "london" });

      // Check only user1's profile was updated
      const profile1 = await profileStorage.getOrCreateProfile(user1);
      const profile2 = await profileStorage.getOrCreateProfile(user2);

      expect(profile1.totalTrips).toBe(1);
      expect(profile2.totalTrips).toBe(0);
    });
  });

  describe("Default preferences", () => {
    it("should use correct default walkingToleranceMin of 15", async () => {
      const userId = `test-defaults-${Date.now()}`;

      const profile = await profileStorage.getOrCreateProfile(userId);
      expect(profile.prefsJson.walkingToleranceMin).toBe(15);
    });

    it("should match DEFAULT_PROFILE_PREFS", async () => {
      const userId = `test-defaults2-${Date.now()}`;

      const profile = await profileStorage.getOrCreateProfile(userId);
      expect(profile.prefsJson).toEqual(DEFAULT_PROFILE_PREFS);
    });
  });
});
