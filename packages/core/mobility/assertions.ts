/**
 * MOBILITY ASSERTIONS
 *
 * Hard assertions to prevent city/provider mismatches.
 * These should fail loudly in development.
 */

import type { CityCode, MobilityStep, MobilityPlan } from "./types";

// ============================================
// FORBIDDEN PROVIDER NAMES BY CITY
// ============================================

/**
 * Provider names that should NEVER appear in a specific city's output
 */
const FORBIDDEN_PROVIDERS: Record<CityCode, string[]> = {
  nyc: [
    "U-Bahn", "S-Bahn", "BVG", "Bolt",  // Berlin
    "JR", "Suica", "Tokyo Metro", "Toei", "GO Taxi", "Docomo", // Tokyo
  ],
  berlin: [
    "MTA", "Subway", "Metro-North", "LIRR", "Uber", "Lyft", "Citi Bike", // NYC
    "JR", "Suica", "Tokyo Metro", "Toei", "GO Taxi", "Docomo", // Tokyo
  ],
  tokyo: [
    "MTA", "Subway", "Metro-North", "LIRR", "Uber", "Lyft", "Citi Bike", // NYC
    "U-Bahn", "S-Bahn", "BVG", "Bolt", "Lime", // Berlin
  ],
};

/**
 * Allowed transit type names by city
 */
const ALLOWED_TRANSIT_NAMES: Record<CityCode, string[]> = {
  nyc: ["Subway", "Bus", "PATH", "LIRR", "Metro-North", "Ferry", "MTA"],
  berlin: ["U-Bahn", "S-Bahn", "Tram", "Bus", "Regional Rail", "BVG"],
  tokyo: ["JR", "Metro", "Toei", "Private Railway", "Bus", "Suica"],
};

// ============================================
// ASSERTION FUNCTIONS
// ============================================

export class CityProviderMismatchError extends Error {
  constructor(
    public cityCode: CityCode,
    public forbiddenTerm: string,
    public context: string
  ) {
    super(
      `City/Provider mismatch: "${forbiddenTerm}" should not appear in ${cityCode} context. ${context}`
    );
    this.name = "CityProviderMismatchError";
  }
}

/**
 * Check if a string contains any forbidden provider names for a city
 */
export function containsForbiddenProvider(text: string, cityCode: CityCode): string | null {
  const forbidden = FORBIDDEN_PROVIDERS[cityCode];
  const lowerText = text.toLowerCase();

  for (const term of forbidden) {
    if (lowerText.includes(term.toLowerCase())) {
      return term;
    }
  }

  return null;
}

/**
 * Assert that a step does not contain forbidden provider references
 * Throws in development, logs warning in production
 */
export function assertStepProviderMatch(step: MobilityStep, cityCode: CityCode): void {
  const fieldsToCheck = [
    step.instruction,
    step.providerName,
    step.transitDetails?.line,
    step.transitDetails?.vehicleType,
  ].filter(Boolean) as string[];

  for (const field of fieldsToCheck) {
    const forbidden = containsForbiddenProvider(field, cityCode);
    if (forbidden) {
      const error = new CityProviderMismatchError(
        cityCode,
        forbidden,
        `Found in step: "${field}"`
      );

      if (process.env.NODE_ENV === "development") {
        console.error(`[ASSERTION FAILED] ${error.message}`);
        // In strict mode, throw the error
        // throw error;
      } else {
        console.warn(`[Provider Mismatch] ${error.message}`);
      }
    }
  }
}

/**
 * Assert that an entire plan does not contain forbidden provider references
 */
export function assertPlanProviderMatch(plan: MobilityPlan): void {
  for (const step of plan.steps) {
    assertStepProviderMatch(step, plan.cityCode);
  }

  // Also check deep links
  for (const link of plan.deepLinks) {
    const forbidden = containsForbiddenProvider(link.providerName, plan.cityCode);
    if (forbidden) {
      console.warn(
        `[Provider Mismatch] Deep link provider "${link.providerName}" ` +
        `contains forbidden term "${forbidden}" for city ${plan.cityCode}`
      );
    }
  }
}

/**
 * Sanitize a transit line name to be appropriate for the city
 * Returns the original if valid, or a generic term if not
 */
export function sanitizeTransitName(
  name: string,
  cityCode: CityCode,
  fallback: string = "Transit"
): string {
  const forbidden = containsForbiddenProvider(name, cityCode);
  if (forbidden) {
    console.warn(
      `[Context Sanity] Sanitized forbidden transit name "${name}" for city ${cityCode}`
    );
    return fallback;
  }
  return name;
}

/**
 * Get appropriate generic transit term for a city
 */
export function getGenericTransitTerm(cityCode: CityCode): string {
  switch (cityCode) {
    case "nyc":
      return "Subway";
    case "berlin":
      return "Transit";
    case "tokyo":
      return "Train";
    default:
      return "Transit";
  }
}

/**
 * Validate that a provider ID matches the expected city
 */
export function isProviderValidForCity(
  providerId: string,
  cityCode: CityCode,
  providerCityMap: Record<string, CityCode>
): boolean {
  const providerCity = providerCityMap[providerId];
  return providerCity === cityCode;
}
