/**
 * ENTITLEMENTS ENGINE TESTS
 */

import { describe, it, expect } from "vitest";
import {
  buildEntitlementSet,
  getCoverageForStep,
  applyEntitlementsToPlan,
  generatePassInsight,
} from "../engine";
import { createEmptyEntitlementSet } from "../types";
import type { MobilityPlan, MobilityStep } from "../../mobility/types";

describe("buildEntitlementSet", () => {
  it("builds empty set when no entitlements provided", () => {
    const result = buildEntitlementSet(
      "user-1",
      "nyc",
      undefined,
      undefined,
      [],
      new Date(),
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    );

    expect(result.isActive).toBe(false);
    expect(result.entitlements).toHaveLength(0);
  });

  it("builds transit pass entitlement correctly", () => {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const result = buildEntitlementSet(
      "user-1",
      "nyc",
      "nyc-7day",
      "NYC 7-Day Pass",
      [
        {
          providerId: "mta",
          providerName: "MTA",
          providerType: "transit",
          benefitType: "free_pass",
          value: 100,
          activatedAt: now.toISOString(),
        },
      ],
      now,
      endDate
    );

    expect(result.isActive).toBe(true);
    expect(result.hasTransitPass).toBe(true);
    expect(result.entitlements).toHaveLength(1);
    expect(result.entitlements[0].type).toBe("transit_pass");
  });

  it("builds ridehail discount entitlement correctly", () => {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const result = buildEntitlementSet(
      "user-1",
      "berlin",
      "berlin-7day",
      "Berlin 7-Day Pass",
      [
        {
          providerId: "bolt-berlin",
          providerName: "Bolt",
          providerType: "ridehail",
          benefitType: "discount_percent",
          value: 20,
          activatedAt: now.toISOString(),
        },
      ],
      now,
      endDate
    );

    expect(result.isActive).toBe(true);
    expect(result.hasRidehailDiscount).toBe(true);
    expect(result.entitlements[0].type).toBe("ridehail_discount");
    if (result.entitlements[0].type === "ridehail_discount") {
      expect(result.entitlements[0].percentOff).toBe(20);
    }
  });

  it("marks set as inactive when expired", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    const result = buildEntitlementSet(
      "user-1",
      "nyc",
      "nyc-7day",
      "NYC 7-Day Pass",
      [
        {
          providerId: "mta",
          providerName: "MTA",
          providerType: "transit",
          benefitType: "free_pass",
          value: 100,
          activatedAt: pastDate.toISOString(),
        },
      ],
      pastDate,
      endDate
    );

    expect(result.isActive).toBe(false);
  });
});

describe("getCoverageForStep", () => {
  it("returns included for transit with transit pass", () => {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const entitlementSet = buildEntitlementSet(
      "user-1",
      "nyc",
      "nyc-7day",
      "NYC 7-Day Pass",
      [
        {
          providerId: "mta",
          providerName: "MTA",
          providerType: "transit",
          benefitType: "free_pass",
          value: 100,
          activatedAt: now.toISOString(),
        },
      ],
      now,
      endDate
    );

    const result = getCoverageForStep(
      { mode: "transit", providerId: "mta" },
      entitlementSet
    );

    expect(result.coverage).toBe("included");
    expect(result.costLabel).toBe("Covered by pass");
  });

  it("returns discounted for ridehail with discount", () => {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const entitlementSet = buildEntitlementSet(
      "user-1",
      "berlin",
      "berlin-7day",
      "Berlin 7-Day Pass",
      [
        {
          providerId: "bolt-berlin",
          providerName: "Bolt",
          providerType: "ridehail",
          benefitType: "discount_percent",
          value: 15,
          activatedAt: now.toISOString(),
        },
      ],
      now,
      endDate
    );

    const result = getCoverageForStep(
      { mode: "ridehail", providerId: "bolt-berlin" },
      entitlementSet
    );

    expect(result.coverage).toBe("discounted");
    expect(result.discountPercent).toBe(15);
    expect(result.costLabel).toContain("15%");
  });

  it("returns pay for step without entitlement", () => {
    const emptySet = createEmptyEntitlementSet("user-1", "nyc");

    const result = getCoverageForStep(
      { mode: "transit", providerId: "mta" },
      emptySet
    );

    expect(result.coverage).toBe("pay");
    expect(result.costLabel).toBe("Standard transit fare");
  });

  it("returns included for walk (always free)", () => {
    const emptySet = createEmptyEntitlementSet("user-1", "nyc");

    const result = getCoverageForStep({ mode: "walk" }, emptySet);

    expect(result.coverage).toBe("included");
    expect(result.costLabel).toBe("Free");
  });
});

describe("applyEntitlementsToPlan", () => {
  const basePlan: MobilityPlan = {
    cityCode: "nyc",
    origin: { name: "Times Square" },
    destination: { name: "Brooklyn Bridge" },
    steps: [
      {
        mode: "walk",
        instruction: "Walk to subway",
        durationMin: 5,
        coverage: "unknown",
      },
      {
        mode: "transit",
        providerId: "mta",
        instruction: "Take the A train",
        durationMin: 20,
        coverage: "unknown",
      },
      {
        mode: "walk",
        instruction: "Walk to destination",
        durationMin: 3,
        coverage: "unknown",
      },
    ],
    totals: { durationMin: 28, walkingMin: 8, transfers: 0 },
    labels: { stress: "low", costLabel: "Standard fares apply" },
    deepLinks: [],
  };

  it("applies transit pass to transit steps", () => {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const entitlementSet = buildEntitlementSet(
      "user-1",
      "nyc",
      "nyc-7day",
      "NYC 7-Day Pass",
      [
        {
          providerId: "mta",
          providerName: "MTA",
          providerType: "transit",
          benefitType: "free_pass",
          value: 100,
          activatedAt: now.toISOString(),
        },
      ],
      now,
      endDate
    );

    const result = applyEntitlementsToPlan(basePlan, entitlementSet);

    // Walk steps should be "included" (free)
    expect(result.steps[0].coverage).toBe("included");
    // Transit step should be "included" with pass
    expect(result.steps[1].coverage).toBe("included");
    expect(result.steps[1].costLabel).toBe("Covered by pass");
    // Overall should show covered
    expect(result.labels.costLabel).toBe("Covered by pass");
    expect(result.entitlementSummary?.hasActivePass).toBe(true);
  });

  it("sets pay coverage when no entitlements", () => {
    const emptySet = createEmptyEntitlementSet("user-1", "nyc");

    const result = applyEntitlementsToPlan(basePlan, emptySet);

    // Walk steps should still be "included"
    expect(result.steps[0].coverage).toBe("included");
    // Transit step should be "pay"
    expect(result.steps[1].coverage).toBe("pay");
    expect(result.labels.costLabel).toBe("Standard fares apply");
    expect(result.entitlementSummary).toBeUndefined();
  });
});

describe("generatePassInsight", () => {
  it("generates transit insight when pass covers transit", () => {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const plan: MobilityPlan = {
      cityCode: "nyc",
      origin: { name: "A" },
      destination: { name: "B" },
      steps: [
        { mode: "transit", instruction: "Take subway", coverage: "included" },
      ],
      totals: { durationMin: 20, walkingMin: 0, transfers: 0 },
      labels: { stress: "low", costLabel: "Covered by pass" },
      deepLinks: [],
    };

    const entitlementSet = buildEntitlementSet(
      "user-1",
      "nyc",
      "nyc-7day",
      "NYC 7-Day Pass",
      [
        {
          providerId: "mta",
          providerName: "MTA",
          providerType: "transit",
          benefitType: "free_pass",
          value: 100,
          activatedAt: now.toISOString(),
        },
      ],
      now,
      endDate
    );

    const insight = generatePassInsight(plan, entitlementSet);

    expect(insight).toBe("Your pass covers transit on this route.");
  });

  it("generates ridehail discount insight", () => {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const plan: MobilityPlan = {
      cityCode: "berlin",
      origin: { name: "A" },
      destination: { name: "B" },
      steps: [
        { mode: "ridehail", instruction: "Take Bolt", coverage: "discounted" },
      ],
      totals: { durationMin: 15, walkingMin: 0, transfers: 0 },
      labels: { stress: "low", costLabel: "20% off" },
      deepLinks: [],
    };

    const entitlementSet = buildEntitlementSet(
      "user-1",
      "berlin",
      "berlin-7day",
      "Berlin 7-Day Pass",
      [
        {
          providerId: "bolt-berlin",
          providerName: "Bolt",
          providerType: "ridehail",
          benefitType: "discount_percent",
          value: 20,
          activatedAt: now.toISOString(),
        },
      ],
      now,
      endDate
    );

    const insight = generatePassInsight(plan, entitlementSet);

    expect(insight).toBe("Your pass gives 20% off this ride.");
  });

  it("returns null when no active entitlements", () => {
    const plan: MobilityPlan = {
      cityCode: "nyc",
      origin: { name: "A" },
      destination: { name: "B" },
      steps: [
        { mode: "transit", instruction: "Take subway", coverage: "pay" },
      ],
      totals: { durationMin: 20, walkingMin: 0, transfers: 0 },
      labels: { stress: "low", costLabel: "Standard fare" },
      deepLinks: [],
    };

    const emptySet = createEmptyEntitlementSet("user-1", "nyc");
    const insight = generatePassInsight(plan, emptySet);

    expect(insight).toBeNull();
  });
});
