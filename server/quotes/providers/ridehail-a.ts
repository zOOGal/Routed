/**
 * RIDEHAIL A PROVIDER (Economy)
 *
 * Mock economy ridehail provider (like UberX/Lyft).
 * Uses distance + surge factor pricing model.
 *
 * DO NOT claim this is real Uber/Lyft pricing!
 */

import { BaseQuoteProvider } from "./base";
import type { Quote, QuoteRequest, Location, CityCode } from "../types";
import { RIDEHAIL_A_PRICING, isRushHour } from "../city-pricing";

export class RidehailAProvider extends BaseQuoteProvider {
  id: string;
  name = "Economy Ride";
  type = "ridehail_economy" as const;
  cityCode: CityCode;

  constructor(cityCode: CityCode) {
    super();
    this.cityCode = cityCode;
    this.id = `ridehail-economy-${cityCode}`;
  }

  async getQuote(request: QuoteRequest): Promise<Quote | null> {
    if (request.cityCode !== this.cityCode) {
      return null;
    }

    const metrics = this.calculateTripMetrics(request);
    const pricing = RIDEHAIL_A_PRICING[this.cityCode];
    const currency = this.getCurrency();

    // Calculate base fare
    let fare = pricing.baseFare + pricing.bookingFee;
    fare += metrics.distanceKm * pricing.perKmRate;
    fare += metrics.tripDurationMin * pricing.perMinRate;

    // Apply surge multiplier
    let surgeMultiplier = pricing.defaultSurgeMultiplier;
    const hour = this.getCurrentHour();
    if (isRushHour(hour, pricing)) {
      surgeMultiplier = pricing.rushHourSurgeMultiplier;
    }
    fare = fare * surgeMultiplier;

    // Ensure minimum fare
    fare = Math.max(fare, pricing.minimumFare);

    // Apply entitlement discount
    fare = this.applyEntitlementDiscount(fare, request);

    // Round appropriately
    fare = Math.round(fare);

    const priceRange = this.addPriceVariance(fare);

    // Ridehail typically has faster pickup than taxi
    const pickupEta = Math.max(2, metrics.pickupEtaMin - 1);

    // Determine availability confidence
    let availabilityConfidence: "high" | "medium" | "low" = "high";
    if (metrics.isNightNow) {
      availabilityConfidence = "medium";
    }
    if (surgeMultiplier > 1.3) {
      // High surge = lower confidence in price
      availabilityConfidence = "medium";
    }

    const tags: Quote["tags"] = [];
    // Economy rides are usually cheapest
    tags.push("cheapest");
    if (pickupEta <= 3) {
      tags.push("fastest_pickup");
    }

    return {
      providerId: this.id,
      providerName: this.name,
      providerType: this.type,
      mode: "ridehail",
      price: {
        min: priceRange.min,
        max: priceRange.max,
        currency,
        confidence: surgeMultiplier > 1.2 ? "low" : "medium",
        isEstimate: true,
      },
      pickupEtaMin: pickupEta,
      tripEtaMin: metrics.tripDurationMin,
      availabilityConfidence,
      execution: this.buildExecution(request.origin, request.destination),
      tags,
      debug: {
        distanceKm: metrics.distanceKm,
        surgeMultiplier,
        pricingModel: "distance_surge",
      },
    };
  }

  getDeepLink(origin: Location, destination: Location): string | null {
    // Generic ridehail deep link format
    const params = new URLSearchParams();
    params.set("pickup_lat", origin.lat.toString());
    params.set("pickup_lng", origin.lng.toString());
    params.set("dropoff_lat", destination.lat.toString());
    params.set("dropoff_lng", destination.lng.toString());

    // Use a generic web URL for PoC
    return `https://ride.example.com/request?${params.toString()}`;
  }

  private buildExecution(origin: Location, destination: Location): Quote["execution"] {
    const deepLink = this.getDeepLink(origin, destination);
    if (deepLink) {
      return {
        type: "deeplink",
        url: deepLink,
        label: "Open ride app",
      };
    }
    return {
      type: "unavailable",
      label: "Not available",
    };
  }
}

// Factory function to create economy ridehail providers for all cities
export function createRidehailAProviders(): RidehailAProvider[] {
  return [
    new RidehailAProvider("nyc"),
    new RidehailAProvider("berlin"),
    new RidehailAProvider("tokyo"),
  ];
}
