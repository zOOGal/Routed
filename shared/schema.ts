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
  googleMapsLink?: string; // Full trip link for navigation
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
  navigationDeepLink?: string; // Google Maps navigation link
  transitDetails?: {
    departureStop: string;
    arrivalStop: string;
    departureTime?: string;
    arrivalTime?: string;
    vehicleType?: string;
  };
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
  // Slider-based preferences
  calmVsFast?: number; // 0 = calm, 100 = fast
  economyVsComfort?: number; // 0 = economy, 100 = comfort
  unfamiliarWithCity?: boolean;
  // Optional user context note
  userNote?: string;
}

export interface AgentResponse {
  recommendation: RouteRecommendation;
  tripId: string;
}

// ============================================
// TRAVEL PACKAGES & MEMBERSHIPS
// ============================================

// Travel packages (e.g., "Berlin 7-day")
export const packages = pgTable("packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cityId: varchar("city_id").notNull(),
  name: text("name").notNull(),
  durationDays: integer("duration_days").notNull(),
  priceCents: integer("price_cents").notNull(),
  description: text("description"),
  includedProviders: jsonb("included_providers").$type<string[]>().notNull(),
  benefitRules: jsonb("benefit_rules").$type<BenefitRule[]>().notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// User's purchased/activated packages
export const userPackages = pgTable("user_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  packageId: varchar("package_id").notNull().references(() => packages.id),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  status: text("status").default("active"), // 'active', 'expired', 'cancelled'
  entitlements: jsonb("entitlements").$type<Entitlement[]>().notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Providers (transit, ridehail, bike services per city)
export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cityId: varchar("city_id").notNull(),
  type: text("type").notNull(), // 'transit', 'ridehail', 'bike'
  name: text("name").notNull(),
  deepLinkTemplate: text("deep_link_template"),
  logoEmoji: text("logo_emoji"), // Simple emoji for now
  baseFareCents: integer("base_fare_cents"),
  perKmCents: integer("per_km_cents"),
  perMinCents: integer("per_min_cents"),
});

// Package insert schema
export const insertPackageSchema = createInsertSchema(packages).omit({
  id: true,
  createdAt: true,
});

export const insertUserPackageSchema = createInsertSchema(userPackages).omit({
  id: true,
  createdAt: true,
});

export const insertProviderSchema = createInsertSchema(providers).omit({
  id: true,
});

// Types for packages
export type Package = typeof packages.$inferSelect;
export type InsertPackage = z.infer<typeof insertPackageSchema>;
export type UserPackage = typeof userPackages.$inferSelect;
export type InsertUserPackage = z.infer<typeof insertUserPackageSchema>;
export type Provider = typeof providers.$inferSelect;
export type InsertProvider = z.infer<typeof insertProviderSchema>;

// Benefit rule types
export interface BenefitRule {
  providerType: 'transit' | 'ridehail' | 'bike';
  providerId?: string; // Optional - applies to all of type if not specified
  benefitType: 'free_pass' | 'discount_percent' | 'free_minutes' | 'free_unlocks';
  value: number; // percentage for discount, minutes for free_minutes, count for unlocks
  maxUsesPerDay?: number;
}

// Entitlement (activated benefit from a package)
export interface Entitlement {
  providerId: string;
  providerName: string;
  providerType: 'transit' | 'ridehail' | 'bike';
  benefitType: 'free_pass' | 'discount_percent' | 'free_minutes' | 'free_unlocks';
  value: number;
  remainingUses?: number;
  activatedAt: string;
}

// Provider adapter interface (for implementing stubs)
export interface ProviderAdapter {
  id: string;
  name: string;
  type: 'transit' | 'ridehail' | 'bike';
  cityId: string;
  logoEmoji: string;

  // Estimate cost for a route segment
  estimateCost(durationMin: number, distanceMeters: number, entitlements: Entitlement[]): {
    baseCostCents: number;
    adjustedCostCents: number;
    benefitApplied: string | null;
    isFree: boolean;
  };

  // Generate deep link to provider app
  getDeepLink(origin: string, destination: string): string;
}
