/**
 * ROUTED RIDES — DOMAIN TYPES
 *
 * In-app ride request system with demo provider support.
 * All types are honest about being demo/mock data.
 */

import { z } from "zod";

// ============================================
// ENUMS & CONSTANTS
// ============================================

export const RideStatusEnum = z.enum([
  "quoted",        // Quote received, not yet requested
  "requested",     // Ride requested, waiting for driver
  "driver_assigned", // Driver matched, en route to pickup
  "arriving",      // Driver arriving at pickup
  "in_progress",   // Passenger in vehicle
  "completed",     // Ride finished
  "cancelled",     // Cancelled by user or provider
  "failed",        // System error or no drivers available
]);

export type RideStatus = z.infer<typeof RideStatusEnum>;

export const RideTierEnum = z.enum([
  "economy",   // Cheapest option
  "comfort",   // Mid-tier with better vehicles
  "premium",   // Luxury vehicles
]);

export type RideTier = z.infer<typeof RideTierEnum>;

// ============================================
// RIDE QUOTE
// ============================================

export const RideQuoteSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string(), // e.g., "demo_provider"
  providerName: z.string(), // e.g., "DEMO Provider"
  tier: RideTierEnum,

  // Pricing
  priceEstimateCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  priceDisplay: z.string(), // e.g., "$12.50 - $15.00"

  // Time estimates
  pickupEtaMinutes: z.number().int().nonnegative(),
  tripDurationMinutes: z.number().int().positive(),

  // Route info
  pickupLat: z.number(),
  pickupLng: z.number(),
  pickupAddress: z.string(),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
  dropoffAddress: z.string(),
  distanceMeters: z.number().int().positive(),

  // Demo flag - MUST be true for mock providers
  isDemo: z.boolean(),
  demoDisclaimer: z.string().optional(),

  // Expiry
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type RideQuote = z.infer<typeof RideQuoteSchema>;

// ============================================
// RIDE REQUEST INPUT
// ============================================

export const RideRequestInputSchema = z.object({
  quoteId: z.string().uuid(),

  // Passenger info
  passengerName: z.string().min(1),
  passengerPhone: z.string().optional(),

  // Special requests
  notes: z.string().optional(),

  // Trip context (for orchestrator integration)
  tripId: z.string().uuid().optional(),
  stepIndex: z.number().int().nonnegative().optional(),
});

export type RideRequestInput = z.infer<typeof RideRequestInputSchema>;

// ============================================
// RIDE BOOKING
// ============================================

export const RideBookingSchema = z.object({
  id: z.string().uuid(),
  quoteId: z.string().uuid(),

  // Provider info
  providerId: z.string(),
  providerName: z.string(),
  providerBookingRef: z.string().optional(), // External reference if any

  // Status
  status: RideStatusEnum,
  statusMessage: z.string().optional(),

  // Pricing (locked in from quote)
  priceCents: z.number().int().positive(),
  currency: z.string(),
  priceDisplay: z.string(),

  // Route (copied from quote)
  pickupLat: z.number(),
  pickupLng: z.number(),
  pickupAddress: z.string(),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
  dropoffAddress: z.string(),
  distanceMeters: z.number().int().positive(),

  // Driver info (populated when assigned)
  driver: z.object({
    name: z.string(),
    photoUrl: z.string().url().optional(),
    rating: z.number().min(0).max(5),
    vehicleMake: z.string(),
    vehicleModel: z.string(),
    vehicleColor: z.string(),
    licensePlate: z.string(),
  }).optional(),

  // Live tracking
  driverLat: z.number().optional(),
  driverLng: z.number().optional(),
  etaMinutes: z.number().int().nonnegative().optional(),

  // Trip context
  tripId: z.string().uuid().optional(),
  stepIndex: z.number().int().nonnegative().optional(),

  // Demo flag
  isDemo: z.boolean(),
  demoDisclaimer: z.string().optional(),

  // Timestamps
  requestedAt: z.string().datetime(),
  driverAssignedAt: z.string().datetime().optional(),
  pickupAt: z.string().datetime().optional(),
  dropoffAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
});

export type RideBooking = z.infer<typeof RideBookingSchema>;

// ============================================
// RIDE EVENT (for status history)
// ============================================

export const RideEventSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  status: RideStatusEnum,
  message: z.string().optional(),
  driverLat: z.number().optional(),
  driverLng: z.number().optional(),
  createdAt: z.string().datetime(),
});

export type RideEvent = z.infer<typeof RideEventSchema>;

// ============================================
// PROVIDER CAPABILITIES
// ============================================

export interface ProviderCapabilities {
  /** Provider can complete in-app bookings (false = deep-link only) */
  realBooking: boolean;
  /** Provider can return live status updates */
  liveTracking: boolean;
  /** Provider supports in-app cancellation */
  cancellation: boolean;
  /** Deep link URL template (if applicable). Use {lat},{lng} placeholders. */
  deepLinkTemplate?: string;
}

// ============================================
// PROVIDER ADAPTER INTERFACE
// ============================================

export interface QuoteRequest {
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
}

export interface RideProviderAdapter {
  readonly providerId: string;
  readonly providerName: string;
  readonly isDemo: boolean;
  readonly capabilities: ProviderCapabilities;

  /**
   * Get available quotes for a route
   */
  getQuotes(request: QuoteRequest): Promise<RideQuote[]>;

  /**
   * Request a ride from a quote.
   * Throws if capabilities.realBooking is false.
   */
  requestRide(input: RideRequestInput, quote: RideQuote): Promise<RideBooking>;

  /**
   * Get current status of a booking
   */
  getStatus(bookingId: string, providerRef?: string): Promise<RideBooking>;

  /**
   * Cancel a booking
   */
  cancelRide(bookingId: string, providerRef?: string): Promise<RideBooking>;

  /**
   * Check if provider is available/configured
   */
  isAvailable(): boolean;
}

// ============================================
// SCORING TYPES
// ============================================

export interface RideScoringContext {
  /** User prefers comfort over price */
  preferComfort?: boolean;
  /** User prefers reliability (important meeting, interview) */
  preferReliability?: boolean;
  /** Date/romantic context — prioritize reliability + comfort */
  isDateContext?: boolean;
  /** Maximum price in cents the user wants */
  maxPriceCents?: number;
  /** Maximum pickup wait in minutes */
  maxPickupEtaMin?: number;
}

export interface ScoredQuote {
  quote: RideQuote;
  score: number;
  reasons: string[];
}

// ============================================
// BROKER TYPES
// ============================================

export interface QuoteAggregation {
  quotes: RideQuote[];
  providers: string[];
  cheapest?: RideQuote;
  fastest?: RideQuote;
  /** Server-selected best quote (when scoring context provided) */
  selected?: ScoredQuote;
  errors: Array<{ providerId: string; error: string }>;
  fetchedAt: string;
}
