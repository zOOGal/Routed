/**
 * UBER ADAPTER — NYC Ridehail
 *
 * Provider adapter for Uber in NYC
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, RidehailDiscount } from "../../../core/entitlements/types";

export class UberNYCAdapter extends BaseProviderAdapter {
  id = "uber-nyc";
  name = "Uber";
  displayName = "Uber";
  type = "ridehail" as const;
  cityCode = "nyc" as const;
  logoEmoji = "🚙";

  capabilities = {
    supportsActivationApi: false, // Would need Uber API integration
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false, // Would need Uber API for live prices
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // Uber universal link format
    const params = new URLSearchParams();

    if (request.origin.lat && request.origin.lng) {
      params.set("pickup[latitude]", request.origin.lat.toString());
      params.set("pickup[longitude]", request.origin.lng.toString());
    }
    if (request.destination.lat && request.destination.lng) {
      params.set("dropoff[latitude]", request.destination.lat.toString());
      params.set("dropoff[longitude]", request.destination.lng.toString());
    }

    // Use nickname as fallback
    if (request.origin.name) {
      params.set("pickup[nickname]", request.origin.name);
    }
    if (request.destination.name) {
      params.set("dropoff[nickname]", request.destination.name);
    }

    const url = `uber://?action=setPickup&${params.toString()}`;
    const webUrl = `https://m.uber.com/ul/?${params.toString()}`;

    return {
      url: webUrl, // Use web URL as primary (works on all devices)
      label: "Open Uber",
      execution: {
        type: "deeplink",
        url: webUrl,
        label: "Request Uber",
      },
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
    // We don't show exact prices without API integration
    // Categorize by distance
    const distanceKm = request.distanceM / 1000;

    if (distanceKm < 3) {
      return {
        coverage: "pay",
        costLabel: "Short ride",
        isVerified: false,
      };
    }
    if (distanceKm < 8) {
      return {
        coverage: "pay",
        costLabel: "Medium ride",
        isVerified: false,
      };
    }
    return {
      coverage: "pay",
      costLabel: "Longer ride",
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

export const uberNYCAdapter = new UberNYCAdapter();
