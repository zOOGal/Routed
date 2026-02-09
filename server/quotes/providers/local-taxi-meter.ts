/**
 * LOCAL TAXI METER PROVIDER
 *
 * Estimates taxi fares using static meter rules.
 * This is a PoC - not real-time prices.
 */

import { BaseQuoteProvider } from "./base";
import type { Quote, QuoteRequest, Location, CityCode } from "../types";
import { TAXI_METER_RULES, isNightTime } from "../city-pricing";

export class LocalTaxiMeterProvider extends BaseQuoteProvider {
  id: string;
  name = "Local Taxi";
  type = "taxi" as const;
  cityCode: CityCode;

  constructor(cityCode: CityCode) {
    super();
    this.cityCode = cityCode;
    this.id = `local-taxi-${cityCode}`;
  }

  async getQuote(request: QuoteRequest): Promise<Quote | null> {
    if (request.cityCode !== this.cityCode) {
      return null;
    }

    const metrics = this.calculateTripMetrics(request);
    const rules = TAXI_METER_RULES[this.cityCode];
    const currency = this.getCurrency();

    // Calculate fare using meter rules
    let fare = rules.baseFare;
    fare += metrics.distanceKm * rules.perKmRate;
    fare += metrics.tripDurationMin * rules.perMinRate;

    // Apply night surcharge if applicable
    if (rules.nightSurcharge && metrics.isNightNow) {
      fare = fare * (1 + rules.nightSurcharge / 100);
    }

    // Ensure minimum fare
    fare = Math.max(fare, rules.minimumFare);

    // Apply entitlement discount
    fare = this.applyEntitlementDiscount(fare, request);

    // Round appropriately
    fare = Math.round(fare);

    const priceRange = this.addPriceVariance(fare);

    // Taxi pickup is usually slower than ridehail
    const pickupEta = metrics.pickupEtaMin + 2;

    // Determine availability confidence
    let availabilityConfidence: "high" | "medium" | "low" = "high";
    if (metrics.isNightNow) {
      availabilityConfidence = "medium";
    }

    const tags: Quote["tags"] = [];
    // Taxis are often most reliable for pickups
    tags.push("most_reliable");

    return {
      providerId: this.id,
      providerName: this.name,
      providerType: this.type,
      mode: "ridehail",
      price: {
        min: priceRange.min,
        max: priceRange.max,
        currency,
        confidence: "medium",
        isEstimate: true,
      },
      pickupEtaMin: pickupEta,
      tripEtaMin: metrics.tripDurationMin,
      availabilityConfidence,
      execution: {
        type: "hail", // Traditional taxis - hail on street or call
        label: "Hail taxi",
      },
      tags,
      debug: {
        distanceKm: metrics.distanceKm,
        pricingModel: "meter",
      },
    };
  }

  getDeepLink(origin: Location, destination: Location): string | null {
    // No deep link for traditional taxi - return null
    return null;
  }
}

// Factory function to create taxi providers for all cities
export function createTaxiProviders(): LocalTaxiMeterProvider[] {
  return [
    new LocalTaxiMeterProvider("nyc"),
    new LocalTaxiMeterProvider("berlin"),
    new LocalTaxiMeterProvider("tokyo"),
  ];
}
