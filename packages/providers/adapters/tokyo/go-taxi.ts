/**
 * GO TAXI ADAPTER — Tokyo Ridehail
 *
 * Provider adapter for GO Taxi in Tokyo
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, RidehailDiscount } from "../../../core/entitlements/types";

export class GoTaxiAdapter extends BaseProviderAdapter {
  id = "go-taxi";
  name = "GO Taxi";
  displayName = "GO Taxi";
  type = "ridehail" as const;
  cityCode = "tokyo" as const;
  logoEmoji = "🚕";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // GO Taxi app link
    const params = new URLSearchParams();

    if (request.origin.lat && request.origin.lng) {
      params.set("pickup_lat", request.origin.lat.toString());
      params.set("pickup_lng", request.origin.lng.toString());
    }
    if (request.destination.lat && request.destination.lng) {
      params.set("dest_lat", request.destination.lat.toString());
      params.set("dest_lng", request.destination.lng.toString());
    }

    const webUrl = `https://go.mo-t.com/ride?${params.toString()}`;

    return {
      url: webUrl,
      label: "Open GO Taxi",
      execution: {
        type: "deeplink",
        url: webUrl,
        label: "Request GO Taxi",
      },
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    const distanceKm = request.distanceM / 1000;

    // Tokyo taxi is expensive
    if (distanceKm < 2) {
      return {
        coverage: "pay",
        costLabel: "Short taxi ride",
        isVerified: false,
      };
    }
    if (distanceKm < 5) {
      return {
        coverage: "pay",
        costLabel: "Medium taxi ride",
        isVerified: false,
      };
    }
    return {
      coverage: "pay",
      costLabel: "Longer taxi ride",
      isVerified: false,
    };
  }

  protected applyEntitlementToFare(
    request: FareEstimateRequest,
    entitlement: Entitlement
  ): FareEstimateResult {
    if (entitlement.type !== "ridehail_discount") {
      return this.getDefaultFareEstimate(request);
    }

    const discount = entitlement as RidehailDiscount;

    return {
      coverage: "discounted",
      costLabel: discount.isVerified
        ? `${discount.percentOff}% off with pass`
        : `Eligible for ${discount.percentOff}% off`,
      discountPercent: discount.percentOff,
      benefitApplied: "Pass discount",
      isVerified: discount.isVerified,
    };
  }
}

export const goTaxiAdapter = new GoTaxiAdapter();
