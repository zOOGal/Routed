/**
 * RIDEHAIL QUOTE TYPES
 *
 * Normalized quote format for taxi/ridehail services.
 * PoC implementation - no real API calls.
 *
 * HONESTY RULES:
 * - All prices are ESTIMATES, label accordingly
 * - Currency must match city (NYC=USD, Berlin=EUR, Tokyo=JPY)
 * - Never claim real-time prices without API integration
 * - Provider labels are generic (not "Uber" or "Lyft")
 */

import { z } from "zod";

// ============================================
// CITY CODES
// ============================================

export const CityCodeSchema = z.enum(["nyc", "berlin", "tokyo"]);
export type CityCode = z.infer<typeof CityCodeSchema>;

// ============================================
// CURRENCY
// ============================================

export const CurrencySchema = z.enum(["USD", "EUR", "JPY"]);
export type Currency = z.infer<typeof CurrencySchema>;

export const CITY_CURRENCY: Record<CityCode, Currency> = {
  nyc: "USD",
  berlin: "EUR",
  tokyo: "JPY",
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  JPY: "¥",
};

// ============================================
// LOCATION
// ============================================

export const LocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  name: z.string().optional(),
});

export type Location = z.infer<typeof LocationSchema>;

// ============================================
// PRICE ESTIMATE
// ============================================

export const PriceEstimateSchema = z.object({
  min: z.number(), // Minimum estimated price in smallest currency unit (cents/yen)
  max: z.number(), // Maximum estimated price
  currency: CurrencySchema,
  confidence: z.enum(["high", "medium", "low"]), // How confident is this estimate?
  isEstimate: z.literal(true), // Always true for PoC
});

export type PriceEstimate = z.infer<typeof PriceEstimateSchema>;

// ============================================
// EXECUTION TYPE
// ============================================

export const ExecutionTypeSchema = z.enum([
  "deeplink",    // Open provider app
  "phone",       // Call for pickup
  "hail",        // Street hail only
  "unavailable", // Provider not available
]);

export type ExecutionType = z.infer<typeof ExecutionTypeSchema>;

export const ExecutionSchema = z.object({
  type: ExecutionTypeSchema,
  url: z.string().optional(),      // Deep link URL if applicable
  phone: z.string().optional(),    // Phone number if applicable
  label: z.string().optional(),    // Button label
});

export type Execution = z.infer<typeof ExecutionSchema>;

// ============================================
// QUOTE TAGS
// ============================================

export const QuoteTagSchema = z.enum([
  "cheapest",
  "fastest_pickup",
  "fastest_trip",
  "most_reliable",
  "premium",
  "shared",
  "accessible",
  "eco",
]);

export type QuoteTag = z.infer<typeof QuoteTagSchema>;

// ============================================
// PROVIDER QUOTE
// ============================================

export const QuoteSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),       // Display name (generic for PoC)
  providerType: z.enum(["taxi", "ridehail_economy", "ridehail_premium"]),
  mode: z.literal("ridehail"),    // Always ridehail for this service

  // Pricing
  price: PriceEstimateSchema,

  // Timing
  pickupEtaMin: z.number(),       // Minutes until pickup
  tripEtaMin: z.number(),         // Estimated trip duration

  // Reliability
  availabilityConfidence: z.enum(["high", "medium", "low"]),

  // Execution
  execution: ExecutionSchema,

  // Tags for filtering/sorting
  tags: z.array(QuoteTagSchema),

  // Debug info (dev only)
  debug: z.object({
    distanceKm: z.number().optional(),
    surgeMultiplier: z.number().optional(),
    pricingModel: z.string().optional(),
  }).optional(),
});

export type Quote = z.infer<typeof QuoteSchema>;

// ============================================
// QUOTE REQUEST
// ============================================

export const QuoteRequestSchema = z.object({
  cityCode: CityCodeSchema,
  origin: LocationSchema,
  destination: LocationSchema,
  userEntitlements: z.array(z.object({
    providerId: z.string(),
    discountPercent: z.number().optional(),
  })).optional(),
  constraints: z.object({
    maxPriceCents: z.number().optional(),
    maxPickupEtaMin: z.number().optional(),
    preferReliability: z.boolean().optional(),
    preferComfort: z.boolean().optional(),
    isDateContext: z.boolean().optional(), // User mentioned "date" - prioritize reliability
  }).optional(),
});

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

// ============================================
// QUOTE RESPONSE
// ============================================

export const QuoteResponseSchema = z.object({
  quotes: z.array(QuoteSchema),
  currency: CurrencySchema,
  requestedAt: z.string(),
  expiresAt: z.string(), // Quotes expire quickly
  debug: z.object({
    cheapestProviderId: z.string().optional(),
    selectedProviderId: z.string().optional(),
    selectionReason: z.string().optional(),
    providersQueried: z.array(z.string()),
  }).optional(),
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

// ============================================
// PROVIDER CAPABILITY FLAGS
// ============================================

export interface ProviderCapabilities {
  canGetQuote: boolean;
  canGetDeepLink: boolean;
  canCreateBooking: boolean; // False for PoC
  supportsScheduled: boolean;
  supportsShared: boolean;
}

// ============================================
// QUOTE PROVIDER INTERFACE
// ============================================

export interface QuoteProviderAdapter {
  id: string;
  name: string;
  type: "taxi" | "ridehail_economy" | "ridehail_premium";
  cityCode: CityCode;
  capabilities: ProviderCapabilities;

  // Get a quote for a trip
  getQuote(request: QuoteRequest): Promise<Quote | null>;

  // Get deep link to open provider app
  getDeepLink(origin: Location, destination: Location): string | null;

  // Create booking (not implemented in PoC)
  createBooking?(request: QuoteRequest): Promise<{ bookingId: string } | null>;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function formatPrice(cents: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (currency === "JPY") {
    return `${symbol}${cents}`; // Yen has no decimal
  }
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export function formatPriceRange(price: PriceEstimate): string {
  const symbol = CURRENCY_SYMBOLS[price.currency];
  if (price.currency === "JPY") {
    return `${symbol}${price.min}–${price.max}`;
  }
  return `${symbol}${(price.min / 100).toFixed(0)}–${(price.max / 100).toFixed(0)}`;
}

export function getCurrencyForCity(cityCode: CityCode): Currency {
  return CITY_CURRENCY[cityCode];
}
