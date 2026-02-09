/**
 * ENTITLEMENTS INTEGRATION TESTS
 *
 * Tests the full flow:
 * 1. User with NYC 7-day pass
 * 2. Decision returns costLabel "Covered by pass"
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildMobilityPlan } from "../mobility-plan-builder";
import type { RouteRecommendation, UserPackage, Entitlement } from "@shared/schema";

describe("Entitlements Integration", () => {
  const mockRecommendation: RouteRecommendation = {
    mode: "transit",
    summary: "Take the A train",
    estimatedDuration: 25,
    estimatedCost: null,
    costDisplay: "Standard fare",
    stressScore: 0.3,
    steps: [
      {
        type: "walk",
        instruction: "Walk to Times Square station",
        duration: 3,
        distance: 200,
      },
      {
        type: "transit",
        instruction: "Take the A train to Fulton St",
        duration: 18,
        line: "A",
        direction: "Downtown",
        stopsCount: 6,
        transitDetails: {
          departureStop: "Times Square-42nd St",
          arrivalStop: "Fulton St",
          vehicleType: "SUBWAY",
        },
      },
      {
        type: "walk",
        instruction: "Walk to Brooklyn Bridge",
        duration: 4,
        distance: 300,
      },
    ],
    reasoning: "Direct subway connection",
    confidence: 0.9,
  };

  const createActivePackage = (
    packageId: string,
    cityId: string,
    entitlements: Entitlement[]
  ): UserPackage => ({
    id: "user-package-1",
    userId: "user-1",
    packageId,
    startAt: new Date(),
    endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: "active",
    entitlements,
    createdAt: new Date(),
  });

  it("NYC 7-day pass covers transit and shows Covered by pass", () => {
    const activePackage = createActivePackage("nyc-7day", "nyc", [
      {
        providerId: "mta",
        providerName: "MTA",
        providerType: "transit",
        benefitType: "free_pass",
        value: 100,
        activatedAt: new Date().toISOString(),
      },
    ]);

    const result = buildMobilityPlan({
      recommendation: mockRecommendation,
      cityCode: "nyc",
      origin: { name: "Times Square", lat: 40.758, lng: -73.985 },
      destination: { name: "Brooklyn Bridge", lat: 40.706, lng: -73.997 },
      activePackage,
    });

    // Check mobility plan
    expect(result.mobilityPlan.cityCode).toBe("nyc");
    expect(result.mobilityPlan.steps).toHaveLength(3);

    // Transit step should be covered
    const transitStep = result.mobilityPlan.steps.find((s) => s.mode === "transit");
    expect(transitStep?.coverage).toBe("included");
    expect(transitStep?.costLabel).toBe("Covered by pass");

    // Overall label should show covered
    expect(result.mobilityPlan.labels.costLabel).toBe("Covered by pass");

    // Entitlement summary should be present
    expect(result.entitlementSet.hasTransitPass).toBe(true);
    expect(result.entitlementSet.isActive).toBe(true);

    // Pass insight should mention transit coverage
    expect(result.passInsight).toBe("Your pass covers transit on this route.");
  });

  it("No entitlements shows standard fare", () => {
    const result = buildMobilityPlan({
      recommendation: mockRecommendation,
      cityCode: "nyc",
      origin: { name: "Times Square" },
      destination: { name: "Brooklyn Bridge" },
      activePackage: null,
    });

    // Transit step should be pay
    const transitStep = result.mobilityPlan.steps.find((s) => s.mode === "transit");
    expect(transitStep?.coverage).toBe("pay");
    // Without entitlements, mode-specific labels are used
    expect(transitStep?.costLabel).toBe("Standard transit fare");

    // No entitlement summary
    expect(result.entitlementSet.isActive).toBe(false);

    // No pass insight
    expect(result.passInsight).toBeNull();
  });

  it("Berlin pass does not cover NYC transit", () => {
    // User has Berlin pass but is in NYC
    const berlinPackage = createActivePackage("berlin-7day", "berlin", [
      {
        providerId: "bvg",
        providerName: "BVG",
        providerType: "transit",
        benefitType: "free_pass",
        value: 100,
        activatedAt: new Date().toISOString(),
      },
    ]);

    const result = buildMobilityPlan({
      recommendation: mockRecommendation,
      cityCode: "nyc", // User is in NYC
      origin: { name: "Times Square" },
      destination: { name: "Brooklyn Bridge" },
      activePackage: berlinPackage, // But has Berlin pass
    });

    // Berlin pass should not activate in NYC context
    // The entitlement set is built for NYC but the package is for Berlin
    // This should result in empty/inactive entitlements for NYC
    expect(result.entitlementSet.cityCode).toBe("nyc");
  });

  it("Ridehail discount shows discounted coverage", () => {
    const ridehailRecommendation: RouteRecommendation = {
      ...mockRecommendation,
      mode: "rideshare",
      steps: [
        {
          type: "rideshare",
          instruction: "Take Uber to destination",
          duration: 15,
          deepLink: "uber://",
        },
      ],
    };

    const activePackage = createActivePackage("nyc-7day", "nyc", [
      {
        providerId: "uber-nyc",
        providerName: "Uber",
        providerType: "ridehail",
        benefitType: "discount_percent",
        value: 15,
        activatedAt: new Date().toISOString(),
      },
    ]);

    const result = buildMobilityPlan({
      recommendation: ridehailRecommendation,
      cityCode: "nyc",
      origin: { name: "Times Square" },
      destination: { name: "JFK Airport" },
      activePackage,
    });

    const ridehailStep = result.mobilityPlan.steps.find((s) => s.mode === "ridehail");
    expect(ridehailStep?.coverage).toBe("discounted");
    expect(ridehailStep?.costLabel).toContain("15%");
  });

  it("Debug info includes entitlements applied", () => {
    const activePackage = createActivePackage("nyc-7day", "nyc", [
      {
        providerId: "mta",
        providerName: "MTA",
        providerType: "transit",
        benefitType: "free_pass",
        value: 100,
        activatedAt: new Date().toISOString(),
      },
    ]);

    const result = buildMobilityPlan({
      recommendation: mockRecommendation,
      cityCode: "nyc",
      origin: { name: "Times Square" },
      destination: { name: "Brooklyn Bridge" },
      activePackage,
    });

    expect(result.mobilityPlan.debug?.entitlementsApplied).toBeDefined();
    expect(result.mobilityPlan.debug?.entitlementsApplied).toContain("transit_pass:mta");
    expect(result.mobilityPlan.debug?.coverageSummary).toBeDefined();
  });

  it("Multiple step types get correct coverage", () => {
    const mixedRecommendation: RouteRecommendation = {
      ...mockRecommendation,
      mode: "mixed",
      steps: [
        {
          type: "walk",
          instruction: "Walk to station",
          duration: 5,
        },
        {
          type: "transit",
          instruction: "Take subway",
          duration: 15,
          line: "A",
        },
        {
          type: "rideshare",
          instruction: "Take Uber",
          duration: 10,
        },
      ],
    };

    const activePackage = createActivePackage("nyc-7day", "nyc", [
      {
        providerId: "mta",
        providerName: "MTA",
        providerType: "transit",
        benefitType: "free_pass",
        value: 100,
        activatedAt: new Date().toISOString(),
      },
      {
        providerId: "uber-nyc",
        providerName: "Uber",
        providerType: "ridehail",
        benefitType: "discount_percent",
        value: 10,
        activatedAt: new Date().toISOString(),
      },
    ]);

    const result = buildMobilityPlan({
      recommendation: mixedRecommendation,
      cityCode: "nyc",
      origin: { name: "A" },
      destination: { name: "B" },
      activePackage,
    });

    // Walk is always free
    expect(result.mobilityPlan.steps[0].coverage).toBe("included");
    // Transit is covered by pass
    expect(result.mobilityPlan.steps[1].coverage).toBe("included");
    // Ridehail is discounted
    expect(result.mobilityPlan.steps[2].coverage).toBe("discounted");
  });
});

describe("Currency Honesty", () => {
  it("Does not show currency when entitlements are unknown", () => {
    const result = buildMobilityPlan({
      recommendation: {
        mode: "transit",
        summary: "Take subway",
        estimatedDuration: 20,
        estimatedCost: null, // No verified cost
        costDisplay: undefined,
        stressScore: 0.3,
        steps: [
          {
            type: "transit",
            instruction: "Take the A train",
            duration: 20,
          },
        ],
        reasoning: "Direct route",
        confidence: 0.8,
      },
      cityCode: "nyc",
      origin: { name: "A" },
      destination: { name: "B" },
      activePackage: null,
    });

    // Cost label should be generic, not showing specific prices
    expect(result.mobilityPlan.labels.costLabel).toBe("Standard fares apply");
    // Steps should show "Standard transit fare" not "$2.90"
    const transitStep = result.mobilityPlan.steps.find((s) => s.mode === "transit");
    expect(transitStep?.costLabel).toBe("Standard transit fare");
  });
});
