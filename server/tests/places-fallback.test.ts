/**
 * PLACES FALLBACK TESTS
 *
 * Tests the detour fallback flow:
 * 1. Curated POIs match → use them (no Places API call)
 * 2. Curated POIs don't match + Places returns results → fallback to Maps
 * 3. Curated POIs don't match + Places returns nothing → graceful message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveDetourFallback, type DetourFallbackInput } from "../agent-service";
import type { DetourSuggestion } from "../memory-assistant-service";

// Mock searchPlacesText from google-maps-service
vi.mock("../google-maps-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../google-maps-service")>();
  return {
    ...actual,
    searchPlacesText: vi.fn(),
  };
});

import { searchPlacesText } from "../google-maps-service";
const mockSearchPlacesText = vi.mocked(searchPlacesText);

// ============================================
// FIXTURES
// ============================================

function makePoi(overrides: Partial<DetourSuggestion> = {}): DetourSuggestion {
  return {
    poi_id: "poi-1",
    name: "Los Tacos No. 1",
    lat: 40.758,
    lng: -73.985,
    address: "75 9th Ave, New York, NY",
    category: "mexican",
    adds_minutes: 5,
    corridor_distance_km: 0.3,
    social_score: 0.9,
    why_special: "Best tacos in Chelsea",
    what_to_order: ["al pastor taco"],
    vibe_tags: ["casual", "quick-bite"],
    ...overrides,
  };
}

const NYC_ORIGIN = { lat: 40.748, lng: -73.985 };
const NYC_DEST = { lat: 40.768, lng: -73.981 };

// ============================================
// TESTS
// ============================================

describe("resolveDetourFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses curated POIs when they match — searchPlacesText not called", async () => {
    const input: DetourFallbackInput = {
      relevantPois: [makePoi(), makePoi({ name: "Joe's Shanghai", category: "chinese" })],
      foodPref: "mexican",
      allPois: [makePoi()],
      userNote: "mexican food",
      originCoords: NYC_ORIGIN,
      destCoords: NYC_DEST,
    };

    const result = await resolveDetourFallback(input);

    expect(result.detourMeta.detour_mode).toBe("curated");
    expect(result.detourMeta.detour_candidates_returned).toBe(2);
    expect(result.detourMeta.places_candidates_returned).toBe(0);
    expect(result.reasoningAppend).toContain("Los Tacos No. 1 (+5 min");
    expect(result.fallbackResults).toHaveLength(0);
    expect(mockSearchPlacesText).not.toHaveBeenCalled();
  });

  it("falls back to Places API when curated POIs don't match cuisine", async () => {
    mockSearchPlacesText.mockResolvedValue([
      { placeId: "gp-1", name: "Joe's Shanghai", lat: 40.755, lng: -73.998, address: "9 Pell St, Chinatown, New York", rating: 4.5, priceLevel: 2 },
      { placeId: "gp-2", name: "Xi'an Famous Foods", lat: 40.756, lng: -73.99, address: "45 Bayard St, Chinatown, New York", rating: 4.3, priceLevel: 1 },
      { placeId: "gp-3", name: "Nom Wah Tea Parlor", lat: 40.754, lng: -73.997, address: "13 Doyers St, Chinatown, New York", rating: 4.4, priceLevel: 2 },
    ]);

    const input: DetourFallbackInput = {
      relevantPois: [], // curated didn't match
      foodPref: "chinese",
      allPois: [makePoi()], // had curated POIs, just not matching
      userNote: "chinese food",
      originCoords: NYC_ORIGIN,
      destCoords: NYC_DEST,
    };

    const result = await resolveDetourFallback(input);

    expect(result.detourMeta.detour_mode).toBe("places_fallback");
    expect(result.detourMeta.places_candidates_returned).toBe(3);
    expect(result.fallbackResults).toHaveLength(3);
    expect(result.fallbackResults[0].source).toBe("maps");
    expect(result.fallbackResults[0].name).toBe("Joe's Shanghai");
    expect(result.fallbackResults[0].provider_place_id).toBe("gp-1");
    expect(result.reasoningAppend).toContain("chinese nearby");
    expect(result.reasoningAppend).toContain("Joe's Shanghai");
    expect(mockSearchPlacesText).toHaveBeenCalledWith(
      "chinese restaurant",
      expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) }),
      3
    );
  });

  it("returns graceful message when both curated and Places return nothing", async () => {
    mockSearchPlacesText.mockResolvedValue([]);

    const input: DetourFallbackInput = {
      relevantPois: [],
      foodPref: "chinese",
      allPois: [makePoi()],
      userNote: "chinese food",
      originCoords: NYC_ORIGIN,
      destCoords: NYC_DEST,
    };

    const result = await resolveDetourFallback(input);

    expect(result.detourMeta.detour_mode).toBe("none");
    expect(result.detourMeta.places_candidates_returned).toBe(0);
    expect(result.fallbackResults).toHaveLength(0);
    expect(result.reasoningAppend).toContain("No chinese spots found");
  });

  it("handles generic food mention without specific cuisine", async () => {
    const input: DetourFallbackInput = {
      relevantPois: [],
      foodPref: null,
      allPois: [],
      userNote: "food recs along the way",
    };

    const result = await resolveDetourFallback(input);

    expect(result.detourMeta.detour_mode).toBe("none");
    expect(result.reasoningAppend).toBe("");
    expect(mockSearchPlacesText).not.toHaveBeenCalled();
  });

  it("returns empty when no food preference and no POIs", async () => {
    const input: DetourFallbackInput = {
      relevantPois: [],
      foodPref: null,
      allPois: [],
      userNote: "meeting at 3pm",
    };

    const result = await resolveDetourFallback(input);

    expect(result.detourMeta.detour_mode).toBe("none");
    expect(result.reasoningAppend).toBe("");
    expect(result.fallbackResults).toHaveLength(0);
  });
});
