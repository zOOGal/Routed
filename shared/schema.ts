import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User table with mobility preferences
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  // Global mobility preferences
  walkingTolerance: integer("walking_tolerance").default(3), // 1-5 scale
  transferTolerance: integer("transfer_tolerance").default(3), // 1-5 scale
  stressVsSpeedBias: real("stress_vs_speed_bias").default(0.7), // 0-1, higher = prefer less stress
  costSensitivity: integer("cost_sensitivity").default(3), // 1-5 scale
});

// City familiarity scores for each user
export const userCityFamiliarity = pgTable("user_city_familiarity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  cityId: varchar("city_id").notNull(),
  familiarityScore: real("familiarity_score").default(0), // 0-1 scale
  visitCount: integer("visit_count").default(0),
  lastVisit: timestamp("last_visit"),
});

// Behavioral signals learned from user actions
export const behavioralSignals = pgTable("behavioral_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  signalType: text("signal_type").notNull(), // 'override', 'abandonment', 'repeated_choice'
  routeType: text("route_type"), // 'transit', 'rideshare', 'walk', 'bike'
  cityId: varchar("city_id"),
  context: jsonb("context"), // Time of day, weather, etc.
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Trip sessions
export const trips = pgTable("trips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  cityId: varchar("city_id").notNull(),
  originName: text("origin_name").notNull(),
  originLat: real("origin_lat"),
  originLng: real("origin_lng"),
  destinationName: text("destination_name").notNull(),
  destinationLat: real("destination_lat"),
  destinationLng: real("destination_lng"),
  status: text("status").default("planned"), // 'planned', 'in_progress', 'completed', 'cancelled'
  recommendation: jsonb("recommendation"), // The AI recommendation
  reasoning: text("reasoning"), // AI explanation
  steps: jsonb("steps"), // Array of trip steps
  currentStepIndex: integer("current_step_index").default(0),
  estimatedDuration: integer("estimated_duration"), // in minutes
  stressScore: real("stress_score"), // 0-1 scale
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  walkingTolerance: true,
  transferTolerance: true,
  stressVsSpeedBias: true,
  costSensitivity: true,
});

export const insertTripSchema = createInsertSchema(trips).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export const insertBehavioralSignalSchema = createInsertSchema(behavioralSignals).omit({
  id: true,
  createdAt: true,
});

export const insertUserCityFamiliaritySchema = createInsertSchema(userCityFamiliarity).omit({
  id: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type BehavioralSignal = typeof behavioralSignals.$inferSelect;
export type InsertBehavioralSignal = z.infer<typeof insertBehavioralSignalSchema>;
export type UserCityFamiliarity = typeof userCityFamiliarity.$inferSelect;
export type InsertUserCityFamiliarity = z.infer<typeof insertUserCityFamiliaritySchema>;

// City Intelligence Types (stored as JSON, not in DB)
export interface CityProfile {
  id: string;
  name: string;
  country: string;
  timezone: string;
  complexStations: string[];
  nightReliability: number; // 0-1
  transitVsTaxiBias: number; // 0-1, higher = prefer transit
  walkingFriendliness: number; // 0-1
  cognitiveLoadIndex: {
    navigation: number; // 0-1
    signage: number; // 0-1
    crowding: number; // 0-1
    overall: number; // 0-1
  };
  currency: string;
  transitTypes: string[];
  rideshareApps: string[];
}

// Route recommendation from agent
export interface RouteRecommendation {
  mode: "transit" | "rideshare" | "walk" | "bike" | "mixed";
  summary: string;
  estimatedDuration: number; // minutes
  estimatedCost: number | null;
  stressScore: number; // 0-1
  steps: RouteStep[];
  reasoning: string;
  confidence: number; // 0-1
  alternatives?: { mode: string; reason: string }[];
}

export interface RouteStep {
  type: "walk" | "transit" | "rideshare" | "wait" | "transfer";
  instruction: string;
  duration: number; // minutes
  distance?: number; // meters
  line?: string; // transit line name
  direction?: string;
  stopsCount?: number;
  deepLink?: string; // for rideshare apps
}

// Travel mood options
export type TravelMood = "relaxed" | "normal" | "hurry" | "tired" | "adventurous";

export const TRAVEL_MOODS: { id: TravelMood; label: string; description: string; icon: string }[] = [
  { id: "relaxed", label: "Relaxed", description: "No rush, prefer calm routes", icon: "😌" },
  { id: "normal", label: "Normal", description: "Balanced time and comfort", icon: "🙂" },
  { id: "hurry", label: "In a Hurry", description: "Speed matters most", icon: "⚡" },
  { id: "tired", label: "Tired", description: "Minimal walking, prefer sitting", icon: "😴" },
  { id: "adventurous", label: "Adventurous", description: "Open to scenic routes", icon: "🌟" },
];

// Weather context (detected by AI)
export interface WeatherContext {
  condition: string; // "clear", "rain", "snow", "hot", "cold"
  temperature: number; // Celsius
  isOutdoorFriendly: boolean;
}

// Agent request/response types
export interface AgentRequest {
  origin: string;
  destination: string;
  departureTime?: string;
  cityId: string;
  userId?: string;
  mood?: TravelMood;
}

export interface AgentResponse {
  recommendation: RouteRecommendation;
  tripId: string;
}
