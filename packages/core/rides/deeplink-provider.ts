/**
 * DEEP LINK PROVIDER ADAPTER
 *
 * Represents a real-world ridehail provider where Routed can estimate
 * price/ETA but must hand off to the provider's app for actual booking.
 *
 * HONESTY: This provider CANNOT book rides in-app.
 * It generates quotes and deep links only.
 */

import { randomUUID } from "crypto";
import type {
  RideProviderAdapter,
  ProviderCapabilities,
  QuoteRequest,
  RideQuote,
  RideRequestInput,
  RideBooking,
} from "./types";

// ============================================
// CONFIGURATION
// ============================================

export interface DeepLinkProviderConfig {
  providerId: string;
  providerName: string;
  /** URL template with {pickupLat},{pickupLng},{dropoffLat},{dropoffLng} placeholders */
  deepLinkTemplate: string;
  /** Base fare in cents */
  baseFareCents: number;
  /** Cost per meter in cents */
  perMeterCents: number;
  /** Minimum fare in cents */
  minFareCents: number;
  /** Currency code (USD, EUR, JPY) */
  currency: string;
  /** Typical pickup ETA range [min, max] in minutes */
  pickupEtaRange: [number, number];
  /** Available tiers */
  tiers: Array<"economy" | "comfort" | "premium">;
  /** Tier price multipliers */
  tierMultipliers?: Record<string, number>;
}

// ============================================
// IMPLEMENTATION
// ============================================

export class DeepLinkProviderAdapter implements RideProviderAdapter {
  readonly providerId: string;
  readonly providerName: string;
  readonly isDemo = false; // Represents a real provider
  readonly capabilities: ProviderCapabilities;

  private readonly config: DeepLinkProviderConfig;

  constructor(config: DeepLinkProviderConfig) {
    this.config = config;
    this.providerId = config.providerId;
    this.providerName = config.providerName;
    this.capabilities = {
      realBooking: false, // Cannot book in-app
      liveTracking: false,
      cancellation: false,
      deepLinkTemplate: config.deepLinkTemplate,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  async getQuotes(request: QuoteRequest): Promise<RideQuote[]> {
    const distance = estimateDistance(
      request.pickupLat,
      request.pickupLng,
      request.dropoffLat,
      request.dropoffLng
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min expiry

    const defaultMultipliers: Record<string, number> = {
      economy: 1.0,
      comfort: 1.4,
      premium: 2.0,
    };
    const multipliers = this.config.tierMultipliers || defaultMultipliers;

    return this.config.tiers.map((tier) => {
      const mult = multipliers[tier] || 1.0;
      const rawPrice =
        this.config.baseFareCents +
        distance * this.config.perMeterCents;
      const priceCents = Math.max(
        Math.round(rawPrice * mult),
        this.config.minFareCents
      );

      const [etaMin, etaMax] = this.config.pickupEtaRange;
      const pickupEta =
        Math.floor(Math.random() * (etaMax - etaMin + 1)) + etaMin;

      const deepLink = this.buildDeepLink(request);

      return {
        id: randomUUID(),
        providerId: this.providerId,
        providerName: `${this.providerName} ${tier}`,
        tier,
        priceEstimateCents: priceCents,
        currency: this.config.currency,
        priceDisplay: formatPrice(priceCents, this.config.currency),
        pickupEtaMinutes: pickupEta,
        tripDurationMinutes: Math.max(5, Math.round(distance / 500)),
        pickupLat: request.pickupLat,
        pickupLng: request.pickupLng,
        pickupAddress: request.pickupAddress,
        dropoffLat: request.dropoffLat,
        dropoffLng: request.dropoffLng,
        dropoffAddress: request.dropoffAddress,
        distanceMeters: distance,
        isDemo: false,
        demoDisclaimer: undefined,
        // Store deep link in expiresAt field isn't ideal, but we'll
        // access it through the provider's capabilities.deepLinkTemplate
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
      } as RideQuote;
    });
  }

  async requestRide(
    _input: RideRequestInput,
    _quote: RideQuote
  ): Promise<RideBooking> {
    throw new Error(
      `${this.providerName} does not support in-app booking. ` +
      `Use the deep link to book through their app.`
    );
  }

  async getStatus(_bookingId: string): Promise<RideBooking> {
    throw new Error(
      `${this.providerName} does not support in-app status tracking.`
    );
  }

  async cancelRide(_bookingId: string): Promise<RideBooking> {
    throw new Error(
      `${this.providerName} does not support in-app cancellation.`
    );
  }

  /**
   * Build a deep link URL from the template and request coordinates.
   */
  buildDeepLink(request: QuoteRequest): string {
    return this.config.deepLinkTemplate
      .replace("{pickupLat}", String(request.pickupLat))
      .replace("{pickupLng}", String(request.pickupLng))
      .replace("{dropoffLat}", String(request.dropoffLat))
      .replace("{dropoffLng}", String(request.dropoffLng));
  }
}

// ============================================
// HELPERS
// ============================================

function estimateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1.3); // +30% for road routing
}

function formatPrice(cents: number, currency: string): string {
  if (currency === "JPY") {
    const low = cents;
    const high = Math.round(cents * 1.15);
    return `¥${low.toLocaleString()} - ¥${high.toLocaleString()}`;
  }
  const symbol = currency === "EUR" ? "€" : "$";
  const low = (cents / 100).toFixed(2);
  const high = ((cents * 1.15) / 100).toFixed(2);
  return `${symbol}${low} - ${symbol}${high}`;
}
