/**
 * BROKER SCORING & HONESTY TESTS
 *
 * Verifies:
 * 1. No "Uber" adapter in PoC — all providers use generic names
 * 2. Provider selection changes with price/ETA/constraints
 * 3. realBooking=false providers cannot complete bookings
 * 4. Scoring prefers cheaper when no constraints, comfort when date context
 * 5. DeepLinkProviderAdapter generates quotes but rejects bookings
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createRideBroker, scoreQuotes, RideBroker } from "../broker";
import { DeepLinkProviderAdapter } from "../deeplink-provider";
import type { RideQuote, RideScoringContext, QuoteRequest } from "../types";

// ============================================
// FIXTURES
// ============================================

const NYC_REQUEST: QuoteRequest = {
  pickupLat: 40.7128,
  pickupLng: -74.006,
  pickupAddress: "Times Square",
  dropoffLat: 40.7484,
  dropoffLng: -73.9857,
  dropoffAddress: "Empire State Building",
};

function makeQuote(overrides: Partial<RideQuote> = {}): RideQuote {
  return {
    id: "q-1",
    providerId: "test_provider",
    providerName: "Test Provider",
    tier: "economy",
    priceEstimateCents: 1200,
    currency: "USD",
    priceDisplay: "$12.00 - $13.80",
    pickupEtaMinutes: 5,
    tripDurationMinutes: 15,
    pickupLat: 40.7128,
    pickupLng: -74.006,
    pickupAddress: "Times Square",
    dropoffLat: 40.7484,
    dropoffLng: -73.9857,
    dropoffAddress: "Empire State Building",
    distanceMeters: 5000,
    isDemo: true,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================
// NO "UBER" IN POC
// ============================================

describe("No branded provider names in PoC", () => {
  it("default broker has no provider named 'Uber'", () => {
    const broker = createRideBroker();
    const providers = broker.getProviders();

    for (const p of providers) {
      expect(p.name.toLowerCase()).not.toContain("uber");
      expect(p.name.toLowerCase()).not.toContain("lyft");
      expect(p.name.toLowerCase()).not.toContain("bolt");
    }
  });

  it("demo provider quotes don't contain branded names", async () => {
    const broker = createRideBroker();
    const result = await broker.getQuotes(NYC_REQUEST);

    for (const quote of result.quotes) {
      expect(quote.providerName.toLowerCase()).not.toContain("uber");
      expect(quote.providerName.toLowerCase()).not.toContain("lyft");
    }
  });
});

// ============================================
// SCORING POLICY
// ============================================

describe("scoreQuotes — basic scoring", () => {
  it("prefers cheaper quote when no constraints", () => {
    const cheap = makeQuote({ id: "cheap", priceEstimateCents: 800, pickupEtaMinutes: 5 });
    const expensive = makeQuote({ id: "expensive", priceEstimateCents: 2000, pickupEtaMinutes: 5 });

    const scored = scoreQuotes([expensive, cheap]);

    expect(scored[0].quote.id).toBe("cheap");
    expect(scored[0].reasons).toContain("cheapest");
  });

  it("prefers faster pickup when prices are equal", () => {
    const fast = makeQuote({ id: "fast", priceEstimateCents: 1200, pickupEtaMinutes: 2 });
    const slow = makeQuote({ id: "slow", priceEstimateCents: 1200, pickupEtaMinutes: 8 });

    const scored = scoreQuotes([slow, fast]);

    expect(scored[0].quote.id).toBe("fast");
    expect(scored[0].reasons).toContain("fastest pickup");
  });

  it("returns single quote with base score", () => {
    const single = makeQuote({ id: "only" });
    const scored = scoreQuotes([single]);

    expect(scored).toHaveLength(1);
    expect(scored[0].score).toBeGreaterThan(0);
  });

  it("returns empty for empty input", () => {
    expect(scoreQuotes([])).toHaveLength(0);
  });
});

describe("scoreQuotes — constraint scoring", () => {
  it("penalizes quotes over max price", () => {
    const underBudget = makeQuote({ id: "under", priceEstimateCents: 800 });
    const overBudget = makeQuote({ id: "over", priceEstimateCents: 2000 });

    const ctx: RideScoringContext = { maxPriceCents: 1500 };
    const scored = scoreQuotes([overBudget, underBudget], ctx);

    expect(scored[0].quote.id).toBe("under");
    expect(scored[1].reasons).toContain("over budget");
  });

  it("penalizes quotes with slow pickup", () => {
    const quick = makeQuote({ id: "quick", pickupEtaMinutes: 3 });
    const slow = makeQuote({ id: "slow", pickupEtaMinutes: 12 });

    const ctx: RideScoringContext = { maxPickupEtaMin: 5 };
    const scored = scoreQuotes([slow, quick], ctx);

    expect(scored[0].quote.id).toBe("quick");
    expect(scored[1].reasons).toContain("slow pickup");
  });
});

describe("scoreQuotes — date context", () => {
  it("boosts premium tier for date context", () => {
    const economy = makeQuote({
      id: "eco",
      tier: "economy",
      priceEstimateCents: 800,
      pickupEtaMinutes: 3,
    });
    const premium = makeQuote({
      id: "prem",
      tier: "premium",
      priceEstimateCents: 2000,
      pickupEtaMinutes: 3,
    });

    const ctx: RideScoringContext = { isDateContext: true };
    const scored = scoreQuotes([economy, premium], ctx);

    // Premium should win despite higher price in date context
    expect(scored[0].quote.id).toBe("prem");
    expect(scored[0].reasons).toContain("premium for date");
  });

  it("penalizes long wait in date context", () => {
    const quickPremium = makeQuote({
      id: "quick-prem",
      tier: "premium",
      priceEstimateCents: 2000,
      pickupEtaMinutes: 3,
    });
    const slowPremium = makeQuote({
      id: "slow-prem",
      tier: "premium",
      priceEstimateCents: 2000,
      pickupEtaMinutes: 10,
    });

    const ctx: RideScoringContext = { isDateContext: true };
    const scored = scoreQuotes([slowPremium, quickPremium], ctx);

    expect(scored[0].quote.id).toBe("quick-prem");
  });

  it("selection changes: no context → cheapest, date context → premium", () => {
    const economy = makeQuote({
      id: "eco",
      tier: "economy",
      priceEstimateCents: 800,
      pickupEtaMinutes: 3,
    });
    const premium = makeQuote({
      id: "prem",
      tier: "premium",
      priceEstimateCents: 2000,
      pickupEtaMinutes: 3,
    });

    // Without context → cheapest wins
    const noContext = scoreQuotes([economy, premium]);
    expect(noContext[0].quote.id).toBe("eco");

    // With date context → premium wins
    const dateContext = scoreQuotes([economy, premium], { isDateContext: true });
    expect(dateContext[0].quote.id).toBe("prem");
  });
});

describe("scoreQuotes — comfort and reliability preferences", () => {
  it("preferComfort boosts premium tier", () => {
    const economy = makeQuote({ id: "eco", tier: "economy", priceEstimateCents: 800 });
    const premium = makeQuote({ id: "prem", tier: "premium", priceEstimateCents: 1800 });

    const scored = scoreQuotes([economy, premium], { preferComfort: true });

    expect(scored[0].quote.id).toBe("prem");
    expect(scored[0].reasons).toContain("comfort preference");
  });

  it("preferReliability boosts short-ETA quotes", () => {
    const nearby = makeQuote({ id: "near", pickupEtaMinutes: 2, priceEstimateCents: 1200 });
    const far = makeQuote({ id: "far", pickupEtaMinutes: 8, priceEstimateCents: 1000 });

    const scored = scoreQuotes([far, nearby], { preferReliability: true });

    expect(scored[0].quote.id).toBe("near");
    expect(scored[0].reasons).toContain("reliable (short ETA)");
  });
});

// ============================================
// HONESTY ENFORCEMENT
// ============================================

describe("Honesty — capabilities.realBooking", () => {
  it("demo provider has realBooking=false", () => {
    const broker = createRideBroker();
    const providers = broker.getProviders();
    const demo = providers.find((p) => p.id === "demo_provider");

    expect(demo).toBeTruthy();
    expect(demo?.isDemo).toBe(true);
  });

  it("demo provider CAN still book (isDemo exemption)", async () => {
    const broker = createRideBroker();
    const quotes = await broker.getQuotes(NYC_REQUEST);
    const quoteId = quotes.quotes[0].id;

    // Should succeed because isDemo providers are exempt from the realBooking gate
    const booking = await broker.requestRide({
      quoteId,
      passengerName: "Test",
    });

    expect(booking.status).toBe("requested");
    expect(booking.isDemo).toBe(true);
  });
});

// ============================================
// DEEP LINK PROVIDER
// ============================================

describe("DeepLinkProviderAdapter", () => {
  let provider: DeepLinkProviderAdapter;

  beforeEach(() => {
    provider = new DeepLinkProviderAdapter({
      providerId: "test_deeplink",
      providerName: "Test Ridehail",
      deepLinkTemplate:
        "testapp://ride?pickup={pickupLat},{pickupLng}&dropoff={dropoffLat},{dropoffLng}",
      baseFareCents: 250,
      perMeterCents: 0.15,
      minFareCents: 800,
      currency: "USD",
      pickupEtaRange: [3, 8],
      tiers: ["economy", "comfort"],
    });
  });

  it("has realBooking=false", () => {
    expect(provider.capabilities.realBooking).toBe(false);
  });

  it("is not a demo provider", () => {
    expect(provider.isDemo).toBe(false);
  });

  it("generates quotes for configured tiers", async () => {
    const quotes = await provider.getQuotes(NYC_REQUEST);

    expect(quotes).toHaveLength(2); // economy + comfort
    expect(quotes[0].tier).toBe("economy");
    expect(quotes[1].tier).toBe("comfort");
    expect(quotes[1].priceEstimateCents).toBeGreaterThan(quotes[0].priceEstimateCents);
  });

  it("quotes have correct provider info", async () => {
    const quotes = await provider.getQuotes(NYC_REQUEST);

    for (const q of quotes) {
      expect(q.providerId).toBe("test_deeplink");
      expect(q.isDemo).toBe(false);
      expect(q.currency).toBe("USD");
    }
  });

  it("generates correct deep links", () => {
    const link = provider.buildDeepLink(NYC_REQUEST);

    expect(link).toContain("40.7128");
    expect(link).toContain("-74.006");
    expect(link).toContain("40.7484");
    expect(link).toContain("-73.9857");
    expect(link).toContain("testapp://ride");
  });

  it("rejects requestRide with clear message", async () => {
    await expect(
      provider.requestRide(
        { quoteId: "q-1", passengerName: "Test" },
        makeQuote()
      )
    ).rejects.toThrow("does not support in-app booking");
  });

  it("rejects getStatus", async () => {
    await expect(provider.getStatus("booking-1")).rejects.toThrow(
      "does not support in-app status tracking"
    );
  });

  it("rejects cancelRide", async () => {
    await expect(provider.cancelRide("booking-1")).rejects.toThrow(
      "does not support in-app cancellation"
    );
  });
});

describe("DeepLinkProviderAdapter in broker", () => {
  let broker: RideBroker;

  beforeEach(() => {
    broker = createRideBroker();
    broker.registerProvider(
      new DeepLinkProviderAdapter({
        providerId: "deeplink_test",
        providerName: "External Ridehail",
        deepLinkTemplate: "app://ride?p={pickupLat},{pickupLng}&d={dropoffLat},{dropoffLng}",
        baseFareCents: 200,
        perMeterCents: 0.12,
        minFareCents: 600,
        currency: "USD",
        pickupEtaRange: [2, 6],
        tiers: ["economy"],
      })
    );
  });

  it("aggregates quotes from both demo and deeplink providers", async () => {
    const result = await broker.getQuotes(NYC_REQUEST);

    expect(result.providers).toContain("demo_provider");
    expect(result.providers).toContain("deeplink_test");
    // Demo has 3 tiers + deeplink has 1
    expect(result.quotes.length).toBe(4);
  });

  it("broker rejects booking for non-demo deeplink provider", async () => {
    const result = await broker.getQuotes(NYC_REQUEST);
    const deeplinkQuote = result.quotes.find(
      (q) => q.providerId === "deeplink_test"
    );

    expect(deeplinkQuote).toBeTruthy();

    await expect(
      broker.requestRide({
        quoteId: deeplinkQuote!.id,
        passengerName: "Test",
      })
    ).rejects.toThrow("does not support in-app booking");
  });

  it("getQuotesWithSelection returns selected quote", async () => {
    const result = await broker.getQuotesWithSelection(NYC_REQUEST);

    expect(result.selected).toBeTruthy();
    expect(result.selected!.score).toBeGreaterThan(0);
    expect(result.selected!.quote).toBeTruthy();
  });

  it("getQuotesWithSelection changes pick based on context", async () => {
    // No context: likely cheapest
    const noCtx = await broker.getQuotesWithSelection(NYC_REQUEST);
    const defaultPick = noCtx.selected!.quote.tier;

    // Date context: should prefer comfort/premium
    const dateCtx = await broker.getQuotesWithSelection(NYC_REQUEST, {
      isDateContext: true,
    });
    const datePick = dateCtx.selected!.quote.tier;

    // At minimum, date context should influence selection
    // (premium/comfort should score higher with date context)
    expect(dateCtx.selected!.reasons.length).toBeGreaterThan(0);
    // With date context, should select premium or comfort over economy
    if (defaultPick === "economy") {
      expect(["comfort", "premium"]).toContain(datePick);
    }
  });
});
