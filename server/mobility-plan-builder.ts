/**
 * MOBILITY PLAN BUILDER
 *
 * Converts RouteRecommendation to MobilityPlan and applies entitlements.
 * This bridges the existing agent-service with the new mobility abstraction.
 */

import type { RouteRecommendation, RouteStep, UserPackage, Entitlement as DBEntitlement } from "@shared/schema";
import type {
  MobilityPlan,
  MobilityStep,
  CityCode,
  Mode,
  Coverage,
  StressLevel,
  Execution,
} from "../packages/core/mobility/types";
import { stressScoreToLevel, getCoverageLabel } from "../packages/core/mobility/types";
import { assertPlanProviderMatch } from "../packages/core/mobility/assertions";
import type { EntitlementSet } from "../packages/core/entitlements/types";
import {
  buildEntitlementSet,
  applyEntitlementsToPlan,
  generatePassInsight,
} from "../packages/core/entitlements/engine";
import {
  getProvidersForCity,
  getProviderById,
  getTransitProvider,
  getRidehailProvider,
  getBikeProvider,
} from "../packages/providers/catalog";
import type { ProviderAdapter } from "../packages/providers/types";

// ============================================
// MODE CONVERSION
// ============================================

function routeStepTypeToMode(stepType: RouteStep["type"]): Mode {
  switch (stepType) {
    case "walk":
      return "walk";
    case "transit":
      return "transit";
    case "rideshare":
      return "ridehail";
    case "wait":
    case "transfer":
      return "walk"; // Waiting/transfers count as walking time
    default:
      return "walk";
  }
}

function recommendationModeToMode(mode: RouteRecommendation["mode"]): Mode {
  switch (mode) {
    case "walk":
      return "walk";
    case "transit":
      return "transit";
    case "rideshare":
      return "ridehail";
    case "bike":
      return "bike";
    case "mixed":
      return "transit"; // Default mixed to transit
    default:
      return "walk";
  }
}

// ============================================
// BUILD MOBILITY STEP
// ============================================

function buildMobilityStep(
  step: RouteStep,
  cityCode: CityCode,
  providers: ProviderAdapter[]
): MobilityStep {
  const mode = routeStepTypeToMode(step.type);

  // Find the relevant provider for this step
  let provider: ProviderAdapter | undefined;
  let execution: Execution | undefined;

  if (mode === "transit") {
    provider = providers.find((p) => p.type === "transit");
    if (provider) {
      const deepLink = provider.getDeepLink({
        origin: { name: step.transitDetails?.departureStop || "" },
        destination: { name: step.transitDetails?.arrivalStop || "" },
      });
      execution = deepLink.execution;
    }
  } else if (mode === "ridehail") {
    provider = providers.find((p) => p.type === "ridehail");
    if (provider && step.deepLink) {
      execution = {
        type: "deeplink",
        url: step.deepLink,
        label: `Open ${provider.displayName}`,
      };
    } else if (provider) {
      const deepLink = provider.getDeepLink({
        origin: { name: "" },
        destination: { name: "" },
      });
      execution = deepLink.execution;
    }
  } else if (mode === "bike") {
    provider = providers.find((p) => p.type === "bike");
    if (provider) {
      const deepLink = provider.getDeepLink({
        origin: { name: "" },
        destination: { name: "" },
      });
      execution = deepLink.execution;
    }
  } else if (mode === "walk") {
    // Walking steps can have a Google Maps link
    if (step.navigationDeepLink) {
      execution = {
        type: "deeplink",
        url: step.navigationDeepLink,
        label: "Navigate",
      };
    } else {
      execution = { type: "walk" };
    }
  }

  const mobilityStep: MobilityStep = {
    mode,
    providerId: provider?.id,
    providerName: provider?.displayName,
    instruction: step.instruction,
    durationMin: step.duration,
    distanceM: step.distance,
    stops: step.stopsCount,
    coverage: "unknown", // Will be set by entitlements engine
    execution,
  };

  // Add transit details if available
  if (step.transitDetails) {
    mobilityStep.transitDetails = {
      line: step.line,
      direction: step.direction,
      departureStop: step.transitDetails.departureStop,
      arrivalStop: step.transitDetails.arrivalStop,
      departureTime: step.transitDetails.departureTime,
      arrivalTime: step.transitDetails.arrivalTime,
      vehicleType: step.transitDetails.vehicleType,
    };
  }

  return mobilityStep;
}

// ============================================
// BUILD MOBILITY PLAN
// ============================================

export interface BuildMobilityPlanInput {
  recommendation: RouteRecommendation;
  cityCode: CityCode;
  origin: { name: string; lat?: number; lng?: number };
  destination: { name: string; lat?: number; lng?: number };
  activePackage?: UserPackage | null;
}

export interface BuildMobilityPlanResult {
  mobilityPlan: MobilityPlan;
  entitlementSet: EntitlementSet;
  passInsight: string | null;
}

/**
 * Build a MobilityPlan from a RouteRecommendation
 * This applies entitlements and generates provider-specific deep links
 */
export function buildMobilityPlan(input: BuildMobilityPlanInput): BuildMobilityPlanResult {
  const { recommendation, cityCode, origin, destination, activePackage } = input;

  // Get providers for this city
  const providers = getProvidersForCity(cityCode);

  // Build mobility steps from route steps
  const steps: MobilityStep[] = recommendation.steps.map((step) =>
    buildMobilityStep(step, cityCode, providers)
  );

  // Calculate totals
  const totals = {
    durationMin: recommendation.estimatedDuration,
    walkingMin: steps
      .filter((s) => s.mode === "walk")
      .reduce((sum, s) => sum + (s.durationMin || 0), 0),
    transfers: steps.filter(
      (s) => s.mode === "transit" && s.transitDetails
    ).length - 1,
  };
  if (totals.transfers < 0) totals.transfers = 0;

  // Build deep links for each provider used
  const usedProviderIds = new Set<string>();
  for (const step of steps) {
    if (step.providerId) {
      usedProviderIds.add(step.providerId);
    }
  }

  const deepLinks = Array.from(usedProviderIds)
    .map((providerId) => {
      const provider = getProviderById(providerId);
      if (!provider) return null;

      const linkResult = provider.getDeepLink({ origin, destination });
      return {
        providerId: provider.id,
        providerName: provider.displayName,
        url: linkResult.url,
        label: linkResult.label,
      };
    })
    .filter(Boolean) as MobilityPlan["deepLinks"];

  // Build initial plan (without entitlements applied)
  let mobilityPlan: MobilityPlan = {
    cityCode,
    origin: { name: origin.name, lat: origin.lat, lng: origin.lng },
    destination: { name: destination.name, lat: destination.lat, lng: destination.lng },
    steps,
    totals,
    labels: {
      stress: stressScoreToLevel(recommendation.stressScore),
      costLabel: recommendation.costDisplay || "Standard fares apply",
    },
    deepLinks,
    debug: {
      providerIdsUsed: Array.from(usedProviderIds),
      llmUsed: true, // Assume LLM was used (agent-service tracks this)
      decisionReason: recommendation.reasoning,
    },
  };

  // Build entitlement set
  let entitlementSet: EntitlementSet;
  if (activePackage) {
    const rawEntitlements = activePackage.entitlements as DBEntitlement[];
    entitlementSet = buildEntitlementSet(
      activePackage.userId,
      cityCode,
      activePackage.packageId,
      `Pass (${activePackage.packageId})`, // Package name from ID for now
      rawEntitlements.map((e) => ({
        providerId: e.providerId,
        providerName: e.providerName,
        providerType: e.providerType,
        benefitType: e.benefitType,
        value: e.value,
        remainingUses: e.remainingUses,
        activatedAt: e.activatedAt,
      })),
      new Date(activePackage.startAt),
      new Date(activePackage.endAt)
    );
  } else {
    entitlementSet = {
      userId: "",
      cityCode,
      isActive: false,
      validFrom: new Date().toISOString(),
      validUntil: new Date().toISOString(),
      entitlements: [],
      hasTransitPass: false,
      hasRidehailDiscount: false,
      hasBikeBenefit: false,
      allVerified: false,
      verificationStatus: {},
    };
  }

  // Apply entitlements to the plan
  mobilityPlan = applyEntitlementsToPlan(mobilityPlan, entitlementSet);

  // Generate pass insight
  const passInsight = generatePassInsight(mobilityPlan, entitlementSet);

  // Assert provider/city consistency
  try {
    assertPlanProviderMatch(mobilityPlan);
  } catch (error) {
    console.warn("Provider/city mismatch detected:", error);
  }

  return {
    mobilityPlan,
    entitlementSet,
    passInsight,
  };
}

// ============================================
// GET ACTIVATION CHECKLIST
// ============================================

export interface ProviderActivationItem {
  providerId: string;
  providerName: string;
  providerType: "transit" | "ridehail" | "bike";
  status: "active" | "pending" | "requires_action";
  actionLabel?: string;
  actionUrl?: string;
}

/**
 * Get activation checklist for a user's package
 */
export function getActivationChecklist(
  cityCode: CityCode,
  entitlementSet: EntitlementSet
): ProviderActivationItem[] {
  const providers = getProvidersForCity(cityCode);
  const items: ProviderActivationItem[] = [];

  for (const provider of providers) {
    // Check if user has an entitlement for this provider type
    const hasEntitlement = entitlementSet.entitlements.some((e) => {
      if (provider.type === "transit" && e.type === "transit_pass") return true;
      if (provider.type === "ridehail" && e.type === "ridehail_discount") return true;
      if (provider.type === "bike" && e.type === "bike_unlock") return true;
      return false;
    });

    if (!hasEntitlement) continue;

    // Check verification status
    const isVerified = entitlementSet.verificationStatus[provider.id] ?? false;

    // Build activation item based on provider capabilities
    let status: ProviderActivationItem["status"] = "pending";
    let actionLabel: string | undefined;
    let actionUrl: string | undefined;

    if (isVerified) {
      status = "active";
    } else if (provider.capabilities.supportsActivationApi) {
      status = "pending";
      actionLabel = "Activate";
    } else if (provider.capabilities.supportsDeepLink) {
      status = "requires_action";
      actionLabel = `Open ${provider.displayName} to activate`;
      const deepLink = provider.getDeepLink({
        origin: { name: "" },
        destination: { name: "" },
      });
      actionUrl = deepLink.url;
    }

    items.push({
      providerId: provider.id,
      providerName: provider.displayName,
      providerType: provider.type,
      status,
      actionLabel,
      actionUrl,
    });
  }

  return items;
}
