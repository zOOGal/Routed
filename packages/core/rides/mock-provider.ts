/**
 * MOCK RIDE PROVIDER ADAPTER
 *
 * Simulates a ridehail provider for demo purposes.
 * All responses are clearly marked as DEMO data.
 *
 * HONESTY: This is a DEMO provider - no actual driver will arrive.
 * In production, this would be replaced with real provider APIs.
 */

import { randomUUID } from "crypto";
import type {
  RideProviderAdapter,
  QuoteRequest,
  RideQuote,
  RideRequestInput,
  RideBooking,
  RideStatus,
} from "./types";

// ============================================
// CITY CONFIGURATION
// ============================================

type CityCode = "nyc" | "berlin" | "tokyo";

interface CityConfig {
  currency: string;
  currencySymbol: string;
  baseFareCents: number;      // Base fare in smallest currency unit
  perMeterCents: number;      // Price per meter
  minFareCents: number;       // Minimum fare
  isWholeCurrency: boolean;   // JPY uses whole numbers, not cents
}

const CITY_CONFIGS: Record<CityCode, CityConfig> = {
  nyc: {
    currency: "USD",
    currencySymbol: "$",
    baseFareCents: 250,       // $2.50
    perMeterCents: 0.15,      // ~$1.50/km
    minFareCents: 800,        // $8.00 minimum
    isWholeCurrency: false,
  },
  berlin: {
    currency: "EUR",
    currencySymbol: "€",
    baseFareCents: 200,       // €2.00
    perMeterCents: 0.12,      // ~€1.20/km
    minFareCents: 600,        // €6.00 minimum
    isWholeCurrency: false,
  },
  tokyo: {
    currency: "JPY",
    currencySymbol: "¥",
    baseFareCents: 410,       // ¥410 (stored as whole yen)
    perMeterCents: 0.23,      // ~¥230/km
    minFareCents: 730,        // ¥730 minimum
    isWholeCurrency: true,
  },
};

// Default to NYC if city not recognized
function getCityConfig(cityCode?: string): CityConfig {
  if (cityCode && cityCode in CITY_CONFIGS) {
    return CITY_CONFIGS[cityCode as CityCode];
  }
  return CITY_CONFIGS.nyc;
}

// Infer city from coordinates (rough bounding boxes)
function inferCityFromCoords(lat: number, lng: number): CityCode {
  // NYC: roughly 40.5-41.0, -74.3 to -73.7
  if (lat >= 40.5 && lat <= 41.0 && lng >= -74.3 && lng <= -73.7) {
    return "nyc";
  }
  // Berlin: roughly 52.3-52.7, 13.1-13.8
  if (lat >= 52.3 && lat <= 52.7 && lng >= 13.1 && lng <= 13.8) {
    return "berlin";
  }
  // Tokyo: roughly 35.5-35.9, 139.4-140.0
  if (lat >= 35.5 && lat <= 35.9 && lng >= 139.4 && lng <= 140.0) {
    return "tokyo";
  }
  return "nyc"; // Default
}

// ============================================
// MOCK DATA GENERATORS
// ============================================

const MOCK_DRIVERS = [
  {
    name: "Demo Driver Alex",
    rating: 4.9,
    vehicleMake: "Toyota",
    vehicleModel: "Camry",
    vehicleColor: "Silver",
    licensePlate: "DEMO-001",
  },
  {
    name: "Demo Driver Jordan",
    rating: 4.7,
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleColor: "Black",
    licensePlate: "DEMO-002",
  },
  {
    name: "Demo Driver Sam",
    rating: 4.8,
    vehicleMake: "Tesla",
    vehicleModel: "Model 3",
    vehicleColor: "White",
    licensePlate: "DEMO-003",
  },
];

const TIER_MULTIPLIERS = {
  economy: 1.0,
  comfort: 1.4,
  premium: 2.0,
};

const TIER_NAMES = {
  economy: "Economy (demo)",
  comfort: "Comfort (demo)",
  premium: "Premium (demo)",
};

function calculatePrice(
  distanceMeters: number,
  tier: "economy" | "comfort" | "premium",
  cityConfig: CityConfig
): number {
  const multiplier = TIER_MULTIPLIERS[tier];
  const rawPrice = cityConfig.baseFareCents + distanceMeters * cityConfig.perMeterCents;
  const price = Math.round(rawPrice * multiplier);
  return Math.max(price, cityConfig.minFareCents);
}

function formatPrice(cents: number, cityConfig: CityConfig): string {
  const { currencySymbol, isWholeCurrency } = cityConfig;
  
  if (isWholeCurrency) {
    // JPY - no decimal
    const low = cents;
    const high = Math.round(cents * 1.15);
    return `${currencySymbol}${low.toLocaleString()} - ${currencySymbol}${high.toLocaleString()}`;
  }
  
  // USD/EUR - with decimal
  const low = (cents / 100).toFixed(2);
  const high = ((cents * 1.15) / 100).toFixed(2);
  return `${currencySymbol}${low} - ${currencySymbol}${high}`;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function estimateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // Haversine formula for approximate distance
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Add 30% for road routing vs straight line
  return Math.round(R * c * 1.3);
}

// ============================================
// IN-MEMORY BOOKING STORAGE
// ============================================

interface BookingState {
  booking: RideBooking;
  statusProgressionIndex: number;
  lastUpdated: Date;
}

const bookingStore = new Map<string, BookingState>();
const quoteStore = new Map<string, RideQuote>();

// ============================================
// MOCK PROVIDER IMPLEMENTATION
// ============================================

export class MockRideProviderAdapter implements RideProviderAdapter {
  readonly providerId = "demo_provider";
  readonly providerName = "DEMO Provider";
  readonly isDemo = true;
  readonly capabilities = {
    realBooking: false, // DEMO — no real driver
    liveTracking: true, // Simulated tracking
    cancellation: true,
  };

  private readonly disclaimer =
    "This is a DEMO ride - no actual driver will arrive. For demonstration purposes only.";

  isAvailable(): boolean {
    return true; // Always available for demo
  }

  async getQuotes(request: QuoteRequest): Promise<RideQuote[]> {
    const distance = estimateDistance(
      request.pickupLat,
      request.pickupLng,
      request.dropoffLat,
      request.dropoffLng
    );

    // Determine city from coordinates for pricing
    const cityCode = inferCityFromCoords(request.pickupLat, request.pickupLng);
    const cityConfig = getCityConfig(cityCode);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 min expiry

    const tiers: Array<"economy" | "comfort" | "premium"> = [
      "economy",
      "comfort",
      "premium",
    ];

    const quotes: RideQuote[] = tiers.map((tier) => {
      const priceCents = calculatePrice(distance, tier, cityConfig);
      const quote: RideQuote = {
        id: randomUUID(),
        providerId: this.providerId,
        providerName: TIER_NAMES[tier],
        tier,
        priceEstimateCents: priceCents,
        currency: cityConfig.currency,
        priceDisplay: formatPrice(priceCents, cityConfig),
        pickupEtaMinutes: randomInt(3, 8) + (tier === "premium" ? 2 : 0),
        tripDurationMinutes: Math.max(5, Math.round(distance / 500)), // ~30km/h avg
        pickupLat: request.pickupLat,
        pickupLng: request.pickupLng,
        pickupAddress: request.pickupAddress,
        dropoffLat: request.dropoffLat,
        dropoffLng: request.dropoffLng,
        dropoffAddress: request.dropoffAddress,
        distanceMeters: distance,
        isDemo: true,
        demoDisclaimer: this.disclaimer,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
      };

      // Store quote for later retrieval
      quoteStore.set(quote.id, quote);

      return quote;
    });

    return quotes;
  }

  async requestRide(
    input: RideRequestInput,
    _quote: RideQuote  // Unused - we use stored quote for consistency
  ): Promise<RideBooking> {
    // Validate quote exists and hasn't expired
    const storedQuote = quoteStore.get(input.quoteId);
    if (!storedQuote) {
      throw new Error("Quote not found or expired");
    }

    if (new Date(storedQuote.expiresAt) < new Date()) {
      quoteStore.delete(input.quoteId);
      throw new Error("Quote has expired");
    }

    const now = new Date();
    const bookingId = randomUUID();

    // Use storedQuote data (not the passed quote) for consistency
    const booking: RideBooking = {
      id: bookingId,
      quoteId: storedQuote.id,
      providerId: this.providerId,
      providerName: this.providerName,
      providerBookingRef: `DEMO-${bookingId.slice(0, 8).toUpperCase()}`,
      status: "requested",
      statusMessage: "Looking for a driver...",
      priceCents: storedQuote.priceEstimateCents,
      currency: storedQuote.currency,
      priceDisplay: storedQuote.priceDisplay,
      pickupLat: storedQuote.pickupLat,
      pickupLng: storedQuote.pickupLng,
      pickupAddress: storedQuote.pickupAddress,
      dropoffLat: storedQuote.dropoffLat,
      dropoffLng: storedQuote.dropoffLng,
      dropoffAddress: storedQuote.dropoffAddress,
      distanceMeters: storedQuote.distanceMeters,
      tripId: input.tripId,
      stepIndex: input.stepIndex,
      isDemo: true,
      demoDisclaimer: this.disclaimer,
      requestedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Store booking state
    bookingStore.set(bookingId, {
      booking,
      statusProgressionIndex: 0,
      lastUpdated: now,
    });

    // Clean up used quote
    quoteStore.delete(input.quoteId);

    return booking;
  }

  async getStatus(bookingId: string): Promise<RideBooking> {
    const state = bookingStore.get(bookingId);
    if (!state) {
      throw new Error("Booking not found");
    }

    // Simulate status progression over time
    const updatedState = this.simulateStatusProgression(state);
    bookingStore.set(bookingId, updatedState);

    return updatedState.booking;
  }

  async cancelRide(bookingId: string): Promise<RideBooking> {
    const state = bookingStore.get(bookingId);
    if (!state) {
      throw new Error("Booking not found");
    }

    // Can only cancel before in_progress
    const cancellableStatuses: RideStatus[] = [
      "requested",
      "driver_assigned",
      "arriving",
    ];
    if (!cancellableStatuses.includes(state.booking.status)) {
      throw new Error(`Cannot cancel ride in status: ${state.booking.status}`);
    }

    const now = new Date();
    const updatedBooking: RideBooking = {
      ...state.booking,
      status: "cancelled",
      statusMessage: "Ride cancelled by user",
      cancelledAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    bookingStore.set(bookingId, {
      ...state,
      booking: updatedBooking,
    });

    return updatedBooking;
  }

  // ============================================
  // STATUS SIMULATION LOGIC
  // ============================================

  private simulateStatusProgression(state: BookingState): BookingState {
    const { booking, statusProgressionIndex, lastUpdated } = state;

    // Don't progress terminal statuses
    if (["completed", "cancelled", "failed"].includes(booking.status)) {
      return state;
    }

    const now = new Date();
    const elapsedSeconds = (now.getTime() - lastUpdated.getTime()) / 1000;

    // Progress every 3 seconds for smoother demo experience
    if (elapsedSeconds < 3) {
      return state;
    }

    const statusProgression: Array<{
      status: RideStatus;
      message: string;
      assignDriver?: boolean;
      updateLocation?: boolean;
    }> = [
      { status: "requested", message: "Looking for a driver..." },
      {
        status: "driver_assigned",
        message: "Driver is on the way!",
        assignDriver: true,
      },
      {
        status: "arriving",
        message: "Driver is arriving at pickup",
        updateLocation: true,
      },
      { status: "in_progress", message: "Ride in progress" },
      { status: "completed", message: "Ride completed. Thank you!" },
    ];

    const nextIndex = Math.min(
      statusProgressionIndex + 1,
      statusProgression.length - 1
    );
    const nextStatus = statusProgression[nextIndex];

    let updatedBooking: RideBooking = {
      ...booking,
      status: nextStatus.status,
      statusMessage: nextStatus.message,
      updatedAt: now.toISOString(),
    };

    // Assign a random demo driver
    if (nextStatus.assignDriver && !booking.driver) {
      const driver = MOCK_DRIVERS[randomInt(0, MOCK_DRIVERS.length - 1)];
      updatedBooking = {
        ...updatedBooking,
        driver,
        driverAssignedAt: now.toISOString(),
        etaMinutes: randomInt(3, 7),
      };
    }

    // Update driver location (moving toward pickup)
    if (nextStatus.updateLocation) {
      updatedBooking = {
        ...updatedBooking,
        driverLat: booking.pickupLat + (Math.random() - 0.5) * 0.001,
        driverLng: booking.pickupLng + (Math.random() - 0.5) * 0.001,
        etaMinutes: 1,
      };
    }

    // Set pickup time
    if (nextStatus.status === "in_progress") {
      updatedBooking.pickupAt = now.toISOString();
    }

    // Set dropoff time
    if (nextStatus.status === "completed") {
      updatedBooking.dropoffAt = now.toISOString();
    }

    return {
      booking: updatedBooking,
      statusProgressionIndex: nextIndex,
      lastUpdated: now,
    };
  }
}

// Singleton instance
let mockProviderInstance: MockRideProviderAdapter | null = null;

export function getMockRideProvider(): MockRideProviderAdapter {
  if (!mockProviderInstance) {
    mockProviderInstance = new MockRideProviderAdapter();
  }
  return mockProviderInstance;
}
