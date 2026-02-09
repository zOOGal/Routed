/**
 * BVG ADAPTER — Berlin Transit
 *
 * Provider adapter for BVG (U-Bahn, S-Bahn, Tram, Bus)
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, TransitPass } from "../../../core/entitlements/types";

export class BVGAdapter extends BaseProviderAdapter {
  id = "bvg";
  name = "BVG";
  displayName = "Berlin Transit";
  type = "transit" as const;
  cityCode = "berlin" as const;
  logoEmoji = "🚇";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // BVG Fahrinfo app / web
    const origin = encodeURIComponent(request.origin.name);
    const dest = encodeURIComponent(request.destination.name);

    const url = `https://fahrinfo.bvg.de/Fahrinfo/bin/query.bin/dn?from=${origin}&to=${dest}`;

    return {
      url,
      label: "View on BVG",
      execution: {
        type: "system_map",
        url,
        label: "BVG Journey Planner",
      },
    };
  }

  getSystemMapLink() {
    return {
      url: "https://www.bvg.de/de/verbindungen/liniennetz",
      label: "Berlin Transit Map",
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    // Berlin has zone-based pricing, AB is €3.20
    return {
      coverage: "pay",
      costLabel: "Standard fare (€3.20 AB)",
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
        benefitApplied: "Berlin transit pass",
        isVerified: transitPass.isVerified,
      };
    }

    return this.getDefaultFareEstimate(request);
  }
}

export const bvgAdapter = new BVGAdapter();
