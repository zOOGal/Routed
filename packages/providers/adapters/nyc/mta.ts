/**
 * MTA ADAPTER — NYC Transit
 *
 * Provider adapter for MTA (Subway, Bus)
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, TransitPass } from "../../../core/entitlements/types";

export class MTAAdapter extends BaseProviderAdapter {
  id = "mta";
  name = "MTA";
  displayName = "NYC Subway & Bus";
  type = "transit" as const;
  cityCode = "nyc" as const;
  logoEmoji = "🚇";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // MTA doesn't have a great deep link, but we can link to their trip planner
    const origin = encodeURIComponent(request.origin.name);
    const dest = encodeURIComponent(request.destination.name);

    // Try to use coordinates if available for better accuracy
    let url: string;
    if (request.origin.lat && request.origin.lng && request.destination.lat && request.destination.lng) {
      url = `https://new.mta.info/trip-planner?from=${request.origin.lat},${request.origin.lng}&to=${request.destination.lat},${request.destination.lng}`;
    } else {
      url = `https://new.mta.info/trip-planner?from=${origin}&to=${dest}`;
    }

    return {
      url,
      label: "View on MTA",
      execution: {
        type: "system_map",
        url,
        label: "MTA Trip Planner",
      },
    };
  }

  getSystemMapLink() {
    return {
      url: "https://new.mta.info/map",
      label: "NYC Subway Map",
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    // NYC has flat fare of $2.90
    return {
      coverage: "pay",
      costLabel: "$2.90 fare",
      isVerified: false,
    };
  }

  protected applyEntitlementToFare(
    request: FareEstimateRequest,
    entitlement: Entitlement
  ): FareEstimateResult {
    if (entitlement.type !== "transit_pass") {
      return this.getDefaultFareEstimate(request);
    }

    const transitPass = entitlement as TransitPass;

    if (transitPass.unlimited) {
      return {
        coverage: "included",
        costLabel: transitPass.isVerified ? "Covered by pass" : "Eligible (verify pass)",
        benefitApplied: "Unlimited MetroCard",
        isVerified: transitPass.isVerified,
      };
    }

    return this.getDefaultFareEstimate(request);
  }
}

export const mtaAdapter = new MTAAdapter();
