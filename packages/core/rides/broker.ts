/**
 * RIDE BROKER SERVICE
 *
 * Aggregates quotes from multiple providers and manages ride lifecycle.
 * Acts as the main entry point for the ride request system.
 */

import type {
  RideProviderAdapter,
  QuoteRequest,
  QuoteAggregation,
  RideQuote,
  RideRequestInput,
  RideBooking,
  RideScoringContext,
  ScoredQuote,
} from "./types";
import { getMockRideProvider } from "./mock-provider";

// ============================================
// BROKER IMPLEMENTATION
// ============================================

export class RideBroker {
  private providers: RideProviderAdapter[] = [];
  private quoteProviderMap = new Map<string, string>(); // quoteId -> providerId

  constructor() {
    // Register mock provider by default
    this.registerProvider(getMockRideProvider());
  }

  /**
   * Register a ride provider adapter
   */
  registerProvider(provider: RideProviderAdapter): void {
    if (this.providers.some((p) => p.providerId === provider.providerId)) {
      throw new Error(`Provider ${provider.providerId} already registered`);
    }
    this.providers.push(provider);
  }

  /**
   * Get available providers
   */
  getProviders(): Array<{
    id: string;
    name: string;
    isDemo: boolean;
    available: boolean;
  }> {
    return this.providers.map((p) => ({
      id: p.providerId,
      name: p.providerName,
      isDemo: p.isDemo,
      available: p.isAvailable(),
    }));
  }

  /**
   * Aggregate quotes from all available providers
   */
  async getQuotes(request: QuoteRequest): Promise<QuoteAggregation> {
    const availableProviders = this.providers.filter((p) => p.isAvailable());

    if (availableProviders.length === 0) {
      return {
        quotes: [],
        providers: [],
        errors: [{ providerId: "all", error: "No providers available" }],
        fetchedAt: new Date().toISOString(),
      };
    }

    const results = await Promise.allSettled(
      availableProviders.map((p) => p.getQuotes(request))
    );

    const quotes: RideQuote[] = [];
    const errors: Array<{ providerId: string; error: string }> = [];
    const providerIds: string[] = [];

    results.forEach((result, index) => {
      const provider = availableProviders[index];
      providerIds.push(provider.providerId);

      if (result.status === "fulfilled") {
        result.value.forEach((quote) => {
          quotes.push(quote);
          this.quoteProviderMap.set(quote.id, provider.providerId);
        });
      } else {
        errors.push({
          providerId: provider.providerId,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });

    // Sort by price for comparison
    const sortedByPrice = [...quotes].sort(
      (a, b) => a.priceEstimateCents - b.priceEstimateCents
    );
    const sortedByEta = [...quotes].sort(
      (a, b) => a.pickupEtaMinutes - b.pickupEtaMinutes
    );

    // Score and select best if scoring context provided
    const aggregation: QuoteAggregation = {
      quotes,
      providers: providerIds,
      cheapest: sortedByPrice[0],
      fastest: sortedByEta[0],
      errors,
      fetchedAt: new Date().toISOString(),
    };

    return aggregation;
  }

  /**
   * Get quotes with server-side provider selection.
   * Scores all quotes against the given context and returns the aggregation
   * with a `selected` field indicating the best choice.
   */
  async getQuotesWithSelection(
    request: QuoteRequest,
    scoringCtx: RideScoringContext = {}
  ): Promise<QuoteAggregation> {
    const aggregation = await this.getQuotes(request);

    if (aggregation.quotes.length === 0) {
      return aggregation;
    }

    const scored = scoreQuotes(aggregation.quotes, scoringCtx);
    aggregation.selected = scored[0]; // highest score first

    return aggregation;
  }

  /**
   * Request a ride using a quote.
   * Enforces honesty: rejects if provider has capabilities.realBooking === false.
   */
  async requestRide(input: RideRequestInput): Promise<RideBooking> {
    const providerId = this.quoteProviderMap.get(input.quoteId);
    if (!providerId) {
      throw new Error("Quote not found or expired");
    }

    const provider = this.providers.find((p) => p.providerId === providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    if (!provider.isAvailable()) {
      throw new Error(`Provider ${providerId} is not available`);
    }

    // Honesty gate: provider must support real booking
    if (!provider.capabilities.realBooking && !provider.isDemo) {
      throw new Error(
        `Provider ${provider.providerName} does not support in-app booking. ` +
        `Use the deep link to book directly.`
      );
    }

    // Get the quote to pass to provider
    // Note: The provider stores quotes internally, so we create a minimal quote object
    const minimalQuote = {
      id: input.quoteId,
    } as RideQuote;

    const booking = await provider.requestRide(input, minimalQuote);

    // Store provider mapping for future status/cancel calls
    this.quoteProviderMap.set(booking.id, providerId);

    return booking;
  }

  /**
   * Get status of a booking
   */
  async getBookingStatus(bookingId: string): Promise<RideBooking> {
    // Try to find which provider owns this booking
    const providerId = this.quoteProviderMap.get(bookingId);

    if (providerId) {
      const provider = this.providers.find((p) => p.providerId === providerId);
      if (provider) {
        return provider.getStatus(bookingId);
      }
    }

    // If not found in map, try all providers
    for (const provider of this.providers) {
      try {
        const booking = await provider.getStatus(bookingId);
        this.quoteProviderMap.set(bookingId, provider.providerId);
        return booking;
      } catch {
        // Continue to next provider
      }
    }

    throw new Error("Booking not found");
  }

  /**
   * Cancel a booking
   */
  async cancelBooking(bookingId: string): Promise<RideBooking> {
    const providerId = this.quoteProviderMap.get(bookingId);

    if (providerId) {
      const provider = this.providers.find((p) => p.providerId === providerId);
      if (provider) {
        return provider.cancelRide(bookingId);
      }
    }

    // Try all providers if not found in map
    for (const provider of this.providers) {
      try {
        const booking = await provider.cancelRide(bookingId);
        return booking;
      } catch {
        // Continue to next provider
      }
    }

    throw new Error("Booking not found");
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let brokerInstance: RideBroker | null = null;

export function getRideBroker(): RideBroker {
  if (!brokerInstance) {
    brokerInstance = new RideBroker();
  }
  return brokerInstance;
}

export function createRideBroker(): RideBroker {
  return new RideBroker();
}

// ============================================
// SCORING POLICY
// ============================================

/**
 * Score quotes based on user context.
 * Higher score = better fit. Returns sorted (best first).
 */
export function scoreQuotes(
  quotes: RideQuote[],
  ctx: RideScoringContext = {}
): ScoredQuote[] {
  if (quotes.length === 0) return [];

  // Find price extremes for normalization
  const prices = quotes.map((q) => q.priceEstimateCents);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const etas = quotes.map((q) => q.pickupEtaMinutes);
  const minEta = Math.min(...etas);
  const maxEta = Math.max(...etas);
  const etaRange = maxEta - minEta || 1;

  const scored: ScoredQuote[] = quotes.map((quote) => {
    let score = 100;
    const reasons: string[] = [];

    // === PRICE (0-30 points for cheapest) ===
    const priceNorm = (quote.priceEstimateCents - minPrice) / priceRange;
    const priceScore = Math.round(30 * (1 - priceNorm));
    score += priceScore;
    if (priceNorm === 0 && quotes.length > 1) {
      reasons.push("cheapest");
    }

    // === PICKUP ETA (0-20 points for fastest) ===
    const etaNorm = (quote.pickupEtaMinutes - minEta) / etaRange;
    const etaScore = Math.round(20 * (1 - etaNorm));
    score += etaScore;
    if (etaNorm === 0 && quotes.length > 1) {
      reasons.push("fastest pickup");
    }

    // === MAX PRICE CONSTRAINT ===
    if (ctx.maxPriceCents && quote.priceEstimateCents > ctx.maxPriceCents) {
      score -= 50;
      reasons.push("over budget");
    }

    // === MAX PICKUP ETA CONSTRAINT ===
    if (ctx.maxPickupEtaMin && quote.pickupEtaMinutes > ctx.maxPickupEtaMin) {
      score -= 30;
      reasons.push("slow pickup");
    }

    // === DATE CONTEXT — reliability + comfort > price ===
    if (ctx.isDateContext) {
      // Penalize price importance
      score -= Math.round(priceScore * 0.5);
      // Boost premium/comfort tiers
      if (quote.tier === "premium") {
        score += 25;
        reasons.push("premium for date");
      } else if (quote.tier === "comfort") {
        score += 15;
        reasons.push("comfort for date");
      }
      // Penalize long wait
      if (quote.pickupEtaMinutes > 5) {
        score -= 15;
        reasons.push("long wait (date)");
      }
    }

    // === COMFORT PREFERENCE ===
    if (ctx.preferComfort) {
      if (quote.tier === "premium") {
        score += 35;
        reasons.push("comfort preference");
      } else if (quote.tier === "comfort") {
        score += 20;
        reasons.push("comfort preference");
      }
      // Reduce price importance when comfort is preferred
      score -= Math.round(priceScore * 0.4);
    }

    // === RELIABILITY PREFERENCE ===
    if (ctx.preferReliability) {
      // Shorter ETA = more reliable (driver is nearby)
      if (quote.pickupEtaMinutes <= 3) {
        score += 15;
        reasons.push("reliable (short ETA)");
      }
    }

    return { quote, score, reasons };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
