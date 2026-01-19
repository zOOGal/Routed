import type { CityProfile } from "@shared/schema";

export const cityProfiles: Record<string, CityProfile> = {
  nyc: {
    id: "nyc",
    name: "New York City",
    country: "USA",
    timezone: "America/New_York",
    complexStations: [
      "Times Square-42nd Street",
      "Grand Central Terminal",
      "Penn Station",
      "Atlantic Terminal",
      "Fulton Street",
      "14th Street-Union Square"
    ],
    nightReliability: 0.7,
    transitVsTaxiBias: 0.6,
    walkingFriendliness: 0.8,
    cognitiveLoadIndex: {
      navigation: 0.6,
      signage: 0.5,
      crowding: 0.7,
      overall: 0.6
    },
    currency: "USD",
    transitTypes: ["Subway", "Bus", "PATH", "LIRR", "Metro-North", "Ferry"],
    rideshareApps: ["Uber", "Lyft", "Via"]
  },
  tokyo: {
    id: "tokyo",
    name: "Tokyo",
    country: "Japan",
    timezone: "Asia/Tokyo",
    complexStations: [
      "Shinjuku Station",
      "Shibuya Station",
      "Tokyo Station",
      "Ikebukuro Station",
      "Ueno Station",
      "Shinagawa Station"
    ],
    nightReliability: 0.3,
    transitVsTaxiBias: 0.9,
    walkingFriendliness: 0.9,
    cognitiveLoadIndex: {
      navigation: 0.8,
      signage: 0.4,
      crowding: 0.8,
      overall: 0.65
    },
    currency: "JPY",
    transitTypes: ["JR Lines", "Metro", "Toei Subway", "Private Railways", "Bus"],
    rideshareApps: ["Uber", "JapanTaxi", "GO"]
  },
  london: {
    id: "london",
    name: "London",
    country: "UK",
    timezone: "Europe/London",
    complexStations: [
      "King's Cross St Pancras",
      "Victoria",
      "Bank/Monument",
      "Liverpool Street",
      "Oxford Circus",
      "Waterloo"
    ],
    nightReliability: 0.5,
    transitVsTaxiBias: 0.7,
    walkingFriendliness: 0.75,
    cognitiveLoadIndex: {
      navigation: 0.5,
      signage: 0.3,
      crowding: 0.6,
      overall: 0.45
    },
    currency: "GBP",
    transitTypes: ["Underground", "Overground", "DLR", "Elizabeth Line", "Bus", "National Rail"],
    rideshareApps: ["Uber", "Bolt", "FreeNow"]
  }
};

export function getCityProfile(cityId: string): CityProfile | undefined {
  return cityProfiles[cityId];
}

export function getAllCities(): CityProfile[] {
  return Object.values(cityProfiles);
}

export function calculateCognitiveLoad(
  cityProfile: CityProfile,
  options: {
    hasComplexStation?: boolean;
    isNightTime?: boolean;
    transferCount?: number;
    walkingMinutes?: number;
  }
): number {
  let load = cityProfile.cognitiveLoadIndex.overall;

  if (options.hasComplexStation) {
    load += 0.15;
  }

  if (options.isNightTime) {
    load += 0.1 * (1 - cityProfile.nightReliability);
  }

  if (options.transferCount && options.transferCount > 0) {
    load += options.transferCount * 0.08;
  }

  if (options.walkingMinutes && options.walkingMinutes > 15) {
    load += (options.walkingMinutes - 15) * 0.005;
  }

  return Math.min(1, Math.max(0, load));
}
