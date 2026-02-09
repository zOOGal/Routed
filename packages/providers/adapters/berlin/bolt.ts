/**
 * BOLT ADAPTER — Berlin Ridehail
 *
 * Provider adapter for Bolt in Berlin
 */

import type { DeepLinkRequest, DeepLinkResult, FareEstimateRequest, FareEstimateResult } from "../../types";
import { BaseProviderAdapter } from "../../types";
import type { Entitlement, RidehailDiscount } from "../../../core/entitlements/types";

export class BoltBerlinAdapter extends BaseProviderAdapter {
  id = "bolt-berlin";
  name = "Bolt";
  displayName = "Bolt";
  type = "ridehail" as const;
  cityCode = "berlin" as const;
  logoEmoji = "🚗";

  capabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  getDeepLink(request: DeepLinkRequest): DeepLinkResult {
    // Bolt deep link format
    const params = new URLSearchParams();

    if (request.origin.lat && request.origin.lng) {
      params.set("pickup_lat", request.origin.lat.toString());
      params.set("pickup_lng", request.origin.lng.toString());
    }
    if (request.destination.lat && request.destination.lng) {
      params.set("destination_lat", request.destination.lat.toString());
      params.set("destination_lng", request.destination.lng.toString());
    }

    // Bolt uses bolt:// scheme
    const appUrl = `bolt://ride?${params.toString()}`;
    const webUrl = `https://m.bolt.eu/ride?${params.toString()}`;

    return {
      url: webUrl,
      label: "Open Bolt",
      execution: {
        type: "deeplink",
        url: webUrl,
        label: "Request Bolt",
      },
    };
  }

  protected getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult {
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

export const boltBerlinAdapter = new BoltBerlinAdapter();
