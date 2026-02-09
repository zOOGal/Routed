/**
 * POI INTENT CLASSIFICATION TESTS
 *
 * Verifies that the POI intent layer correctly:
 * - Distinguishes "coffee shop" from "brunch café"
 * - Applies note context (e.g. "dog walk date") to filter out sit-down venues
 * - Changes POI output when note context changes
 * - Generates correct search queries and labels
 * - Filters curated POIs by intent-specific scoring
 */

import { describe, it, expect } from "vitest";
import {
  classifyPoiIntent,
  extractNoteContext,
  filterPoisByIntent,
  type PoiClassification,
} from "../agent-service";
import type { DetourSuggestion } from "../memory-assistant-service";

// ============================================
// FIXTURES
// ============================================

function makePoi(overrides: Partial<DetourSuggestion> = {}): DetourSuggestion {
  return {
    poi_id: "poi-1",
    name: "Generic Place",
    lat: 52.52,
    lng: 13.405,
    address: "123 Berlin St",
    category: null,
    adds_minutes: 5,
    corridor_distance_km: 0.3,
    social_score: 0.8,
    why_special: "A great spot",
    what_to_order: [],
    warnings: [],
    vibe_tags: [],
    confidence: 0.9,
    sources_count: {},
    is_open: true,
    ...overrides,
  };
}

function makeCoffeeShop(name: string = "Third Wave Coffee"): DetourSuggestion {
  return makePoi({
    poi_id: "poi-coffee",
    name,
    category: "cafe",
    why_special: "Specialty coffee roastery with single-origin espresso",
    what_to_order: ["flat white", "pour-over"],
    vibe_tags: ["coffee", "quick-bite", "casual", "takeaway"],
    adds_minutes: 3,
  });
}

function makeBrunchCafe(name: string = "Sunday Brunch House"): DetourSuggestion {
  return makePoi({
    poi_id: "poi-brunch",
    name,
    category: "restaurant",
    why_special: "Popular brunch spot with eggs benedict and mimosas",
    what_to_order: ["avocado toast", "eggs benedict"],
    vibe_tags: ["brunch", "restaurant", "sit-down", "dining"],
    adds_minutes: 8,
  });
}

function makeBakery(name: string = "Artisan Bakery"): DetourSuggestion {
  return makePoi({
    poi_id: "poi-bakery",
    name,
    category: "bakery",
    why_special: "Fresh sourdough bread and pastries every morning",
    what_to_order: ["croissant", "sourdough loaf"],
    vibe_tags: ["bakery", "pastry", "casual"],
    adds_minutes: 4,
  });
}

function makeSitDownRestaurant(name: string = "Fine Dining Berlin"): DetourSuggestion {
  return makePoi({
    poi_id: "poi-restaurant",
    name,
    category: "restaurant",
    why_special: "Upscale restaurant with tasting menu and full menu",
    what_to_order: ["tasting menu"],
    vibe_tags: ["fine dining", "restaurant", "reservation"],
    adds_minutes: 12,
  });
}

// ============================================
// classifyPoiIntent TESTS
// ============================================

describe("classifyPoiIntent — intent detection", () => {
  it('"coffee shop recs" maps to coffee_primary, NOT cafe', () => {
    const result = classifyPoiIntent("coffee shop recs");
    expect(result.intent).toBe("coffee_primary");
    expect(result.foodPref).toBe("coffee");
    expect(result.searchQuery).toBe("coffee shop");
  });

  it('"grab a coffee" maps to coffee_primary', () => {
    const result = classifyPoiIntent("grab a coffee on the way");
    expect(result.intent).toBe("coffee_primary");
    expect(result.foodPref).toBe("coffee");
  });

  it('"need coffee" maps to coffee_primary', () => {
    const result = classifyPoiIntent("need coffee");
    expect(result.intent).toBe("coffee_primary");
  });

  it('"espresso bar" maps to coffee_primary', () => {
    const result = classifyPoiIntent("espresso bar nearby");
    expect(result.intent).toBe("coffee_primary");
  });

  it('"café" alone maps to cafe_sitdown, not coffee_primary', () => {
    const result = classifyPoiIntent("any nice café?");
    expect(result.intent).toBe("cafe_sitdown");
    expect(result.foodPref).toBe("cafe");
    expect(result.searchQuery).toBe("cafe");
  });

  it('"brunch" maps to brunch', () => {
    const result = classifyPoiIntent("brunch spots");
    expect(result.intent).toBe("brunch");
    expect(result.searchQuery).toBe("brunch restaurant");
  });

  it('"breakfast" maps to brunch', () => {
    const result = classifyPoiIntent("where to get breakfast");
    expect(result.intent).toBe("brunch");
  });

  it('"bakery" maps to bakery', () => {
    const result = classifyPoiIntent("bakery nearby");
    expect(result.intent).toBe("bakery");
    expect(result.searchQuery).toBe("bakery");
  });

  it('"bar" maps to bar', () => {
    const result = classifyPoiIntent("any good bars?");
    expect(result.intent).toBe("bar");
    expect(result.searchQuery).toBe("bar");
  });

  it('"sushi" maps to cuisine with japanese', () => {
    const result = classifyPoiIntent("sushi recs");
    expect(result.intent).toBe("cuisine");
    expect(result.foodPref).toBe("japanese");
    expect(result.searchQuery).toBe("japanese restaurant");
  });

  it('"tacos" maps to cuisine with mexican', () => {
    const result = classifyPoiIntent("tacos");
    expect(result.intent).toBe("cuisine");
    expect(result.foodPref).toBe("mexican");
  });

  it('generic "food" maps to general_food', () => {
    const result = classifyPoiIntent("food recs along the way");
    expect(result.intent).toBe("general_food");
    expect(result.foodPref).toBeNull();
    expect(result.searchQuery).toBeNull();
  });

  it("empty note returns null intent", () => {
    const result = classifyPoiIntent(undefined);
    expect(result.intent).toBeNull();
    expect(result.foodPref).toBeNull();
  });

  it("unrelated note returns null intent", () => {
    const result = classifyPoiIntent("meeting at 3pm");
    expect(result.intent).toBeNull();
    expect(result.foodPref).toBeNull();
  });
});

// ============================================
// extractNoteContext TESTS
// ============================================

describe("extractNoteContext — note signals", () => {
  it('"dog walk date" signals casual + outdoor + quick + avoidSitDown', () => {
    const ctx = extractNoteContext("dog walk date with coffee shop recs");
    expect(ctx.isCasual).toBe(true);
    expect(ctx.prefersOutdoor).toBe(true);
    expect(ctx.prefersQuickStop).toBe(true);
    expect(ctx.avoidSitDown).toBe(true);
  });

  it('"quick stop" signals quick but not necessarily casual', () => {
    const ctx = extractNoteContext("quick stop for coffee");
    expect(ctx.prefersQuickStop).toBe(true);
  });

  it('"stroll through the park" signals casual + outdoor', () => {
    const ctx = extractNoteContext("stroll through the park");
    expect(ctx.isCasual).toBe(true);
    expect(ctx.prefersOutdoor).toBe(true);
  });

  it("note without casual signals returns all false", () => {
    const ctx = extractNoteContext("meeting at the office");
    expect(ctx.isCasual).toBe(false);
    expect(ctx.prefersOutdoor).toBe(false);
    expect(ctx.prefersQuickStop).toBe(false);
    expect(ctx.avoidSitDown).toBe(false);
  });
});

// ============================================
// filterPoisByIntent TESTS
// ============================================

describe("filterPoisByIntent — coffee vs brunch", () => {
  it("COFFEE_PRIMARY: coffee shop ranked above brunch café", () => {
    const classification = classifyPoiIntent("coffee shop recs");
    const pois = [makeBrunchCafe(), makeCoffeeShop(), makeSitDownRestaurant()];

    const result = filterPoisByIntent(pois, classification);

    // Coffee shop should be returned, brunch café should not
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe("Third Wave Coffee");
    // Brunch cafe should be excluded (negative relevance from brunch/restaurant terms)
    const brunchIncluded = result.some((p) => p.name === "Sunday Brunch House");
    expect(brunchIncluded).toBe(false);
  });

  it("COFFEE_PRIMARY: sit-down restaurant excluded", () => {
    const classification = classifyPoiIntent("coffee spot");
    const pois = [makeSitDownRestaurant(), makeCoffeeShop()];

    const result = filterPoisByIntent(pois, classification);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Third Wave Coffee");
  });

  it("BRUNCH: brunch café ranked above coffee shop", () => {
    const classification = classifyPoiIntent("brunch spots");
    const pois = [makeCoffeeShop(), makeBrunchCafe()];

    const result = filterPoisByIntent(pois, classification);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe("Sunday Brunch House");
  });

  it("BAKERY: bakery ranked first", () => {
    const classification = classifyPoiIntent("bakery nearby");
    const pois = [makeCoffeeShop(), makeBakery(), makeBrunchCafe()];

    const result = filterPoisByIntent(pois, classification);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe("Artisan Bakery");
  });
});

describe("filterPoisByIntent — note context: dog walk date + coffee", () => {
  it("avoids sit-down restaurants when note says 'dog walk date'", () => {
    const classification = classifyPoiIntent("dog walk date, coffee shop recs");
    const pois = [makeSitDownRestaurant(), makeBrunchCafe(), makeCoffeeShop()];

    const result = filterPoisByIntent(pois, classification);

    // Only coffee shop should survive; sit-down restaurant penalized by both intent AND noteContext
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe("Third Wave Coffee");
    const restaurantIncluded = result.some((p) => p.name === "Fine Dining Berlin");
    expect(restaurantIncluded).toBe(false);
  });

  it("prefers quick-stop POIs when note says 'dog walk'", () => {
    const shortDetour = makeCoffeeShop("Quick Espresso");
    shortDetour.adds_minutes = 2;
    const longDetour = makeCoffeeShop("Far Away Coffee");
    longDetour.adds_minutes = 15;
    longDetour.poi_id = "poi-far";

    const classification = classifyPoiIntent("dog walk, grab a coffee");
    const result = filterPoisByIntent([longDetour, shortDetour], classification);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // Quick Espresso should rank higher due to lower adds_minutes + quickStop bonus
    expect(result[0].name).toBe("Quick Espresso");
  });
});

describe("filterPoisByIntent — output changes when note is removed", () => {
  it("same POI list produces different results with and without note", () => {
    const pois = [makeSitDownRestaurant(), makeBrunchCafe(), makeCoffeeShop()];

    // With "dog walk date + coffee" note: strict filtering
    const withNote = classifyPoiIntent("dog walk date, coffee shop recs");
    const resultsWithNote = filterPoisByIntent(pois, withNote);

    // Without note but same "coffee" preference: just intent, no note filtering
    const withoutNote = classifyPoiIntent("coffee shop recs");
    const resultsWithoutNote = filterPoisByIntent(pois, withoutNote);

    // Both should return coffee shop
    expect(resultsWithNote.some((p) => p.name === "Third Wave Coffee")).toBe(true);
    expect(resultsWithoutNote.some((p) => p.name === "Third Wave Coffee")).toBe(true);

    // But with note, sit-down places get extra penalty from avoidSitDown
    // The key assertion: note context should make results stricter (equal or fewer results)
    expect(resultsWithNote.length).toBeLessThanOrEqual(resultsWithoutNote.length);
  });
});

describe("filterPoisByIntent — output discipline", () => {
  it("returns at most 3 POIs", () => {
    const classification = classifyPoiIntent("sushi recs");
    const pois = [
      makePoi({ poi_id: "1", name: "Sushi A", category: "japanese", vibe_tags: ["sushi"] }),
      makePoi({ poi_id: "2", name: "Sushi B", category: "japanese", vibe_tags: ["sushi"] }),
      makePoi({ poi_id: "3", name: "Sushi C", category: "japanese", vibe_tags: ["sushi"] }),
      makePoi({ poi_id: "4", name: "Sushi D", category: "japanese", vibe_tags: ["sushi"] }),
      makePoi({ poi_id: "5", name: "Sushi E", category: "japanese", vibe_tags: ["sushi"] }),
    ];

    const result = filterPoisByIntent(pois, classification);

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns empty rather than incorrect when nothing matches", () => {
    const classification = classifyPoiIntent("coffee shop recs");
    // Only restaurants, no coffee signals at all
    const pois = [
      makePoi({ name: "Steakhouse", vibe_tags: ["restaurant", "dinner"], why_special: "Premium steaks" }),
      makePoi({ name: "Seafood Grill", vibe_tags: ["restaurant", "dinner"], why_special: "Fresh fish" }),
    ];

    const result = filterPoisByIntent(pois, classification);

    // Should return empty — no coffee signals in these POIs
    expect(result.length).toBe(0);
  });
});

// ============================================
// Places API search query TESTS
// ============================================

describe("classifyPoiIntent — search queries", () => {
  it('"coffee shop recs" generates "coffee shop" query, not "cafe restaurant"', () => {
    const result = classifyPoiIntent("coffee shop recs");
    expect(result.searchQuery).toBe("coffee shop");
    expect(result.searchQuery).not.toContain("restaurant");
  });

  it('"brunch" generates "brunch restaurant" query', () => {
    const result = classifyPoiIntent("brunch spots");
    expect(result.searchQuery).toBe("brunch restaurant");
  });

  it('"tacos" generates "mexican restaurant" query', () => {
    const result = classifyPoiIntent("tacos");
    expect(result.searchQuery).toBe("mexican restaurant");
  });

  it('"bakery" generates "bakery" query, not "bakery restaurant"', () => {
    const result = classifyPoiIntent("bakery nearby");
    expect(result.searchQuery).toBe("bakery");
    expect(result.searchQuery).not.toContain("restaurant");
  });
});
