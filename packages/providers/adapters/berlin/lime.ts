/**
 * LIME ADAPTER — Berlin Bike/Scooter Share
 *
 * Provider adapter for Lime in Berlin
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, BikeUnlock } from "../../../core/entitlements/types";

export class LimeBerlinAdapter extends BaseProviderAdapter {
  id = "lime-berlin";
  name = "Lime";
  displayName = "Lime";
  type = "bike" as const;
  cityCode = "berlin" as const;
  logoEmoji = "🛴";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // Lime deep link
    const params = new URLSearchParams();

    if (request.origin.lat && request.origin.lng) {
      params.set("lat", request.origin.lat.toString());
      params.set("lng", request.origin.lng.toString());
    }

    const webUrl = `https://li.me/ride?${params.toString()}`;

    return {
      url: webUrl,
      label: "Open Lime",
      execution: {
        type: "deeplink",
        url: webUrl,
        label: "Find a Lime",
      },
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    // Lime pricing: €1 unlock + €0.25/min
    if (request.durationMin <= 15) {
      return {
        coverage: "pay",
        costLabel: "Short ride",
        isVerified: false,
      };
    }
    return {
      coverage: "pay",
      costLabel: "Standard ride",
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

export const limeBerlinAdapter = new LimeBerlinAdapter();
