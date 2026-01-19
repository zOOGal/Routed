import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getRecommendation, replanTrip } from "./agent-service";
import { getCityProfile, getAllCities } from "./city-intelligence";
import type { AgentRequest } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ============ AGENT ROUTES ============
  
  app.post("/api/agent/recommend", async (req, res) => {
    try {
      const { origin, destination, cityId, departureTime } = req.body;
      
      if (!origin || !destination || !cityId) {
        return res.status(400).json({ error: "Missing required fields: origin, destination, cityId" });
      }

      const userId = (storage as any).getDefaultUserId();
      
      const request: AgentRequest = {
        origin,
        destination,
        cityId,
        departureTime,
        userId,
      };

      const recommendation = await getRecommendation(request);

      const trip = await storage.createTrip({
        userId,
        cityId,
        originName: origin,
        destinationName: destination,
        status: "planned",
        recommendation,
        reasoning: recommendation.reasoning,
        steps: recommendation.steps,
        estimatedDuration: recommendation.estimatedDuration,
        stressScore: recommendation.stressScore,
      });

      res.json({ recommendation, tripId: trip.id });
    } catch (error) {
      console.error("Agent recommendation error:", error);
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

  // ============ USER ROUTES ============
  
  app.get("/api/users/preferences", async (req, res) => {
    try {
      const userId = (storage as any).getDefaultUserId();
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
      const userId = (storage as any).getDefaultUserId();
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
      
      if (trip.userId && trip.cityId) {
        const currentFamiliarity = await storage.getUserCityFamiliarity(trip.userId, trip.cityId);
        const newScore = (currentFamiliarity?.familiarityScore || 0.2) + 0.05;
        await storage.updateUserCityFamiliarity(trip.userId, trip.cityId, newScore);
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

      const nextStep = (trip.currentStepIndex || 0) + 1;
      const updated = await storage.updateTripStep(req.params.id, nextStep);
      
      res.json(updated);
    } catch (error) {
      console.error("Error completing step:", error);
      res.status(500).json({ error: "Failed to complete step" });
    }
  });

  app.post("/api/trips/:id/cancel", async (req, res) => {
    try {
      const trip = await storage.updateTripStatus(req.params.id, "cancelled");
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }
      
      if (trip.userId) {
        await storage.recordBehavioralSignal({
          userId: trip.userId,
          signalType: "abandonment",
          routeType: (trip.recommendation as any)?.mode,
          cityId: trip.cityId,
          context: { stepIndex: trip.currentStepIndex },
        });
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

  return httpServer;
}
