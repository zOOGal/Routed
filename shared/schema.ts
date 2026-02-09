import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User table with mobility preferences (legacy - for authenticated users)
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

// ============================================
// ANONYMOUS USER PROFILES (cookie-based identity)
// ============================================

export const userProfiles = pgTable("user_profiles", {
  // Primary key is the cookie-based user ID
  userId: varchar("user_id", { length: 36 }).primaryKey(),

  // Learned preferences (structured JSON)
  prefsJson: jsonb("prefs_json").$type<{
    walkingToleranceMin: number;
    walkingToleranceMax: number;
    transferTolerance: number;
    calmQuickBias: number;
    costComfortBias: number;
    outdoorBias: number;
    replanSensitivity: number;
  }>().notNull(),

  // City familiarity scores
  cityFamiliarityJson: jsonb("city_familiarity_json").$type<Record<string, number>>().notNull(),

  // Stats
  totalTrips: integer("total_trips").default(0).notNull(),
  lastTripAt: timestamp("last_trip_at"),

  // Timestamps
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;

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

// Trip intent types
export type TripIntent = "work" | "leisure" | "appointment" | "time_sensitive" | "exploring";

export const TRIP_INTENTS: { id: TripIntent; label: string; icon: string }[] = [
  { id: "work", label: "Work", icon: "briefcase" },
  { id: "leisure", label: "Leisure", icon: "coffee" },
  { id: "appointment", label: "Appointment", icon: "calendar" },
  { id: "time_sensitive", label: "Time-sensitive", icon: "clock" },
  { id: "exploring", label: "Exploring", icon: "compass" },
];

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
  intent: text("intent").default("leisure"), // TripIntent
  userNote: text("user_note"), // Optional user-provided context
  status: text("status").default("planned"), // 'planned', 'in_progress', 'completed', 'cancelled'
  recommendation: jsonb("recommendation"), // The AI recommendation
  reasoning: text("reasoning"), // AI explanation
  steps: jsonb("steps"), // Array of trip steps
  currentStepIndex: integer("current_step_index").default(0),
  estimatedDuration: integer("estimated_duration"), // in minutes
  stressScore: real("stress_score"), // 0-1 scale
  depthLayer: jsonb("depth_layer"), // DepthLayerOutput - the depth layer additions
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// ============================================
// USER EVENTS & MEMORY
// ============================================

// User event types for behavioral tracking
export type UserEventType =
  | "opened_maps"
  | "override_route"
  | "replan_shown"
  | "replan_accepted"
  | "replan_declined"
  | "abandoned_trip"
  | "step_completed"
  | "trip_completed"
  | "walked_more_than_suggested"
  | "walked_less_than_suggested"
  | "chose_faster_option"
  | "chose_calmer_option";

// Detailed user events for learning
export const userEvents = pgTable("user_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tripId: varchar("trip_id").references(() => trips.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // UserEventType
  cityId: varchar("city_id"),
  context: jsonb("context"), // Additional context (weather, time, step index, etc.)
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Memory snapshots for debugging and preference history
export const userMemorySnapshots = pgTable("user_memory_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  snapshotJson: jsonb("snapshot_json").notNull(), // LearnedPreferences
  triggerEvent: text("trigger_event"), // What caused this snapshot
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// VENUE INTELLIGENCE
// ============================================

// Venue cache for opening hours, reservations, etc.
export const venues = pgTable("venues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  placeId: text("place_id").unique(), // Google Places ID
  cityId: varchar("city_id").notNull(),
  name: text("name").notNull(),
  venueType: text("venue_type"), // museum, restaurant, station, etc.
  hoursJson: jsonb("hours_json"), // Weekly hours structure
  requiresReservation: boolean("requires_reservation").default(false),
  requiresTicket: boolean("requires_ticket").default(false),
  typicalWaitMinutes: integer("typical_wait_minutes"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
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

export const insertUserEventSchema = createInsertSchema(userEvents).omit({
  id: true,
  createdAt: true,
});

export const insertUserMemorySnapshotSchema = createInsertSchema(userMemorySnapshots).omit({
  id: true,
  createdAt: true,
});

export const insertVenueSchema = createInsertSchema(venues).omit({
  id: true,
  updatedAt: true,
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
export type UserEvent = typeof userEvents.$inferSelect;
export type InsertUserEvent = z.infer<typeof insertUserEventSchema>;
export type UserMemorySnapshot = typeof userMemorySnapshots.$inferSelect;
export type InsertUserMemorySnapshot = z.infer<typeof insertUserMemorySnapshotSchema>;
export type Venue = typeof venues.$inferSelect;
export type InsertVenue = z.infer<typeof insertVenueSchema>;

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
  estimatedCost: number | null; // Only set if verified, otherwise null
  costDisplay?: string; // Human-readable cost (e.g., "Standard fare", "Covered by pass")
  stressScore: number; // 0-1
  steps: RouteStep[];
  reasoning: string;
  confidence: number; // 0-1
  alternatives?: { mode: string; reason: string }[];
  googleMapsLink?: string; // Full trip link for navigation
  // Decision metadata for transparency
  decisionMetadata?: {
    archetype: "calm" | "fast" | "comfort";
    wasOnlyOption: boolean;
    tradeoffs: string[];
    isCoveredByPass: boolean;
  };
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
  intent?: TripIntent;
  // Slider-based preferences
  calmVsFast?: number; // 0 = calm, 100 = fast
  economyVsComfort?: number; // 0 = economy, 100 = comfort
  unfamiliarWithCity?: boolean;
  // Optional user context note
  userNote?: string;
}

export interface AgentResponse {
  recommendation: RouteRecommendation;
  depthLayer: DepthLayerOutput;
  tripId: string;
}

// ============================================
// DEPTH LAYER OUTPUT
// ============================================

export interface DepthLayerOutput {
  agentPresenceLine: string; // One-liner showing agent awareness
  tripFramingLine: string; // One sentence plan summary
  contextualInsights: string[]; // 0-4 bullets with contextual info
  memoryCallbackLine?: string; // Optional: "Since last time..."
  responsibilityLine: string; // "I'll monitor and adjust if anything changes."
  placesFallbackResults?: PlacesFallbackResult[]; // Places API fallback when curated POIs don't match
}

export interface PlacesFallbackResult {
  name: string;
  neighborhood: string | null;
  approxAddedMinutes: number;
  source: "maps";
  provider_place_id: string;
}

// ============================================
// LEARNED PREFERENCES (for memory system)
// ============================================

export interface LearnedPreferences {
  walkingToleranceMin: number; // Minimum walking tolerance (learned from avoidance)
  transferTolerance: number; // 1-5 scale
  calmQuickBias: number; // 0-1, 0 = prefer calm, 1 = prefer quick
  saveSpendBias: number; // 0-1, 0 = save money, 1 = spend for comfort
  familiarityByCity: Record<string, number>; // cityId -> familiarity 0-1
  replanSensitivity: number; // How aggressive to be with replanning
  lastUpdated: string; // ISO timestamp
}

// ============================================
// VENUE INTELLIGENCE
// ============================================

export interface VenueInfo {
  name: string;
  venueType?: string;
  isOpenNow: boolean;
  nextOpenTime?: string; // e.g., "Opens at 10:00"
  closingTime?: string; // e.g., "Closes at 18:00"
  requiresReservation: boolean;
  requiresTicket: boolean;
  typicalWaitMinutes?: number;
  confidence: number; // 0-1
}

export interface VenueHours {
  monday?: { open: string; close: string }[];
  tuesday?: { open: string; close: string }[];
  wednesday?: { open: string; close: string }[];
  thursday?: { open: string; close: string }[];
  friday?: { open: string; close: string }[];
  saturday?: { open: string; close: string }[];
  sunday?: { open: string; close: string }[];
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
  currency: text("currency").notNull().default("USD"), // USD, EUR, JPY
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

// ============================================
// RIDE BOOKINGS (In-app ride request)
// ============================================

export const rideBookings = pgTable("ride_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  providerId: varchar("provider_id").notNull(),
  providerName: text("provider_name").notNull(),
  cityCode: varchar("city_code").notNull(),
  status: text("status").notNull().default("requesting"), // requesting, matched, arriving, in_trip, completed, cancelled, failed
  originJson: jsonb("origin_json").notNull(), // { lat, lng, name?, address? }
  destinationJson: jsonb("destination_json").notNull(), // { lat, lng, name?, address? }
  priceRangeJson: jsonb("price_range_json").notNull(), // { min, max, currency, confidence }
  driverJson: jsonb("driver_json"), // { name, rating?, vehicle?, photoUrl? }
  pickupEtaMin: integer("pickup_eta_min"),
  isDemo: boolean("is_demo").notNull().default(true),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
});

// Ride events for audit trail (optional but useful)
export const rideEvents = pgTable("ride_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => rideBookings.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // status_change, driver_assigned, location_update, etc.
  payloadJson: jsonb("payload_json"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Insert schemas
export const insertRideBookingSchema = createInsertSchema(rideBookings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRideEventSchema = createInsertSchema(rideEvents).omit({
  id: true,
  createdAt: true,
});

// Types
export type RideBookingRecord = typeof rideBookings.$inferSelect;
export type InsertRideBooking = z.infer<typeof insertRideBookingSchema>;
export type RideEventRecord = typeof rideEvents.$inferSelect;
export type InsertRideEvent = z.infer<typeof insertRideEventSchema>;
