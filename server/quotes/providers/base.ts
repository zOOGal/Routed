/**
 * BASE QUOTE PROVIDER
 *
 * Abstract base class for ridehail quote providers.
 */

import type {
  Quote,
  QuoteRequest,
  QuoteProviderAdapter,
  ProviderCapabilities,
  Location,
  CityCode,
  Currency,
} from "../types";
import { CITY_CURRENCY } from "../types";
import {
  calculateDistance,
  estimateTripDuration,
  getPickupEta,
  isRushHour,
  isNightTime,
  TAXI_METER_RULES,
} from "../city-pricing";

export abstract class BaseQuoteProvider implements QuoteProviderAdapter {
  abstract id: string;
  abstract name: string;
  abstract type: "taxi" | "ridehail_economy" | "ridehail_premium";
  abstract cityCode: CityCode;

  capabilities: ProviderCapabilities = {
    canGetQuote: true,
    canGetDeepLink: true,
    canCreateBooking: false, // PoC - no booking
    supportsScheduled: false,
    supportsShared: false,
  };

  abstract getQuote(request: QuoteRequest): Promise<Quote | null>;
  abstract getDeepLink(origin: Location, destination: Location): string | null;

  protected getCurrency(): Currency {
    return CITY_CURRENCY[this.cityCode];
  }

  protected getCurrentHour(): number {
    return new Date().getHours();
  }

  protected calculateTripMetrics(request: QuoteRequest): {
    distanceKm: number;
    isRushHourNow: boolean;
    isNightNow: boolean;
    tripDurationMin: number;
    pickupEtaMin: number;
  } {
    const distanceKm = calculateDistance(request.origin, request.destination);
    const hour = this.getCurrentHour();
    const meterRules = TAXI_METER_RULES[this.cityCode];

    // Simplified rush hour check
    const isRushHourNow = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 19);
    const isNightNow = isNightTime(hour, meterRules);

    const tripDurationMin = estimateTripDuration(distanceKm, this.cityCode, isRushHourNow);
    const pickupEtaMin = getPickupEta(this.cityCode, isRushHourNow, isNightNow);

    return {
      distanceKm,
      isRushHourNow,
      isNightNow,
      tripDurationMin,
      pickupEtaMin,
    };
  }

  protected applyEntitlementDiscount(
    price: number,
    request: QuoteRequest
  ): number {
    const entitlement = request.userEntitlements?.find(
      (e) => e.providerId === this.id
    );
    if (entitlement?.discountPercent) {
      return Math.round(price * (1 - entitlement.discountPercent / 100));
    }
    return price;
  }

  protected addPriceVariance(basePrice: number): { min: number; max: number } {
    // Add ±10% variance for estimate range
    const variance = 0.10;
    return {
      min: Math.round(basePrice * (1 - variance)),
      max: Math.round(basePrice * (1 + variance)),
    };
  }
}
