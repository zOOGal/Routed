/**
 * DOCOMO BIKE ADAPTER — Tokyo Bike Share
 *
 * Provider adapter for Docomo Bike Share in Tokyo
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, BikeUnlock } from "../../../core/entitlements/types";

export class DocomoBikeAdapter extends BaseProviderAdapter {
  id = "docomo-bike";
  name = "Docomo Bike";
  displayName = "Docomo Bike Share";
  type = "bike" as const;
  cityCode = "tokyo" as const;
  logoEmoji = "🚲";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // Docomo Bike web app
    const webUrl = "https://docomo-cycle.jp/";

    return {
      url: webUrl,
      label: "Open Docomo Bike",
      execution: {
        type: "deeplink",
        url: webUrl,
        label: "Find a Docomo Bike",
      },
    };
  }

  getSystemMapLink() {
    return {
      url: "https://docomo-cycle.jp/tokyo/area/",
      label: "Docomo Bike Stations",
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    // Docomo pricing: ¥165 per 30 min
    if (request.durationMin <= 30) {
      return {
        coverage: "pay",
        costLabel: "¥165 (30 min)",
        isVerified: false,
      };
    }
    return {
      coverage: "pay",
      costLabel: "Per-30-min pricing",
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

export const docomoBikeAdapter = new DocomoBikeAdapter();
