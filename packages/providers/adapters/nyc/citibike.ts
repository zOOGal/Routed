/**
 * CITI BIKE ADAPTER — NYC Bike Share
 *
 * Provider adapter for Citi Bike in NYC
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, BikeUnlock } from "../../../core/entitlements/types";

export class CitiBikeAdapter extends BaseProviderAdapter {
  id = "citibike";
  name = "Citi Bike";
  displayName = "Citi Bike";
  type = "bike" as const;
  cityCode = "nyc" as const;
  logoEmoji = "🚴";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // Citi Bike app link
    const params = new URLSearchParams();

    if (request.origin.lat && request.origin.lng) {
      params.set("start_lat", request.origin.lat.toString());
      params.set("start_lng", request.origin.lng.toString());
    }
    if (request.destination.lat && request.destination.lng) {
      params.set("end_lat", request.destination.lat.toString());
      params.set("end_lng", request.destination.lng.toString());
    }

    const webUrl = `https://citibikenyc.com/app?${params.toString()}`;

    return {
      url: webUrl,
      label: "Open Citi Bike",
      execution: {
        type: "deeplink",
        url: webUrl,
        label: "Find a Citi Bike",
      },
    };
  }

  getSystemMapLink() {
    return {
      url: "https://citibikenyc.com/map",
      label: "Citi Bike Station Map",
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    // Citi Bike pricing: $4.99 single ride, first 30 min included
    if (request.durationMin <= 30) {
      return {
        coverage: "pay",
        costLabel: "Single ride",
        isVerified: false,
      };
    }
    return {
      coverage: "pay",
      costLabel: "Extended ride",
      isVerified: false,
    };
  }

  protected applyEntitlementToFare(
    request: FareEstimateRequest,
    entitlement: Entitlement
  ): FareEstimateResult {
    if (entitlement.type !== "bike_unlock") {
      return this.getDefaultFareEstimate(request);
    }

    const bikeBenefit = entitlement as BikeUnlock;
    const hasUnlocks = (bikeBenefit.remainingUnlocksToday ?? 0) > 0;
    const hasMinutes = (bikeBenefit.remainingMinutesToday ?? 0) > 0;

    if (hasUnlocks) {
      let label = `${bikeBenefit.remainingUnlocksToday} free unlocks today`;
      if (hasMinutes && request.durationMin <= (bikeBenefit.remainingMinutesToday ?? 0)) {
        label = "Free ride with pass";
      }

      return {
        coverage: "included",
        costLabel: bikeBenefit.isVerified ? label : `${label} (verify in app)`,
        benefitApplied: "Pass bike benefit",
        isVerified: bikeBenefit.isVerified,
      };
    }

    if (hasMinutes && request.durationMin <= (bikeBenefit.remainingMinutesToday ?? 0)) {
      return {
        coverage: "included",
        costLabel: bikeBenefit.isVerified
          ? `${bikeBenefit.remainingMinutesToday} free min today`
          : "Free minutes available",
        benefitApplied: "Pass bike benefit",
        isVerified: bikeBenefit.isVerified,
      };
    }

    return this.getDefaultFareEstimate(request);
  }
}

export const citiBikeAdapter = new CitiBikeAdapter();
