/**
 * RIDEHAIL B PROVIDER (Premium/Comfort)
 *
 * Mock premium ridehail provider (like Uber Comfort/Black).
 * Higher base price, lower surge, more reliable pickup.
 *
 * DO NOT claim this is real pricing!
 */

import { BaseQuoteProvider } from "./base";
import type { Quote, QuoteRequest, Location, CityCode } from "../types";
import { RIDEHAIL_B_PRICING, isRushHour } from "../city-pricing";

export class RidehailBProvider extends BaseQuoteProvider {
  id: string;
  name = "Comfort Ride";
  type = "ridehail_premium" as const;
  cityCode: CityCode;

  constructor(cityCode: CityCode) {
    super();
    this.cityCode = cityCode;
    this.id = `ridehail-comfort-${cityCode}`;
  }

  async getQuote(request: QuoteRequest): Promise<Quote | null> {
    if (request.cityCode !== this.cityCode) {
      return null;
    }

    const metrics = this.calculateTripMetrics(request);
    const pricing = RIDEHAIL_B_PRICING[this.cityCode];
    const currency = this.getCurrency();

    // Calculate base fare
    let fare = pricing.baseFare + pricing.bookingFee;
    fare += metrics.distanceKm * pricing.perKmRate;
    fare += metrics.tripDurationMin * pricing.perMinRate;

    // Apply surge multiplier (lower for premium)
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

    // Premium has slightly longer pickup (nicer cars, fewer drivers)
    const pickupEta = metrics.pickupEtaMin + 1;

    // Premium is generally more reliable
    let availabilityConfidence: "high" | "medium" | "low" = "high";
    if (metrics.isNightNow && this.cityCode === "tokyo") {
      // Less premium availability late night in Tokyo
      availabilityConfidence = "medium";
    }

    const tags: Quote["tags"] = [];
    tags.push("premium");
    // Premium is usually most reliable for important trips
    if (request.constraints?.isDateContext || request.constraints?.preferComfort) {
      tags.push("most_reliable");
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
        confidence: "medium", // Premium pricing is more stable
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
        pricingModel: "premium_distance",
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
    params.set("product", "comfort");

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

// Factory function to create premium ridehail providers for all cities
export function createRidehailBProviders(): RidehailBProvider[] {
  return [
    new RidehailBProvider("nyc"),
    new RidehailBProvider("berlin"),
    new RidehailBProvider("tokyo"),
  ];
}
