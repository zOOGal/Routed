/**
 * ROUTED PRICING MODULE
 *
 * This module handles:
 * 1. City → Currency resolution
 * 2. Cost categorization (no fake precision)
 * 3. Package/entitlement integration
 *
 * PRINCIPLE: Never show exact prices unless they are verified correct.
 * Show cost CATEGORIES instead.
 */

import type { CityProfile, UserPackage, Entitlement } from "@shared/schema";
import { getCityProfile } from "./city-intelligence";

// ============================================
// CURRENCY RESOLUTION
// ============================================

// Country → Currency mapping
const COUNTRY_CURRENCY: Record<string, { code: string; symbol: string }> = {
  "USA": { code: "USD", symbol: "$" },
  "Japan": { code: "JPY", symbol: "¥" },
  "Germany": { code: "EUR", symbol: "€" },
  "France": { code: "EUR", symbol: "€" },
  "UK": { code: "GBP", symbol: "£" },
  "Canada": { code: "CAD", symbol: "C$" },
  "Australia": { code: "AUD", symbol: "A$" },
};

export interface CurrencyInfo {
  code: string;
  symbol: string;
}

export function getCurrencyForCity(cityId: string): CurrencyInfo | null {
  const profile = getCityProfile(cityId);
  if (!profile) return null;

  const currency = COUNTRY_CURRENCY[profile.country];
  if (!currency) {
    // Fallback: try to use the currency field from profile
    if (profile.currency) {
      return {
        code: profile.currency,
        symbol: getCurrencySymbol(profile.currency),
      };
    }
    return null;
  }

  return currency;
}

function getCurrencySymbol(code: string): string {
  const symbols: Record<string, string> = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "JPY": "¥",
    "CAD": "C$",
    "AUD": "A$",
    "CHF": "CHF",
  };
  return symbols[code] || code;
}

// ============================================
// COST CATEGORIES (No fake precision)
// ============================================

export type CostCategory =
  | "free"
  | "covered_by_pass"
  | "standard_fare"
  | "paid_ride"
  | "premium_ride";

export interface CostEstimate {
  category: CostCategory;
  displayText: string;
  // Only include raw value if we have verified data
  rawValueCents?: number;
  currency?: CurrencyInfo;
  isCoveredByPackage: boolean;
  packageName?: string;
}

/**
 * Get cost estimate for a route
 *
 * CRITICAL: We do NOT show exact prices unless:
 * 1. Google Maps API returned verified fare data
 * 2. We have real provider pricing
 *
 * Otherwise, we show cost CATEGORY only.
 */
export function estimateRouteCost(
  mode: "transit" | "rideshare" | "walk" | "bike" | "mixed",
  durationMinutes: number,
  distanceMeters: number,
  cityId: string,
  googleFare?: { value: number; currency: string; text: string },
  activePackage?: UserPackage | null
): CostEstimate {
  const currency = getCurrencyForCity(cityId);

  // Walking is always free
  if (mode === "walk") {
    return {
      category: "free",
      displayText: "Free",
      isCoveredByPackage: false,
    };
  }

  // Check if covered by package
  if (activePackage) {
    const entitlements = activePackage.entitlements as Entitlement[];
    const relevantEntitlement = entitlements.find(e => {
      if (mode === "transit" && e.providerType === "transit") return true;
      if (mode === "rideshare" && e.providerType === "ridehail") return true;
      if (mode === "bike" && e.providerType === "bike") return true;
      return false;
    });

    if (relevantEntitlement) {
      if (relevantEntitlement.benefitType === "free_pass") {
        return {
          category: "covered_by_pass",
          displayText: "Covered by pass",
          isCoveredByPackage: true,
          packageName: activePackage.packageId,
        };
      }
      if (relevantEntitlement.benefitType === "discount_percent") {
        // Still show as standard fare but note the discount
        return {
          category: "standard_fare",
          displayText: `${relevantEntitlement.value}% off with pass`,
          isCoveredByPackage: true,
          packageName: activePackage.packageId,
        };
      }
    }
  }

  // Transit with verified Google fare
  if (mode === "transit" && googleFare && currency) {
    // Verify currency matches city
    if (googleFare.currency === currency.code) {
      return {
        category: "standard_fare",
        displayText: googleFare.text,
        rawValueCents: googleFare.value,
        currency,
        isCoveredByPackage: false,
      };
    }
    // Currency mismatch - show category only
    return {
      category: "standard_fare",
      displayText: "Standard transit fare",
      isCoveredByPackage: false,
    };
  }

  // Transit without verified fare
  if (mode === "transit") {
    return {
      category: "standard_fare",
      displayText: "Standard transit fare",
      isCoveredByPackage: false,
    };
  }

  // Rideshare - we do NOT have real pricing, so use category
  if (mode === "rideshare") {
    // Rough categorization based on distance
    const distanceKm = distanceMeters / 1000;
    if (distanceKm < 3) {
      return {
        category: "paid_ride",
        displayText: "Short ride",
        isCoveredByPackage: false,
      };
    }
    if (distanceKm < 10) {
      return {
        category: "paid_ride",
        displayText: "Paid ride",
        isCoveredByPackage: false,
      };
    }
    return {
      category: "premium_ride",
      displayText: "Longer ride",
      isCoveredByPackage: false,
    };
  }

  // Bike
  if (mode === "bike") {
    if (durationMinutes < 30) {
      return {
        category: "standard_fare",
        displayText: "Bike rental",
        isCoveredByPackage: false,
      };
    }
    return {
      category: "paid_ride",
      displayText: "Extended bike rental",
      isCoveredByPackage: false,
    };
  }

  // Mixed/unknown
  return {
    category: "standard_fare",
    displayText: "Fare varies",
    isCoveredByPackage: false,
  };
}

// ============================================
// CITY-SPECIFIC FARE INFO
// ============================================

export interface CityFareInfo {
  transitFlatFare?: string;
  transitDescription: string;
  rideshareNote: string;
}

const CITY_FARE_INFO: Record<string, CityFareInfo> = {
  nyc: {
    transitFlatFare: "$2.90",
    transitDescription: "Flat fare for subway and local bus",
    rideshareNote: "Uber/Lyft pricing varies with demand",
  },
  tokyo: {
    transitDescription: "Fare based on distance traveled",
    rideshareNote: "Taxi/rideshare is more expensive than transit",
  },
  berlin: {
    transitDescription: "Zone-based ticketing (AB, BC, ABC)",
    rideshareNote: "Uber/Bolt available, competitive pricing",
  },
};

export function getCityFareInfo(cityId: string): CityFareInfo {
  return CITY_FARE_INFO[cityId] || {
    transitDescription: "Standard transit fare",
    rideshareNote: "Rideshare pricing varies",
  };
}

// ============================================
// DISPLAY HELPERS
// ============================================

/**
 * Format cost for display
 * NEVER shows raw numbers without currency context
 */
export function formatCostDisplay(estimate: CostEstimate): string {
  if (estimate.category === "free") {
    return "Free";
  }

  if (estimate.category === "covered_by_pass") {
    return "Covered by pass";
  }

  return estimate.displayText;
}

/**
 * Should we show cost in the UI?
 * We hide cost if it would be misleading
 */
export function shouldShowCost(estimate: CostEstimate): boolean {
  // Always show if free or covered
  if (estimate.category === "free" || estimate.category === "covered_by_pass") {
    return true;
  }

  // Show category-based estimates
  return true;
}
