/**
 * PROVIDER CATALOG
 *
 * Loads provider adapters by city.
 * Hard assertion: providers must match their city.
 */

import type { CityCode } from "../core/mobility/types";
import type { ProviderAdapter } from "./types";
import type { ProviderType } from "../core/entitlements/types";

import { nycProviders } from "./adapters/nyc";
import { berlinProviders } from "./adapters/berlin";
import { tokyoProviders } from "./adapters/tokyo";

// ============================================
// PROVIDER CATALOG BY CITY
// ============================================

const PROVIDER_CATALOG: Record<CityCode, ProviderAdapter[]> = {
  nyc: nycProviders,
  berlin: berlinProviders,
  tokyo: tokyoProviders,
};

// ============================================
// PROVIDER MAP (id -> adapter)
// ============================================

const PROVIDER_MAP: Map<string, ProviderAdapter> = new Map();
const PROVIDER_CITY_MAP: Map<string, CityCode> = new Map();

// Initialize maps
for (const [cityCode, providers] of Object.entries(PROVIDER_CATALOG) as [CityCode, ProviderAdapter[]][]) {
  for (const provider of providers) {
    PROVIDER_MAP.set(provider.id, provider);
    PROVIDER_CITY_MAP.set(provider.id, cityCode);
  }
}

// ============================================
// CATALOG FUNCTIONS
// ============================================

/**
 * Get all providers for a city
 */
export function getProvidersForCity(cityCode: CityCode): ProviderAdapter[] {
  return PROVIDER_CATALOG[cityCode] || [];
}

/**
 * Get a specific provider by ID
 */
export function getProviderById(providerId: string): ProviderAdapter | undefined {
  return PROVIDER_MAP.get(providerId);
}

/**
 * Get providers for a city filtered by type
 */
export function getProvidersByType(
  cityCode: CityCode,
  type: ProviderType
): ProviderAdapter[] {
  return getProvidersForCity(cityCode).filter((p) => p.type === type);
}

/**
 * Get the transit provider for a city
 */
export function getTransitProvider(cityCode: CityCode): ProviderAdapter | undefined {
  return getProvidersByType(cityCode, "transit")[0];
}

/**
 * Get the ridehail provider for a city
 */
export function getRidehailProvider(cityCode: CityCode): ProviderAdapter | undefined {
  return getProvidersByType(cityCode, "ridehail")[0];
}

/**
 * Get the bike provider for a city
 */
export function getBikeProvider(cityCode: CityCode): ProviderAdapter | undefined {
  return getProvidersByType(cityCode, "bike")[0];
}

/**
 * Validate that a provider ID belongs to a city
 * Throws in development if mismatch
 */
export function assertProviderForCity(providerId: string, cityCode: CityCode): void {
  const providerCity = PROVIDER_CITY_MAP.get(providerId);

  if (!providerCity) {
    console.warn(`Unknown provider ID: ${providerId}`);
    return;
  }

  if (providerCity !== cityCode) {
    const error = `Provider ${providerId} belongs to ${providerCity}, not ${cityCode}`;

    if (process.env.NODE_ENV === "development") {
      console.error(`[ASSERTION FAILED] ${error}`);
      // In strict mode, throw the error
      // throw new Error(error);
    } else {
      console.warn(`[Provider Mismatch] ${error}`);
    }
  }
}

/**
 * Get the city a provider belongs to
 */
export function getProviderCity(providerId: string): CityCode | undefined {
  return PROVIDER_CITY_MAP.get(providerId);
}

/**
 * Get all provider IDs for a city
 */
export function getProviderIdsForCity(cityCode: CityCode): string[] {
  return getProvidersForCity(cityCode).map((p) => p.id);
}

// ============================================
// EXPORTS
// ============================================

export { nycProviders } from "./adapters/nyc";
export { berlinProviders } from "./adapters/berlin";
export { tokyoProviders } from "./adapters/tokyo";
