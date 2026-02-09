import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getRecommendationWithDepth, replanTrip } from "./agent-service";
import { getCityProfile, getAllCities } from "./city-intelligence";
import { getPlaceAutocomplete, getDirections, type TravelMode } from "./google-maps-service";
import { applyEventToPreferences } from "./memory";
import {
  runSanityGate,
  validateFinalOutput,
  resolvePlace,
  detectCityMismatch,
} from "./context-sanity";
import { getWeather, type WeatherData } from "./weather-service";
import { orchestrate, createSkillContext, type OrchestratorConfig } from "../packages/core/orchestrator";
import { createGeminiClient, createNullLLMClient } from "../packages/core/llm/client";
import type { RouteCandidate } from "../packages/core/skills/scoreCandidates.skill";
import type { AgentRequest, TripIntent, UserEventType, CityProfile } from "@shared/schema";
import { buildMobilityPlan, getActivationChecklist } from "./mobility-plan-builder";
import type { CityCode } from "../packages/core/mobility/types";
import { buildEntitlementSet } from "../packages/core/entitlements/engine";
import { getProvidersForCity } from "../packages/providers/catalog";
import { getQuotes, QuoteRequestSchema, type QuoteRequest } from "./quotes";
import { getUserId, setUserIdCookie } from "./user-identity";
import { profileStorage, profileToOrchestratorFormat, applyLearningEvent } from "./profile-storage";
import { logEvent, listRecentEvents, type UserEventType as MemoryEventType } from "../packages/core/memory";
import {
  registerUser,
  loginUser,
  getUserById,
  getSafeUserData,
  linkAnonymousProfile,
} from "./auth-service";
import {
  extractMemoriesFromNote,
  recordTripEpisode,
  getUserMemorySummary,
  deleteMemory,
  getRelevantMemories,
  getDetourSuggestions,
  checkHealth as checkMemoryHealth,
} from "./memory-assistant-service";

/**
 * Get user ID from request (cookie-based, falls back to generating new one).
 */
function getRequestUserId(req: Request): string {
  try {
    return getUserId(req);
  } catch {
    // Fallback: this shouldn't happen if middleware is working
    console.warn("[routes] getUserId failed, generating fallback userId");
    return `fallback-${Date.now()}`;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ============ AGENT ROUTES ============
  
  app.post("/api/agent/recommend", async (req, res) => {
    try {
      const { origin, destination, cityId, departureTime, calmVsFast, economyVsComfort, unfamiliarWithCity, mood, userNote, intent } = req.body;

      console.log("=== /api/agent/recommend called ===");
      console.log("Request body:", { origin, destination, cityId });

      if (!origin || !destination || !cityId) {
        return res.status(400).json({ error: "Missing required fields: origin, destination, cityId" });
      }

      // ============================================
      // CONTEXT SANITY GATE — Block mismatched cities
      // ============================================
      console.log("[Sanity Gate] Running context sanity checks...");
      const sanityResult = runSanityGate(cityId, origin, destination);

      if (!sanityResult.passed) {
        console.log("[Sanity Gate] BLOCKED - City mismatch detected");
        console.log("[Sanity Gate] Reason:", sanityResult.blockReason);

        const cityProfile = getCityProfile(cityId);
        return res.status(400).json({
          error: "city_mismatch",
          message: sanityResult.blockReason,
          mismatch: {
            detected: true,
            selectedCity: cityProfile?.name || cityId,
            suggestedCityCode: sanityResult.mismatch?.suggestedCityCode,
            suggestedCityName: sanityResult.mismatch?.suggestedCityName,
            confidence: sanityResult.mismatch?.confidence,
            origin: {
              query: origin,
              inferredCity: sanityResult.mismatch?.origin.inferredCityName,
              confidence: sanityResult.mismatch?.origin.confidence,
            },
            destination: {
              query: destination,
              inferredCity: sanityResult.mismatch?.destination.inferredCityName,
              confidence: sanityResult.mismatch?.destination.confidence,
            },
          },
        });
      }
      console.log("[Sanity Gate] PASSED - Proceeding with recommendation");

      const userId = getRequestUserId(req);

      const request: AgentRequest = {
        origin,
        destination,
        cityId,
        departureTime,
        userId,
        mood,
        intent: (intent as TripIntent) || "leisure",
        calmVsFast,
        economyVsComfort,
        unfamiliarWithCity,
        userNote,
      };

      const { recommendation, depthLayer, detourMeta } = await getRecommendationWithDepth(request);

      // ============================================
      // OUTPUT VALIDATION — Ensure no wrong transit names
      // ============================================
      const outputValidation = validateFinalOutput(cityId, recommendation);
      if (!outputValidation.valid) {
        console.warn("[Output Validation] Transit naming violations:", outputValidation.violations);
        // Don't block, but log the violation for debugging
      }

      const trip = await storage.createTrip({
        userId,
        cityId,
        originName: origin,
        destinationName: destination,
        intent: request.intent,
        userNote: userNote || null,
        status: "planned",
        recommendation,
        reasoning: recommendation.reasoning,
        steps: recommendation.steps,
        estimatedDuration: recommendation.estimatedDuration,
        stressScore: recommendation.stressScore,
        depthLayer,
      });

      // Extract semantic memories from user note (non-blocking)
      if (userNote?.trim()) {
        extractMemoriesFromNote(userId, userNote, { cityId, intent: request.intent }).catch((e) =>
          console.warn("[recommend] Memory extraction failed:", e)
        );
      }

      res.json({ recommendation, depthLayer, tripId: trip.id, detourMeta });
    } catch (error) {
      console.error("Agent recommendation error:", error);
      res.status(500).json({ error: "Failed to get recommendation" });
    }
  });

  // ============ V2 SKILL-BASED ORCHESTRATOR ============

  app.post("/api/v2/recommend", async (req, res) => {
    try {
      const {
        origin,
        destination,
        cityId,
        intent,
        userNote,
        calmVsFast,
        economyVsComfort,
      } = req.body;

      console.log("=== /api/v2/recommend (skill orchestrator) ===");
      console.log("Request:", { origin, destination, cityId, intent });

      if (!destination || !cityId) {
        return res.status(400).json({
          error: "Missing required fields: destination, cityId",
        });
      }

      // Create skill context
      const isDebugMode = process.env.NODE_ENV === "development" || req.query.debug === "true";
      const config: OrchestratorConfig = {
        debugMode: isDebugMode,
        useLLM: true, // Enable LLM for depth layer
        mockExternalCalls: false,
      };

      // Create LLM client (will check env var internally)
      const llmClient = createGeminiClient();

      // Log LLM availability on startup
      if (isDebugMode) {
        const llmAvailable = llmClient.isAvailable();
        console.log(`[v2/recommend] LLM available: ${llmAvailable}`);
        if (!llmAvailable) {
          console.log(`[v2/recommend] LLM fallback reason: API key not configured (AI_INTEGRATIONS_GEMINI_API_KEY)`);
        }
      }

      const ctx = createSkillContext(config, {
        getCityProfile: (cityCode: string): CityProfile | null => {
          return getCityProfile(cityCode) || null;
        },
        getWeather: async (code: string): Promise<WeatherData> => {
          const w = await getWeather(code);
          if (!w) {
            // Return default weather if not available
            return {
              temperature: 20,
              condition: "clear",
              description: "Clear sky",
              feelsLike: 20,
              humidity: 50,
              windSpeed: 10,
              isOutdoorFriendly: true,
              advice: "Great weather for traveling.",
            };
          }
          return w;
        },
        getVenueInfo: async () => null, // Not implemented yet
        llm: llmClient,
      });

      // Route candidate provider using Google Maps
      const getRouteCandidates = async (
        originText: string | null,
        destText: string,
        city: string
      ): Promise<RouteCandidate[]> => {
        const cityProfile = getCityProfile(city);
        if (!cityProfile) return [];

        const originQuery = originText || destText;
        const candidates: RouteCandidate[] = [];

        // Fetch transit route
        try {
          const transitRoute = await getDirections(
            originQuery,
            destText,
            "transit" as TravelMode
          );

          if (transitRoute) {
            const transitSteps = transitRoute.steps.filter((s) => s.travelMode === "TRANSIT");
            const walkSteps = transitRoute.steps.filter((s) => s.travelMode === "WALKING");

            candidates.push({
              id: "transit-0",
              mode: "transit",
              durationMinutes: Math.ceil(transitRoute.duration.value / 60),
              walkingMinutes: walkSteps.reduce(
                (sum, s) => sum + Math.ceil(s.duration.value / 60),
                0
              ),
              transferCount: Math.max(0, transitSteps.length - 1),
              hasUnderground: transitSteps.some(
                (s) =>
                  s.transitDetails?.line?.vehicle?.type === "SUBWAY" ||
                  s.transitDetails?.line?.vehicle?.type === "METRO"
              ),
              isOutdoorRoute: false,
              estimatedCost: 2.9, // Default transit fare
              steps: transitRoute.steps.map((s) => ({
                type:
                  s.travelMode === "WALKING"
                    ? ("walk" as const)
                    : ("transit" as const),
                duration: Math.ceil(s.duration.value / 60),
                distance: s.distance.value,
                line: s.transitDetails?.line?.shortName,
              })),
            });
          }
        } catch (e) {
          console.warn("Transit route fetch failed:", e);
        }

        // Fetch walking route
        try {
          const walkRoute = await getDirections(
            originQuery,
            destText,
            "walking" as TravelMode
          );

          if (walkRoute) {
            const durationMin = Math.ceil(walkRoute.duration.value / 60);

            // Only include walking if reasonable (<45 min)
            if (durationMin <= 45) {
              candidates.push({
                id: "walking",
                mode: "walking",
                durationMinutes: durationMin,
                walkingMinutes: durationMin,
                transferCount: 0,
                hasUnderground: false,
                isOutdoorRoute: true,
                estimatedCost: 0,
                steps: [
                  {
                    type: "walk" as const,
                    duration: durationMin,
                    distance: walkRoute.distance.value,
                  },
                ],
              });
            }
          }
        } catch (e) {
          console.warn("Walking route fetch failed:", e);
        }

        return candidates;
      };

      // Load user profile for personalized routing
      const userId = getRequestUserId(req);
      const profile = await profileStorage.getOrCreateProfile(userId);
      const profileForOrchestrator = profileToOrchestratorFormat(profile);

      // Run orchestrator with profile
      const result = await orchestrate(
        {
          selectedCityCode: cityId,
          originText: origin,
          destinationText: destination,
          tripIntent: intent as any,
          userNote,
          userPrefs: {
            calmVsFast,
            economyVsComfort,
          },
          userProfile: {
            prefs: profile.prefsJson,
            cityFamiliarity: profile.cityFamiliarityJson,
            totalTrips: profile.totalTrips,
          },
        },
        ctx,
        getRouteCandidates
      );

      // Log plan_generated event (for learning)
      if (result.type === "plan") {
        try {
          await logEvent(userId, cityId, "plan_generated", {
            mode: result.chosenPlan.mode,
            durationMin: result.chosenPlan.estimatedDuration,
            walkMin: result.steps.filter(s => s.type === "walk").reduce((sum, s) => sum + s.duration, 0),
            transfers: Math.max(0, result.steps.filter(s => s.type === "transit").length - 1),
            estimatedCost: result.chosenPlan.estimatedCost,
            archetype: result.chosenPlan.archetype,
          });
        } catch (e) {
          console.warn("[v2/recommend] Failed to log plan_generated event:", e);
        }
      }

      // Handle different result types
      if (result.type === "city_mismatch") {
        return res.status(400).json({
          error: "city_mismatch",
          message: result.message,
          mismatch: {
            detected: true,
            suggestedCityCode: result.suggestedCityCode,
            suggestedCityName: result.suggestedCityName,
            confidence: result.confidence,
          },
          debug: result.debug,
        });
      }

      if (result.type === "error") {
        return res.status(500).json({
          error: result.error,
          debug: result.debug,
        });
      }

      if (result.type === "no_routes") {
        return res.status(404).json({
          error: "no_routes",
          message: result.message,
          debug: result.debug,
        });
      }

      // Extract semantic memories from user note (non-blocking)
      if (userNote?.trim()) {
        extractMemoriesFromNote(userId, userNote, { cityId, intent }).catch((e) =>
          console.warn("[v2/recommend] Memory extraction failed:", e)
        );
      }

      // Success - return plan
      res.json({
        type: "plan",
        recommendation: {
          mode: result.chosenPlan.mode,
          summary: result.chosenPlan.summary,
          estimatedDuration: result.chosenPlan.estimatedDuration,
          estimatedCost: result.chosenPlan.estimatedCost,
          costDisplay: result.chosenPlan.costDisplay,
          confidence: result.chosenPlan.confidence,
          archetype: result.chosenPlan.archetype,
          steps: result.steps,
        },
        depthLayer: result.depthLayer,
        resolvedContext: result.resolvedContext,
        debug: result.debug,
      });
    } catch (error) {
      console.error("V2 recommend error:", error);
      res.status(500).json({ error: "Failed to get recommendation" });
    }
  });

  // ============ CITY ROUTES ============
  
  app.get("/api/cities", async (req, res) => {
    const cities = getAllCities();
    res.json(cities);
  });

  app.get("/api/cities/:id", async (req, res) => {
    const city = getCityProfile(req.params.id);
    if (!city) {
      return res.status(404).json({ error: "City not found" });
    }
    res.json(city);
  });

  // ============ AUTHENTICATION ============

  // Session storage for auth tokens (in-memory, hackathon-grade)
  const sessions = new Map<string, { userId: string; authUserId: string; expiresAt: Date }>();

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, displayName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const anonymousId = getRequestUserId(req);
      const result = await registerUser(email, password, displayName, anonymousId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Create session
      const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessions.set(sessionToken, {
        userId: anonymousId,
        authUserId: result.user!.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });

      // Set session cookie
      res.cookie("routed_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      res.json({
        success: true,
        user: getSafeUserData(result.user!),
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const result = await loginUser(email, password);

      if (!result.success) {
        return res.status(401).json({ error: result.error });
      }

      const anonymousId = getRequestUserId(req);

      // Link anonymous profile if user has one
      if (result.user!.anonymousId) {
        // User already has a linked profile, use that cookie
        setUserIdCookie(res, result.user!.anonymousId);
      } else {
        // Link current anonymous profile to this user
        linkAnonymousProfile(result.user!.id, anonymousId);
      }

      // Create session
      const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessions.set(sessionToken, {
        userId: result.user!.anonymousId || anonymousId,
        authUserId: result.user!.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      res.cookie("routed_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      res.json({
        success: true,
        user: getSafeUserData(result.user!),
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const sessionToken = req.cookies?.routed_session;
    if (sessionToken) {
      sessions.delete(sessionToken);
    }

    res.clearCookie("routed_session", { path: "/" });
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const sessionToken = req.cookies?.routed_session;

    if (!sessionToken) {
      return res.json({ authenticated: false, user: null });
    }

    const session = sessions.get(sessionToken);
    if (!session || session.expiresAt < new Date()) {
      sessions.delete(sessionToken);
      res.clearCookie("routed_session", { path: "/" });
      return res.json({ authenticated: false, user: null });
    }

    const user = getUserById(session.authUserId);
    if (!user) {
      return res.json({ authenticated: false, user: null });
    }

    res.json({
      authenticated: true,
      user: getSafeUserData(user),
    });
  });

  // ============ PLACES AUTOCOMPLETE ============

  app.get("/api/places/autocomplete", async (req, res) => {
    try {
      const { input, cityId } = req.query;

      if (!input || typeof input !== "string") {
        return res.json([]);
      }

      const suggestions = await getPlaceAutocomplete(
        input,
        typeof cityId === "string" ? cityId : undefined
      );

      res.json(suggestions);
    } catch (error) {
      console.error("Autocomplete error:", error);
      res.status(500).json({ error: "Failed to get suggestions" });
    }
  });

  // ============ USER PROFILE (Cookie-based) ============

  app.get("/api/user/profile", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const profile = await profileStorage.getOrCreateProfile(userId);

      // Prevent caching so profile always reflects latest data
      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
      res.set("Pragma", "no-cache");

      res.json({
        userId: profile.userId,
        prefs: profile.prefsJson,
        cityFamiliarity: profile.cityFamiliarityJson,
        totalTrips: profile.totalTrips,
        lastTripAt: profile.lastTripAt,
        createdAt: profile.createdAt,
      });
    } catch (error) {
      console.error("Profile fetch error:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.get("/api/user/profile/events", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const limit = parseInt(req.query.limit as string) || 20;
      const events = await profileStorage.getRecentEvents(userId, limit);
      res.json(events);
    } catch (error) {
      console.error("Profile events fetch error:", error);
      res.status(500).json({ error: "Failed to fetch profile events" });
    }
  });

  // ============ SEMANTIC MEMORIES (from memory-assistant) ============

  app.get("/api/user/memories", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const summary = await getUserMemorySummary(userId);

      if (!summary) {
        // User has no semantic memories yet - return empty state
        return res.json({
          hasMemories: false,
          total: 0,
          byType: {},
          recent: [],
          highlights: [],
          message: "No semantic memories yet. Add notes to your trips to help Routed learn about you!",
        });
      }

      res.json({
        hasMemories: true,
        ...summary,
      });
    } catch (error) {
      console.error("Memories fetch error:", error);
      res.status(500).json({ error: "Failed to fetch memories" });
    }
  });

  app.delete("/api/user/memories/:memoryId", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { memoryId } = req.params;

      const deleted = await deleteMemory(userId, memoryId);
      if (!deleted) {
        return res.status(404).json({ error: "Memory not found or already deleted" });
      }

      res.json({ success: true, deletedId: memoryId });
    } catch (error) {
      console.error("Memory delete error:", error);
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });

  app.get("/api/user/memories/search", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const type = req.query.type as string | undefined;

      const memories = await getRelevantMemories(userId, undefined, type);
      res.json({ memories });
    } catch (error) {
      console.error("Memories search error:", error);
      res.status(500).json({ error: "Failed to search memories" });
    }
  });

  // ============ USER ROUTES ============

  app.get("/api/users/preferences", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        walkingTolerance: user.walkingTolerance,
        transferTolerance: user.transferTolerance,
        stressVsSpeedBias: user.stressVsSpeedBias,
        costSensitivity: user.costSensitivity,
      });
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ error: "Failed to fetch preferences" });
    }
  });

  app.put("/api/users/preferences", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { walkingTolerance, transferTolerance, stressVsSpeedBias, costSensitivity } = req.body;
      
      const updated = await storage.updateUserPreferences(userId, {
        walkingTolerance,
        transferTolerance,
        stressVsSpeedBias,
        costSensitivity,
      });

      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        walkingTolerance: updated.walkingTolerance,
        transferTolerance: updated.transferTolerance,
        stressVsSpeedBias: updated.stressVsSpeedBias,
        costSensitivity: updated.costSensitivity,
      });
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  // ============ TRIP ROUTES ============
  
  app.get("/api/trips", async (req, res) => {
    try {
      const trips = await storage.getAllTrips();
      res.json(trips);
    } catch (error) {
      console.error("Error fetching trips:", error);
      res.status(500).json({ error: "Failed to fetch trips" });
    }
  });

  app.get("/api/trips/:id", async (req, res) => {
    try {
      const trip = await storage.getTrip(req.params.id);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }
      res.json(trip);
    } catch (error) {
      console.error("Error fetching trip:", error);
      res.status(500).json({ error: "Failed to fetch trip" });
    }
  });

  app.post("/api/trips/:id/start", async (req, res) => {
    try {
      const trip = await storage.updateTripStatus(req.params.id, "in_progress");
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const userId = trip.userId || getRequestUserId(req);
      const recommendation = trip.recommendation as any;
      const steps = trip.steps as any[] || [];

      // Log plan_accepted event (user chose to use this route)
      try {
        await logEvent(userId, trip.cityId, "plan_accepted", {
          planId: trip.id,
          mode: recommendation?.mode,
          durationMin: recommendation?.estimatedDuration,
          walkMin: steps.filter(s => s.type === "walk").reduce((sum: number, s: any) => sum + (s.duration || 0), 0),
          transfers: Math.max(0, steps.filter(s => s.type === "transit").length - 1),
          tripIntent: trip.intent,
        });

        // Apply learning from plan_accepted
        await applyLearningEvent(userId, "plan_accepted" as any, {
          tripIntent: trip.intent,
          cityCode: trip.cityId,
        });
      } catch (e) {
        console.warn("[trips/start] Failed to log plan_accepted event:", e);
      }

      // Legacy familiarity update
      if (trip.cityId) {
        const currentFamiliarity = await storage.getUserCityFamiliarity(userId, trip.cityId);
        const newScore = (currentFamiliarity?.familiarityScore || 0.2) + 0.05;
        await storage.updateUserCityFamiliarity(userId, trip.cityId, newScore);
      }

      res.json(trip);
    } catch (error) {
      console.error("Error starting trip:", error);
      res.status(500).json({ error: "Failed to start trip" });
    }
  });

  app.post("/api/trips/:id/step/complete", async (req, res) => {
    try {
      const trip = await storage.getTrip(req.params.id);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const currentStepIndex = trip.currentStepIndex || 0;
      const steps = trip.steps as any[] || [];
      const currentStep = steps[currentStepIndex];
      const nextStep = currentStepIndex + 1;
      const updated = await storage.updateTripStep(req.params.id, nextStep);

      // Get user ID (prefer trip.userId, fallback to request)
      const userId = trip.userId || getRequestUserId(req);

      // Log step_done event for learning (new memory system)
      try {
        await logEvent(userId, trip.cityId, "step_done" as MemoryEventType, {
          tripId: trip.id,
          stepIndex: currentStepIndex,
          stepType: currentStep?.type || "unknown",
          expectedDurationMin: currentStep?.duration,
          mode: currentStep?.type,
        });

        // Apply learning from step_done
        await applyLearningEvent(userId, "step_completed" as any, {
          stepType: currentStep?.type,
          expectedDurationMin: currentStep?.duration,
          cityCode: trip.cityId,
        });
      } catch (e) {
        console.warn("[step/complete] Failed to log step_done event:", e);
      }

      // Legacy event logging
      await storage.recordUserEvent({
        userId,
        tripId: trip.id,
        eventType: "step_completed",
        cityId: trip.cityId,
        context: {
          stepIndex: currentStepIndex,
          totalSteps: steps.length,
        },
      });

      // Check if trip is now complete
      if (nextStep >= steps.length) {
        // Update trip status to completed
        await storage.updateTripStatus(trip.id, "completed");

        // Get profile BEFORE update for logging
        const profileBefore = await profileStorage.getOrCreateProfile(userId);
        const tripsBefore = profileBefore.totalTrips;

        // Log trip_completed event (new memory system)
        try {
          await logEvent(userId, trip.cityId, "trip_completed", {
            tripId: trip.id,
            stepsCompleted: steps.length,
            mode: (trip.recommendation as any)?.mode,
          });

          // Apply learning - this MUST update totalTrips and cityFamiliarity
          await applyLearningEvent(userId, "trip_completed", {
            cityCode: trip.cityId,
          });
        } catch (e) {
          console.warn("[step/complete] Failed to log trip_completed event:", e);
        }

        // Get profile AFTER update
        const profileAfter = await profileStorage.getOrCreateProfile(userId);
        const tripsAfter = profileAfter.totalTrips;

        // Debug logging
        console.log(`[step/complete] TRIP COMPLETED userId=${userId.slice(0,8)}... tripId=${trip.id.slice(0,8)}... tripsBefore=${tripsBefore} tripsAfter=${tripsAfter}`);

        // Legacy event logging
        await storage.recordUserEvent({
          userId,
          tripId: trip.id,
          eventType: "trip_completed",
          cityId: trip.cityId,
          context: {},
        });

        // Update learned preferences (legacy)
        const currentPrefs = await storage.getLearnedPreferences(userId);
        const updatedPrefs = applyEventToPreferences(currentPrefs, {
          id: "",
          userId,
          tripId: trip.id,
          eventType: "trip_completed",
          cityId: trip.cityId,
          context: { cityId: trip.cityId },
          createdAt: new Date(),
        });
        await storage.updateLearnedPreferences(userId, updatedPrefs);

        // Return trip with profile update
        const completedTrip = await storage.getTrip(trip.id);
        return res.json({
          ...completedTrip,
          profileUpdated: true,
          profile: {
            totalTrips: profileAfter.totalTrips,
            cityFamiliarity: profileAfter.cityFamiliarityJson,
          },
        });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error completing step:", error);
      res.status(500).json({ error: "Failed to complete step" });
    }
  });

  // Explicit trip completion endpoint
  // This is the canonical way to complete a trip and update the profile
  app.post("/api/trips/:id/complete", async (req, res) => {
    try {
      const tripId = req.params.id;
      const userId = getRequestUserId(req);

      // Fetch trip
      const trip = await storage.getTrip(tripId);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      // Validate trip belongs to this user (or is unassigned)
      if (trip.userId && trip.userId !== userId) {
        console.warn(`[trip/complete] User ${userId.slice(0,8)} tried to complete trip ${tripId} owned by ${trip.userId?.slice(0,8)}`);
        return res.status(403).json({ error: "Not authorized to complete this trip" });
      }

      // Update trip status to completed
      const completedTrip = await storage.updateTripStatus(tripId, "completed");
      if (!completedTrip) {
        return res.status(500).json({ error: "Failed to update trip status" });
      }

      // Get current profile BEFORE update for logging
      const profileBefore = await profileStorage.getOrCreateProfile(userId);
      const tripsBefore = profileBefore.totalTrips;

      // Log trip_completed event
      await logEvent(userId, trip.cityId, "trip_completed", {
        tripId: trip.id,
        stepsCompleted: ((trip.steps as any[]) || []).length,
        mode: (trip.recommendation as any)?.mode,
      });

      // Apply learning - this MUST update totalTrips and cityFamiliarity
      await applyLearningEvent(userId, "trip_completed", {
        cityCode: trip.cityId,
      });

      // Get updated profile
      const profileAfter = await profileStorage.getOrCreateProfile(userId);
      const tripsAfter = profileAfter.totalTrips;

      // Debug logging
      console.log(`[trip/complete] userId=${userId.slice(0,8)}... tripId=${tripId.slice(0,8)}... tripsBefore=${tripsBefore} tripsAfter=${tripsAfter}`);

      // Legacy event logging
      await storage.recordUserEvent({
        userId,
        tripId: trip.id,
        eventType: "trip_completed",
        cityId: trip.cityId,
        context: {},
      });

      // Record trip episode to memory-assistant (non-blocking)
      recordTripEpisode(userId, {
        tripId: trip.id,
        cityId: trip.cityId,
        mode: (trip.recommendation as any)?.mode,
        userNote: trip.userNote,
        stepsCompleted: ((trip.steps as any[]) || []).length,
        success: true,
      }).catch((e) => console.warn("[trip/complete] Memory episode failed:", e));

      // Return updated profile along with trip
      res.json({
        success: true,
        trip: completedTrip,
        profile: {
          userId: profileAfter.userId,
          totalTrips: profileAfter.totalTrips,
          cityFamiliarity: profileAfter.cityFamiliarityJson,
          prefs: profileAfter.prefsJson,
        },
      });
    } catch (error) {
      console.error("Error completing trip:", error);
      res.status(500).json({ error: "Failed to complete trip" });
    }
  });

  app.post("/api/trips/:id/cancel", async (req, res) => {
    try {
      const trip = await storage.updateTripStatus(req.params.id, "cancelled");
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      if (trip.userId) {
        // Record both legacy behavioral signal and new user event
        await storage.recordBehavioralSignal({
          userId: trip.userId,
          signalType: "abandonment",
          routeType: (trip.recommendation as any)?.mode,
          cityId: trip.cityId,
          context: { stepIndex: trip.currentStepIndex },
        });

        await storage.recordUserEvent({
          userId: trip.userId,
          tripId: trip.id,
          eventType: "abandoned_trip",
          cityId: trip.cityId,
          context: {
            stepIndex: trip.currentStepIndex,
            routeMode: (trip.recommendation as any)?.mode,
          },
        });

        // Update learned preferences
        const currentPrefs = await storage.getLearnedPreferences(trip.userId);
        const updatedPrefs = applyEventToPreferences(currentPrefs, {
          id: "",
          userId: trip.userId,
          tripId: trip.id,
          eventType: "abandoned_trip",
          cityId: trip.cityId,
          context: { cityId: trip.cityId },
          createdAt: new Date(),
        });
        await storage.updateLearnedPreferences(trip.userId, updatedPrefs);
      }

      res.json(trip);
    } catch (error) {
      console.error("Error cancelling trip:", error);
      res.status(500).json({ error: "Failed to cancel trip" });
    }
  });

  app.post("/api/trips/:id/replan", async (req, res) => {
    try {
      const trip = await storage.getTrip(req.params.id);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const newRecommendation = await replanTrip(req.params.id, "user_request");
      if (!newRecommendation) {
        return res.status(500).json({ error: "Failed to replan trip" });
      }

      const updated = await storage.updateTripRecommendation(req.params.id, newRecommendation);
      res.json(updated);
    } catch (error) {
      console.error("Error replanning trip:", error);
      res.status(500).json({ error: "Failed to replan trip" });
    }
  });

  // ============ PACKAGE ROUTES ============

  app.get("/api/packages", async (req, res) => {
    try {
      const cityId = req.query.cityId as string | undefined;
      const packages = await storage.getPackages(cityId);
      res.json(packages);
    } catch (error) {
      console.error("Packages fetch error:", error);
      res.status(500).json({ error: "Failed to fetch packages" });
    }
  });

  app.get("/api/packages/:id", async (req, res) => {
    try {
      const pkg = await storage.getPackage(req.params.id);
      if (!pkg) {
        return res.status(404).json({ error: "Package not found" });
      }
      res.json(pkg);
    } catch (error) {
      console.error("Package fetch error:", error);
      res.status(500).json({ error: "Failed to fetch package" });
    }
  });

  app.post("/api/packages/activate", async (req, res) => {
    try {
      const { packageId } = req.body;
      if (!packageId) {
        return res.status(400).json({ error: "Missing packageId" });
      }

      const userId = getRequestUserId(req);
      const userPackage = await storage.activatePackage(userId, packageId);
      res.json(userPackage);
    } catch (error) {
      console.error("Package activation error:", error);
      res.status(500).json({ error: "Failed to activate package" });
    }
  });

  // ============ USER PACKAGE ROUTES ============

  app.get("/api/user/packages", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const packages = await storage.getUserPackages(userId);
      res.json(packages);
    } catch (error) {
      console.error("User packages fetch error:", error);
      res.status(500).json({ error: "Failed to fetch user packages" });
    }
  });

  app.get("/api/user/active-package", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const cityId = req.query.cityId as string | undefined;
      if (!cityId) {
        return res.json(null);
      }
      const activePackage = await storage.getUserActivePackage(userId, cityId);
      res.json(activePackage || null);
    } catch (error) {
      console.error("Active package fetch error:", error);
      res.status(500).json({ error: "Failed to fetch active package" });
    }
  });

  app.get("/api/user/entitlements", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const cityId = req.query.cityId as string | undefined;
      if (!cityId) {
        return res.json([]);
      }
      const entitlements = await storage.getUserEntitlements(userId, cityId);
      res.json(entitlements);
    } catch (error) {
      console.error("Entitlements fetch error:", error);
      res.status(500).json({ error: "Failed to fetch entitlements" });
    }
  });

  // ============ PROVIDER ROUTES ============

  app.get("/api/providers", async (req, res) => {
    try {
      const cityId = req.query.cityId as string | undefined;
      if (!cityId) {
        return res.json([]);
      }
      const providers = await storage.getProviders(cityId);
      res.json(providers);
    } catch (error) {
      console.error("Providers fetch error:", error);
      res.status(500).json({ error: "Failed to fetch providers" });
    }
  });

  app.get("/api/providers/:id", async (req, res) => {
    try {
      const provider = await storage.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }
      res.json(provider);
    } catch (error) {
      console.error("Provider fetch error:", error);
      res.status(500).json({ error: "Failed to fetch provider" });
    }
  });

  // ============ USER EVENTS (for learning) ============

  app.post("/api/events", async (req, res) => {
    try {
      const { eventType, tripId, cityId, context } = req.body;
      const userId = getRequestUserId(req);

      if (!eventType) {
        return res.status(400).json({ error: "Missing eventType" });
      }

      const event = await storage.recordUserEvent({
        userId,
        tripId: tripId || null,
        eventType: eventType as UserEventType,
        cityId: cityId || null,
        context: context || null,
      });

      // Apply learning from event (legacy storage)
      const currentPrefs = await storage.getLearnedPreferences(userId);
      const updatedPrefs = applyEventToPreferences(currentPrefs, {
        ...event,
        context: { ...context, cityId },
      });
      await storage.updateLearnedPreferences(userId, updatedPrefs);

      // Apply learning to new profile storage
      try {
        await applyLearningEvent(userId, eventType as any, { ...context, cityCode: cityId });
      } catch (e) {
        console.warn("[events] applyLearningEvent failed:", e);
      }

      res.json({ success: true, eventId: event.id });
    } catch (error) {
      console.error("Event recording error:", error);
      res.status(500).json({ error: "Failed to record event" });
    }
  });

  app.get("/api/events", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const limit = parseInt(req.query.limit as string) || 50;
      const events = await storage.getUserEvents(userId, limit);
      res.json(events);
    } catch (error) {
      console.error("Events fetch error:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // ============ LEARNED PREFERENCES ============

  app.get("/api/user/learned-preferences", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const prefs = await storage.getLearnedPreferences(userId);
      res.json(prefs);
    } catch (error) {
      console.error("Learned preferences fetch error:", error);
      res.status(500).json({ error: "Failed to fetch learned preferences" });
    }
  });

  // ============ ACTIVATION CHECKLIST ============

  app.get("/api/user/activation-checklist", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const cityId = req.query.cityId as string | undefined;

      if (!cityId) {
        return res.json({ items: [], hasActivePass: false });
      }

      // Get active package and build entitlement set
      const activePackage = await storage.getUserActivePackage(userId, cityId);

      if (!activePackage) {
        return res.json({ items: [], hasActivePass: false });
      }

      const rawEntitlements = activePackage.entitlements as any[];
      const entitlementSet = buildEntitlementSet(
        userId,
        cityId,
        activePackage.packageId,
        `Pass (${activePackage.packageId})`,
        rawEntitlements.map((e: any) => ({
          providerId: e.providerId,
          providerName: e.providerName,
          providerType: e.providerType,
          benefitType: e.benefitType,
          value: e.value,
          remainingUses: e.remainingUses,
          activatedAt: e.activatedAt,
        })),
        new Date(activePackage.startAt),
        new Date(activePackage.endAt)
      );

      const items = getActivationChecklist(cityId as CityCode, entitlementSet);

      res.json({
        items,
        hasActivePass: entitlementSet.isActive,
        packageName: entitlementSet.packageName,
        validUntil: entitlementSet.validUntil,
      });
    } catch (error) {
      console.error("Activation checklist error:", error);
      res.status(500).json({ error: "Failed to get activation checklist" });
    }
  });

  // ============ MOBILITY PLAN (NEW ABSTRACTION) ============

  app.get("/api/trips/:id/mobility-plan", async (req, res) => {
    try {
      const trip = await storage.getTrip(req.params.id);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const recommendation = trip.recommendation as any;
      if (!recommendation) {
        return res.status(400).json({ error: "Trip has no recommendation" });
      }

      const userId = trip.userId || getRequestUserId(req);
      const activePackage = await storage.getUserActivePackage(userId, trip.cityId);

      const result = buildMobilityPlan({
        recommendation,
        cityCode: trip.cityId as CityCode,
        origin: {
          name: trip.originName,
          lat: trip.originLat || undefined,
          lng: trip.originLng || undefined,
        },
        destination: {
          name: trip.destinationName,
          lat: trip.destinationLat || undefined,
          lng: trip.destinationLng || undefined,
        },
        activePackage,
      });

      res.json({
        mobilityPlan: result.mobilityPlan,
        passInsight: result.passInsight,
        entitlementSummary: result.entitlementSet.isActive ? {
          hasActivePass: true,
          packageName: result.entitlementSet.packageName,
          transitCovered: result.entitlementSet.hasTransitPass,
          ridehailDiscount: result.entitlementSet.entitlements.find(e => e.type === "ridehail_discount")?.percentOff,
          hasBikeBenefit: result.entitlementSet.hasBikeBenefit,
        } : null,
      });
    } catch (error) {
      console.error("Mobility plan error:", error);
      res.status(500).json({ error: "Failed to build mobility plan" });
    }
  });

  // ============ PROVIDER CATALOG (from new adapters) ============

  app.get("/api/provider-catalog", async (req, res) => {
    try {
      const cityId = req.query.cityId as string | undefined;
      if (!cityId) {
        return res.json([]);
      }

      const providers = getProvidersForCity(cityId as CityCode);
      res.json(providers.map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        type: p.type,
        cityCode: p.cityCode,
        logoEmoji: p.logoEmoji,
        capabilities: p.capabilities,
        systemMapLink: p.getSystemMapLink?.(),
      })));
    } catch (error) {
      console.error("Provider catalog error:", error);
      res.status(500).json({ error: "Failed to fetch provider catalog" });
    }
  });

  // ============ DEBUG ROUTES ============

  app.get("/api/debug/memory-assistant", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const healthy = await checkMemoryHealth();
      const summary = await getUserMemorySummary(userId);

      res.json({
        serviceUrl: process.env.MEMORY_ASSISTANT_URL || "http://localhost:8000",
        configured: !!process.env.MEMORY_ASSISTANT_API_KEY,
        healthy,
        userId,
        userHasMemories: summary !== null,
        memorySummary: summary,
      });
    } catch (error) {
      console.error("Memory assistant debug error:", error);
      res.status(500).json({ error: "Failed to get memory assistant status" });
    }
  });

  app.get("/api/debug/entitlements", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const cityId = req.query.cityId as string | undefined;

      if (!cityId) {
        return res.json({ error: "Missing cityId" });
      }

      const activePackage = await storage.getUserActivePackage(userId, cityId);
      const providers = getProvidersForCity(cityId as CityCode);
      const entitlements = await storage.getUserEntitlements(userId, cityId);

      res.json({
        userId,
        cityId,
        activePackage: activePackage ? {
          id: activePackage.id,
          packageId: activePackage.packageId,
          startAt: activePackage.startAt,
          endAt: activePackage.endAt,
          status: activePackage.status,
          entitlements: activePackage.entitlements,
        } : null,
        providers: providers.map(p => ({
          id: p.id,
          name: p.name,
          type: p.type,
        })),
        rawEntitlements: entitlements,
      });
    } catch (error) {
      console.error("Debug entitlements error:", error);
      res.status(500).json({ error: "Failed to get debug info" });
    }
  });

  // ============ RIDEHAIL QUOTES ============

  app.post("/api/quotes", async (req, res) => {
    try {
      // Validate request body
      const parseResult = QuoteRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parseResult.error.issues,
        });
      }

      const request = parseResult.data;

      // Get user entitlements if available
      const userId = getRequestUserId(req);
      const entitlements = await storage.getUserEntitlements(userId, request.cityCode);

      // Add entitlements to request
      const requestWithEntitlements: QuoteRequest = {
        ...request,
        userEntitlements: entitlements.map((e: any) => ({
          providerId: e.providerId,
          discountPercent: e.benefitType === "discount_percent" ? e.value : undefined,
        })),
      };

      // Parse user note for constraints
      if (req.body.userNote) {
        const note = req.body.userNote.toLowerCase();
        requestWithEntitlements.constraints = {
          ...requestWithEntitlements.constraints,
          isDateContext: note.includes("date") || note.includes("romantic") || note.includes("special"),
          preferComfort: note.includes("comfort") || note.includes("nice") || note.includes("impress"),
          preferReliability: note.includes("important") || note.includes("meeting") || note.includes("interview"),
        };
      }

      const response = await getQuotes(requestWithEntitlements);

      res.json(response);
    } catch (error) {
      console.error("Quotes error:", error);
      res.status(500).json({ error: "Failed to get quotes" });
    }
  });

  // Request a ride - server selects best provider
  app.post("/api/request-ride", async (req, res) => {
    try {
      const { cityCode, origin, destination, userNote } = req.body;

      if (!cityCode || !origin || !destination) {
        return res.status(400).json({
          error: "Missing required fields: cityCode, origin, destination",
        });
      }

      // Get user entitlements
      const userId = getRequestUserId(req);
      const entitlements = await storage.getUserEntitlements(userId, cityCode);

      // Build quote request with context
      const quoteRequest: QuoteRequest = {
        cityCode,
        origin,
        destination,
        userEntitlements: entitlements.map((e: any) => ({
          providerId: e.providerId,
          discountPercent: e.benefitType === "discount_percent" ? e.value : undefined,
        })),
        constraints: {},
      };

      // Parse user note for preferences
      if (userNote) {
        const note = userNote.toLowerCase();
        quoteRequest.constraints = {
          isDateContext: note.includes("date") || note.includes("romantic") || note.includes("special"),
          preferComfort: note.includes("comfort") || note.includes("nice") || note.includes("impress"),
          preferReliability: note.includes("important") || note.includes("meeting") || note.includes("interview"),
        };
      }

      // Get quotes and server selects best
      const quoteResponse = await getQuotes(quoteRequest);

      if (quoteResponse.quotes.length === 0) {
        return res.status(404).json({
          error: "No rides available in this area",
        });
      }

      // Find the selected quote (server's choice)
      const selectedQuote = quoteResponse.quotes.find(
        (q) => q.providerId === quoteResponse.debug?.selectedProviderId
      ) || quoteResponse.quotes[0];

      // Build response with ride details
      res.json({
        success: true,
        provider: {
          id: selectedQuote.providerId,
          name: selectedQuote.providerName,
          type: selectedQuote.providerType,
        },
        estimate: {
          priceMin: selectedQuote.price.min,
          priceMax: selectedQuote.price.max,
          currency: selectedQuote.price.currency,
          pickupEtaMin: selectedQuote.pickupEtaMin,
          tripDurationMin: selectedQuote.tripEtaMin,
          isEstimate: true,
        },
        execution: selectedQuote.execution,
        selectionReason: quoteResponse.debug?.selectionReason,
        alternativeProviders: quoteResponse.quotes
          .filter((q) => q.providerId !== selectedQuote.providerId)
          .map((q) => ({
            id: q.providerId,
            name: q.providerName,
            priceRange: `${q.price.min}-${q.price.max}`,
          })),
      });
    } catch (error) {
      console.error("Request ride error:", error);
      res.status(500).json({ error: "Failed to request ride" });
    }
  });

  // ============ IN-APP RIDE BOOKING (DEMO) ============
  // These routes use the new RideBroker for in-app ride requests

  // Import ride broker lazily to avoid circular dependencies
  const { getRideBroker } = await import("../packages/core/rides");

  // Get quotes from all available providers
  app.post("/api/rides/quote", async (req, res) => {
    try {
      const { pickupLat, pickupLng, pickupAddress, dropoffLat, dropoffLng, dropoffAddress } = req.body;

      if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
        return res.status(400).json({
          error: "Missing required fields: pickupLat, pickupLng, dropoffLat, dropoffLng",
        });
      }

      const broker = getRideBroker();
      const quotes = await broker.getQuotes({
        pickupLat,
        pickupLng,
        pickupAddress: pickupAddress || "Pickup location",
        dropoffLat,
        dropoffLng,
        dropoffAddress: dropoffAddress || "Dropoff location",
      });

      res.json(quotes);
    } catch (error) {
      console.error("Ride quote error:", error);
      res.status(500).json({ error: "Failed to get ride quotes" });
    }
  });

  // Request a ride using a quote
  app.post("/api/rides/request", async (req, res) => {
    try {
      const { quoteId, passengerName, passengerPhone, notes, tripId, stepIndex } = req.body;

      if (!quoteId || !passengerName) {
        return res.status(400).json({
          error: "Missing required fields: quoteId, passengerName",
        });
      }

      const broker = getRideBroker();
      const booking = await broker.requestRide({
        quoteId,
        passengerName,
        passengerPhone,
        notes,
        tripId,
        stepIndex,
      });

      // Store booking in database for persistence
      const userId = getRequestUserId(req);
      const cityCode = req.body.cityCode || "unknown";

      await storage.createRideBooking({
        id: booking.id,
        userId,
        providerId: booking.providerId,
        providerName: booking.providerName,
        cityCode,
        status: booking.status,
        originJson: {
          lat: booking.pickupLat,
          lng: booking.pickupLng,
          address: booking.pickupAddress,
        },
        destinationJson: {
          lat: booking.dropoffLat,
          lng: booking.dropoffLng,
          address: booking.dropoffAddress,
        },
        priceRangeJson: {
          amount: booking.priceCents,
          currency: booking.currency,
          display: booking.priceDisplay,
        },
        isDemo: booking.isDemo,
      });

      // Log requested_ride_in_app event for learning
      // This signals comfort preference and lower walking tolerance
      try {
        await logEvent(userId, cityCode, "requested_ride_in_app", {
          tripId,
          providerId: booking.providerId,
          reason: notes,
        });

        // Apply learning - increases comfortBias, decreases walkingToleranceMin
        await applyLearningEvent(userId, "requested_in_app_ride" as any, {
          cityCode,
        });
      } catch (e) {
        console.warn("[rides/request] Failed to log requested_ride_in_app event:", e);
      }

      res.json(booking);
    } catch (error) {
      console.error("Ride request error:", error);
      const message = error instanceof Error ? error.message : "Failed to request ride";
      res.status(500).json({ error: message });
    }
  });

  // Get status of a booking
  app.get("/api/rides/:id/status", async (req, res) => {
    try {
      const { id } = req.params;

      const broker = getRideBroker();
      const booking = await broker.getBookingStatus(id);

      // Update database with latest status
      await storage.updateRideBookingStatus(id, booking.status, {
        driver: booking.driver,
        driverLat: booking.driverLat,
        driverLng: booking.driverLng,
        etaMinutes: booking.etaMinutes,
      });

      res.json(booking);
    } catch (error) {
      console.error("Ride status error:", error);
      const message = error instanceof Error ? error.message : "Failed to get ride status";
      res.status(404).json({ error: message });
    }
  });

  // Cancel a booking
  app.post("/api/rides/:id/cancel", async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const broker = getRideBroker();
      const booking = await broker.cancelBooking(id);

      // Update database
      await storage.updateRideBookingStatus(id, "cancelled", {
        cancellationReason: reason || "User cancelled",
      });

      res.json(booking);
    } catch (error) {
      console.error("Ride cancel error:", error);
      const message = error instanceof Error ? error.message : "Failed to cancel ride";
      res.status(500).json({ error: message });
    }
  });

  // Get available ride providers
  app.get("/api/rides/providers", async (req, res) => {
    try {
      const broker = getRideBroker();
      const providers = broker.getProviders();
      res.json(providers);
    } catch (error) {
      console.error("Ride providers error:", error);
      res.status(500).json({ error: "Failed to get ride providers" });
    }
  });

  // ============ DETOUR SUGGESTIONS ============

  app.post("/api/detours/suggest", async (req, res) => {
    try {
      const { originLat, originLng, destLat, destLng, category, maxDetourMinutes } = req.body;

      if (originLat == null || originLng == null || destLat == null || destLng == null) {
        return res.status(400).json({
          error: "Missing required coordinates: originLat, originLng, destLat, destLng",
        });
      }

      const result = await getDetourSuggestions(
        originLat,
        originLng,
        destLat,
        destLng,
        category,
        maxDetourMinutes,
      );

      if (!result) {
        return res.status(502).json({ error: "Detour suggestion service unavailable" });
      }

      res.json(result);
    } catch (error) {
      console.error("Detour suggestions error:", error);
      res.status(500).json({ error: "Failed to get detour suggestions" });
    }
  });

  return httpServer;
}
