/**
 * SUICA/JR ADAPTER — Tokyo Transit
 *
 * Provider adapter for JR/Metro in Tokyo
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, TransitPass } from "../../../core/entitlements/types";

export class SuicaAdapter extends BaseProviderAdapter {
  id = "suica";
  name = "Suica/JR";
  displayName = "Tokyo Rail & Metro";
  type = "transit" as const;
  cityCode = "tokyo" as const;
  logoEmoji = "🚃";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // Use JR East route finder
    const origin = encodeURIComponent(request.origin.name);
    const dest = encodeURIComponent(request.destination.name);

    const url = `https://www.jreast.co.jp/multi/en/routemap/?from=${origin}&to=${dest}`;

    return {
      url,
      label: "View on JR East",
      execution: {
        type: "system_map",
        url,
        label: "JR Route Finder",
      },
    };
  }

  getSystemMapLink() {
    return {
      url: "https://www.tokyometro.jp/en/subwaymap/",
      label: "Tokyo Metro Map",
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    // Tokyo has distance-based pricing, typically ¥140-¥320
    return {
      coverage: "pay",
      costLabel: "Distance-based fare",
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
        benefitApplied: "Tokyo transit pass",
        isVerified: transitPass.isVerified,
      };
    }

    return this.getDefaultFareEstimate(request);
  }
}

export const suicaAdapter = new SuicaAdapter();
