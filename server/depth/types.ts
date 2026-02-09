import { z } from "zod";
import type {
  DepthLayerOutput,
  LearnedPreferences,
  VenueInfo,
  TripIntent,
  CityProfile,
  RouteRecommendation,
  UserEvent,
} from "@shared/schema";
import type { WeatherData } from "../weather-service";

// Zod schema for validating LLM output
export const depthLayerOutputSchema = z.object({
  agentPresenceLine: z.string().min(1).max(100),
  tripFramingLine: z.string().min(1).max(200),
  contextualInsights: z.array(z.string().max(150)).max(4),
  memoryCallbackLine: z.string().max(150).optional(),
  responsibilityLine: z.string().min(1).max(100),
});

// Input context for depth layer generation
export interface DepthLayerInput {
  // User context
  userId?: string;
  learnedPreferences: LearnedPreferences;
  recentEvents: UserEvent[];

  // Trip context
  intent: TripIntent;
  userNote?: string;
  origin: string;
  destination: string;

  // Route context
  recommendation: RouteRecommendation;
  cityProfile: CityProfile;

  // Environmental context
  weather: WeatherData;
  venueInfo?: VenueInfo;

  // Time context
  currentTime: Date;
  isRushHour: boolean;
  isNightTime: boolean;
}

// Insight priority categories
export type InsightCategory =
  | "venue_hours"
  | "venue_reservation"
  | "weather_impact"
  | "crowding"
  | "service_frequency"
  | "memory_based"
  | "city_tip";

export interface PrioritizedInsight {
  category: InsightCategory;
  text: string;
  priority: number; // Lower = higher priority (1-10)
  confidence: number; // 0-1
}

// Memory callback criteria
export interface MemoryCallbackContext {
  shouldShow: boolean;
  text?: string;
  confidence: number;
  basedOn: string; // Description of what triggered it
}

// Default learned preferences for new users
export const DEFAULT_LEARNED_PREFERENCES: LearnedPreferences = {
  walkingToleranceMin: 10, // 10 minutes minimum walking tolerance
  transferTolerance: 3, // Middle of 1-5 scale
  calmQuickBias: 0.5, // Balanced
  saveSpendBias: 0.3, // Slightly prefer saving
  familiarityByCity: {},
  replanSensitivity: 0.5, // Medium sensitivity
  lastUpdated: new Date().toISOString(),
};
