/**
 * PROVIDER ADAPTER TESTS
 */

import { describe, it, expect } from "vitest";
import {
  getProvidersForCity,
  getProviderById,
  getTransitProvider,
  getRidehailProvider,
  getBikeProvider,
  assertProviderForCity,
  getProviderCity,
  nycProviders,
  berlinProviders,
  tokyoProviders,
} from "../catalog";

describe("Provider Catalog", () => {
  it("returns 3 providers for NYC", () => {
    const providers = getProvidersForCity("nyc");
    expect(providers).toHaveLength(3);
    expect(providers.map((p) => p.type)).toContain("transit");
    expect(providers.map((p) => p.type)).toContain("ridehail");
    expect(providers.map((p) => p.type)).toContain("bike");
  });

  it("returns 3 providers for Berlin", () => {
    const providers = getProvidersForCity("berlin");
    expect(providers).toHaveLength(3);
    expect(providers.map((p) => p.type)).toContain("transit");
    expect(providers.map((p) => p.type)).toContain("ridehail");
    expect(providers.map((p) => p.type)).toContain("bike");
  });

  it("returns 3 providers for Tokyo", () => {
    const providers = getProvidersForCity("tokyo");
    expect(providers).toHaveLength(3);
    expect(providers.map((p) => p.type)).toContain("transit");
    expect(providers.map((p) => p.type)).toContain("ridehail");
    expect(providers.map((p) => p.type)).toContain("bike");
  });

  it("getProviderById returns correct provider", () => {
    const mta = getProviderById("mta");
    expect(mta).toBeDefined();
    expect(mta?.name).toBe("MTA");
    expect(mta?.cityCode).toBe("nyc");
  });

  it("getTransitProvider returns correct provider for each city", () => {
    expect(getTransitProvider("nyc")?.id).toBe("mta");
    expect(getTransitProvider("berlin")?.id).toBe("bvg");
    expect(getTransitProvider("tokyo")?.id).toBe("suica");
  });

  it("getRidehailProvider returns correct provider for each city", () => {
    expect(getRidehailProvider("nyc")?.id).toBe("uber-nyc");
    expect(getRidehailProvider("berlin")?.id).toBe("bolt-berlin");
    expect(getRidehailProvider("tokyo")?.id).toBe("go-taxi");
  });

  it("getBikeProvider returns correct provider for each city", () => {
    expect(getBikeProvider("nyc")?.id).toBe("citibike");
    expect(getBikeProvider("berlin")?.id).toBe("lime-berlin");
    expect(getBikeProvider("tokyo")?.id).toBe("docomo-bike");
  });

  it("getProviderCity returns correct city for provider", () => {
    expect(getProviderCity("mta")).toBe("nyc");
    expect(getProviderCity("bvg")).toBe("berlin");
    expect(getProviderCity("suica")).toBe("tokyo");
  });
});

describe("City/Provider Mismatch Prevention", () => {
  it("NYC plan never outputs U-Bahn (Berlin transit)", () => {
    const nycTransit = getTransitProvider("nyc");
    expect(nycTransit?.name).not.toContain("U-Bahn");
    expect(nycTransit?.name).not.toContain("BVG");
    expect(nycTransit?.displayName).not.toContain("U-Bahn");
  });

  it("Berlin plan never outputs MTA (NYC transit)", () => {
    const berlinTransit = getTransitProvider("berlin");
    expect(berlinTransit?.name).not.toContain("MTA");
    expect(berlinTransit?.displayName).not.toContain("Subway");
  });

  it("Tokyo plan never outputs Uber (not primary in Tokyo)", () => {
    const tokyoRidehail = getRidehailProvider("tokyo");
    expect(tokyoRidehail?.name).not.toBe("Uber");
    expect(tokyoRidehail?.name).toBe("GO Taxi");
  });

  it("assertProviderForCity warns on mismatch", () => {
    // This should log a warning but not throw
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertProviderForCity("mta", "berlin");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("Provider Deep Links", () => {
  it("MTA returns valid deep link", () => {
    const mta = getProviderById("mta");
    const link = mta?.getDeepLink({
      origin: { name: "Times Square" },
      destination: { name: "Brooklyn Bridge" },
    });

    expect(link?.url).toContain("mta.info");
    expect(link?.execution.type).toBe("system_map");
  });

  it("Uber NYC returns valid deep link with coordinates", () => {
    const uber = getProviderById("uber-nyc");
    const link = uber?.getDeepLink({
      origin: { name: "Times Square", lat: 40.758, lng: -73.985 },
      destination: { name: "Brooklyn Bridge", lat: 40.706, lng: -73.997 },
    });

    expect(link?.url).toContain("uber");
    expect(link?.execution.type).toBe("deeplink");
  });

  it("BVG returns valid deep link", () => {
    const bvg = getProviderById("bvg");
    const link = bvg?.getDeepLink({
      origin: { name: "Alexanderplatz" },
      destination: { name: "Brandenburger Tor" },
    });

    expect(link?.url).toContain("bvg.de");
    expect(link?.execution.type).toBe("system_map");
  });

  it("Bolt Berlin returns valid deep link", () => {
    const bolt = getProviderById("bolt-berlin");
    const link = bolt?.getDeepLink({
      origin: { name: "Alexanderplatz", lat: 52.521, lng: 13.411 },
      destination: { name: "Tempelhof", lat: 52.473, lng: 13.404 },
    });

    expect(link?.url).toContain("bolt");
    expect(link?.execution.type).toBe("deeplink");
  });
});

describe("Provider Fare Estimates", () => {
  it("MTA returns included with transit pass", () => {
    const mta = getProviderById("mta");
    const estimate = mta?.estimateFare({
      durationMin: 20,
      distanceM: 5000,
      entitlements: [
        {
          type: "transit_pass",
          providerId: "mta",
          providerName: "MTA",
          unlimited: true,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          isVerified: true,
        },
      ],
    });

    expect(estimate?.coverage).toBe("included");
    expect(estimate?.costLabel).toBe("Covered by pass");
  });

  it("Uber returns discounted with ridehail discount", () => {
    const uber = getProviderById("uber-nyc");
    const estimate = uber?.estimateFare({
      durationMin: 15,
      distanceM: 4000,
      entitlements: [
        {
          type: "ridehail_discount",
          providerId: "uber-nyc",
          providerName: "Uber",
          percentOff: 15,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          isVerified: true,
        },
      ],
    });

    expect(estimate?.coverage).toBe("discounted");
    expect(estimate?.discountPercent).toBe(15);
    expect(estimate?.costLabel).toContain("15%");
  });

  it("Citi Bike returns included with bike unlock", () => {
    const citibike = getProviderById("citibike");
    const estimate = citibike?.estimateFare({
      durationMin: 10,
      distanceM: 2000,
      entitlements: [
        {
          type: "bike_unlock",
          providerId: "citibike",
          providerName: "Citi Bike",
          freeUnlocksPerDay: 5,
          remainingUnlocksToday: 3,
          includedMinutesPerDay: 30,
          remainingMinutesToday: 30,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          isVerified: true,
        },
      ],
    });

    expect(estimate?.coverage).toBe("included");
  });

  it("Provider returns pay when no entitlement", () => {
    const mta = getProviderById("mta");
    const estimate = mta?.estimateFare({
      durationMin: 20,
      distanceM: 5000,
      entitlements: [],
    });

    expect(estimate?.coverage).toBe("pay");
  });
});

describe("Provider System Map Links", () => {
  it("MTA has system map link", () => {
    const mta = getProviderById("mta");
    const mapLink = mta?.getSystemMapLink?.();
    expect(mapLink).toBeDefined();
    expect(mapLink?.url).toContain("mta.info");
  });

  it("BVG has system map link", () => {
    const bvg = getProviderById("bvg");
    const mapLink = bvg?.getSystemMapLink?.();
    expect(mapLink).toBeDefined();
    expect(mapLink?.url).toContain("bvg.de");
  });

  it("Tokyo transit has system map link", () => {
    const suica = getProviderById("suica");
    const mapLink = suica?.getSystemMapLink?.();
    expect(mapLink).toBeDefined();
    expect(mapLink?.url).toContain("metro");
  });
});

// Import vi for spying
import { vi } from "vitest";
