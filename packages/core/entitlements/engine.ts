/**
 * ENTITLEMENTS ENGINE
 *
 * Core logic for:
 * 1. Loading active entitlements for a user
 * 2. Applying entitlements to a mobility plan
 * 3. Determining coverage for individual steps
 *
 * HONESTY RULES:
 * - If entitlements are not verified, label as "Eligible" not "Included"
 * - Never show exact prices unless verified from provider
 * - Unknown status should be clearly communicated
 */

import type { MobilityPlan, MobilityStep, Coverage, Mode } from "../mobility/types";
import { getCoverageLabel } from "../mobility/types";
import type {
  EntitlementSet,
  Entitlement,
  TransitPass,
  RidehailDiscount,
  BikeUnlock,
  CoverageResult,
  ProviderType,
} from "./types";
import { createEmptyEntitlementSet } from "./types";

// ============================================
// GET ACTIVE ENTITLEMENTS
// ============================================

/**
 * Build an EntitlementSet from raw entitlement data
 */
export function buildEntitlementSet(
  userId: string,
  cityCode: string,
  packageId: string | undefined,
  packageName: string | undefined,
  rawEntitlements: Array<{
    providerId: string;
    providerName: string;
    providerType: ProviderType;
    benefitType: string;
    value: number;
    remainingUses?: number;
    activatedAt: string;
  }>,
  validFrom: Date,
  validUntil: Date
): EntitlementSet {
  const now = new Date();
  const isActive = now >= validFrom && now <= validUntil;

  if (!isActive || rawEntitlements.length === 0) {
    return createEmptyEntitlementSet(userId, cityCode);
  }

  const entitlements: Entitlement[] = [];
  const verificationStatus: Record<string, boolean> = {};

  for (const raw of rawEntitlements) {
    // For now, all entitlements from our system are considered verified
    // In real implementation, this would check provider API
    const isVerified = true;
    verificationStatus[raw.providerId] = isVerified;

    if (raw.providerType === "transit" && raw.benefitType === "free_pass") {
      entitlements.push({
        type: "transit_pass",
        providerId: raw.providerId,
        providerName: raw.providerName,
        unlimited: true,
        validUntil: validUntil.toISOString(),
        isVerified,
      });
    } else if (raw.providerType === "ridehail" && raw.benefitType === "discount_percent") {
      entitlements.push({
        type: "ridehail_discount",
        providerId: raw.providerId,
        providerName: raw.providerName,
        percentOff: raw.value,
        validUntil: validUntil.toISOString(),
        isVerified,
      });
    } else if (raw.providerType === "bike") {
      const existing = entitlements.find(
        (e) => e.type === "bike_unlock" && e.providerId === raw.providerId
      ) as BikeUnlock | undefined;

      if (existing) {
        // Merge bike benefits
        if (raw.benefitType === "free_unlocks") {
          existing.freeUnlocksPerDay = raw.value;
          existing.remainingUnlocksToday = raw.remainingUses ?? raw.value;
        } else if (raw.benefitType === "free_minutes") {
          existing.includedMinutesPerDay = raw.value;
          existing.remainingMinutesToday = raw.value; // Reset daily
        }
      } else {
        entitlements.push({
          type: "bike_unlock",
          providerId: raw.providerId,
          providerName: raw.providerName,
          freeUnlocksPerDay: raw.benefitType === "free_unlocks" ? raw.value : undefined,
          includedMinutesPerDay: raw.benefitType === "free_minutes" ? raw.value : undefined,
          remainingUnlocksToday: raw.benefitType === "free_unlocks" ? (raw.remainingUses ?? raw.value) : undefined,
          remainingMinutesToday: raw.benefitType === "free_minutes" ? raw.value : undefined,
          validUntil: validUntil.toISOString(),
          isVerified,
        });
      }
    }
  }

  const hasTransitPass = entitlements.some((e) => e.type === "transit_pass");
  const hasRidehailDiscount = entitlements.some((e) => e.type === "ridehail_discount");
  const hasBikeBenefit = entitlements.some((e) => e.type === "bike_unlock");
  const allVerified = Object.values(verificationStatus).every((v) => v);

  return {
    userId,
    cityCode,
    packageId,
    packageName,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    isActive: true,
    entitlements,
    hasTransitPass,
    hasRidehailDiscount,
    hasBikeBenefit,
    allVerified,
    verificationStatus,
  };
}

// ============================================
// GET COVERAGE FOR A STEP
// ============================================

/**
 * Determine coverage for a single step based on entitlements
 */
export function getCoverageForStep(
  step: { mode: Mode; providerId?: string },
  entitlementSet: EntitlementSet
): CoverageResult {
  // Walking is ALWAYS free, regardless of entitlements
  if (step.mode === "walk") {
    return {
      coverage: "included",
      costLabel: "Free",
      isVerified: true,
    };
  }

  // If no active entitlements, return pay for non-walk steps
  if (!entitlementSet.isActive || entitlementSet.entitlements.length === 0) {
    // Return mode-specific labels when possible
    if (step.mode === "transit") {
      return {
        coverage: "pay",
        costLabel: "Standard transit fare",
        isVerified: false,
      };
    }
    if (step.mode === "ridehail") {
      return {
        coverage: "pay",
        costLabel: "Paid ride",
        isVerified: false,
      };
    }
    if (step.mode === "bike") {
      return {
        coverage: "pay",
        costLabel: "Bike rental",
        isVerified: false,
      };
    }
    return {
      coverage: "pay",
      costLabel: "Standard fare",
      isVerified: false,
    };
  }

  // Transit coverage
  if (step.mode === "transit") {
    const transitPass = entitlementSet.entitlements.find(
      (e) => e.type === "transit_pass"
    ) as TransitPass | undefined;

    if (transitPass && transitPass.unlimited) {
      const label = transitPass.isVerified ? "Covered by pass" : "Eligible (verify pass)";
      return {
        coverage: "included",
        costLabel: label,
        benefitApplied: entitlementSet.packageName || "Transit pass",
        isVerified: transitPass.isVerified,
      };
    }

    return {
      coverage: "pay",
      costLabel: "Standard transit fare",
      isVerified: false,
    };
  }

  // Ridehail coverage
  if (step.mode === "ridehail") {
    const ridehailDiscount = entitlementSet.entitlements.find(
      (e) => e.type === "ridehail_discount"
    ) as RidehailDiscount | undefined;

    if (ridehailDiscount && ridehailDiscount.percentOff > 0) {
      const label = ridehailDiscount.isVerified
        ? `${ridehailDiscount.percentOff}% off with pass`
        : `Eligible for ${ridehailDiscount.percentOff}% off`;
      return {
        coverage: "discounted",
        costLabel: label,
        discountPercent: ridehailDiscount.percentOff,
        benefitApplied: entitlementSet.packageName || "Ridehail discount",
        isVerified: ridehailDiscount.isVerified,
      };
    }

    return {
      coverage: "pay",
      costLabel: "Paid ride",
      isVerified: false,
    };
  }

  // Bike coverage
  if (step.mode === "bike") {
    const bikeBenefit = entitlementSet.entitlements.find(
      (e) => e.type === "bike_unlock"
    ) as BikeUnlock | undefined;

    if (bikeBenefit) {
      const hasUnlocks = (bikeBenefit.remainingUnlocksToday ?? 0) > 0;
      const hasMinutes = (bikeBenefit.remainingMinutesToday ?? 0) > 0;

      if (hasUnlocks || hasMinutes) {
        let label = "";
        if (hasUnlocks && hasMinutes) {
          label = `Free unlock + ${bikeBenefit.remainingMinutesToday} min included`;
        } else if (hasUnlocks) {
          label = `${bikeBenefit.remainingUnlocksToday} free unlocks remaining`;
        } else {
          label = `${bikeBenefit.remainingMinutesToday} free minutes today`;
        }

        if (!bikeBenefit.isVerified) {
          label += " (verify in app)";
        }

        return {
          coverage: hasUnlocks ? "included" : "discounted",
          costLabel: label,
          benefitApplied: entitlementSet.packageName || "Bike benefit",
          isVerified: bikeBenefit.isVerified,
        };
      }
    }

    return {
      coverage: "pay",
      costLabel: "Bike rental",
      isVerified: false,
    };
  }

  // Unknown mode
  return {
    coverage: "unknown",
    costLabel: "Fare varies",
    isVerified: false,
  };
}

// ============================================
// APPLY ENTITLEMENTS TO PLAN
// ============================================

/**
 * Apply entitlements to all steps in a mobility plan
 * Updates coverage and costLabel for each step
 */
export function applyEntitlementsToPlan(
  plan: MobilityPlan,
  entitlementSet: EntitlementSet
): MobilityPlan {
  const updatedSteps: MobilityStep[] = plan.steps.map((step) => {
    const coverageResult = getCoverageForStep(
      { mode: step.mode, providerId: step.providerId },
      entitlementSet
    );

    return {
      ...step,
      coverage: coverageResult.coverage,
      costLabel: coverageResult.costLabel,
    };
  });

  // Determine overall cost label
  // Note: Walking is ALWAYS free, so exclude it from coverage calculations
  const nonWalkSteps = updatedSteps.filter((s) => s.mode !== "walk");
  
  const allCovered = nonWalkSteps.length === 0 || nonWalkSteps.every(
    (s) => s.coverage === "included"
  );
  // Only count non-walk steps as "covered" for the overall label
  const someCovered = nonWalkSteps.some((s) => s.coverage === "included");
  const someDiscounted = nonWalkSteps.some((s) => s.coverage === "discounted");

  let overallCostLabel: string;
  if (nonWalkSteps.length === 0) {
    // Only walking - free!
    overallCostLabel = "Free";
  } else if (allCovered) {
    overallCostLabel = "Covered by pass";
  } else if (someCovered && someDiscounted) {
    overallCostLabel = "Partially covered";
  } else if (someCovered) {
    overallCostLabel = "Transit covered";
  } else if (someDiscounted) {
    const discount = entitlementSet.entitlements.find(
      (e) => e.type === "ridehail_discount"
    ) as RidehailDiscount | undefined;
    overallCostLabel = discount ? `${discount.percentOff}% off ridehail` : "Discounted";
  } else {
    overallCostLabel = "Standard fares apply";
  }

  // Build entitlement summary
  const ridehailDiscount = entitlementSet.entitlements.find(
    (e) => e.type === "ridehail_discount"
  ) as RidehailDiscount | undefined;
  const bikeBenefit = entitlementSet.entitlements.find(
    (e) => e.type === "bike_unlock"
  ) as BikeUnlock | undefined;

  let bikeBenefitLabel: string | undefined;
  if (bikeBenefit) {
    if (bikeBenefit.freeUnlocksPerDay && bikeBenefit.includedMinutesPerDay) {
      bikeBenefitLabel = `${bikeBenefit.freeUnlocksPerDay} unlocks + ${bikeBenefit.includedMinutesPerDay} min/day`;
    } else if (bikeBenefit.freeUnlocksPerDay) {
      bikeBenefitLabel = `${bikeBenefit.freeUnlocksPerDay} free unlocks/day`;
    } else if (bikeBenefit.includedMinutesPerDay) {
      bikeBenefitLabel = `${bikeBenefit.includedMinutesPerDay} free min/day`;
    }
  }

  // Build debug info
  const debug = {
    ...plan.debug,
    entitlementsApplied: entitlementSet.entitlements.map(
      (e) => `${e.type}:${e.providerId}`
    ),
    coverageSummary: Object.fromEntries(
      updatedSteps.map((s, i) => [`step_${i}`, s.coverage])
    ) as Record<string, Coverage>,
  };

  return {
    ...plan,
    steps: updatedSteps,
    labels: {
      ...plan.labels,
      costLabel: overallCostLabel,
    },
    entitlementSummary: entitlementSet.isActive
      ? {
          hasActivePass: true,
          passName: entitlementSet.packageName,
          transitCovered: entitlementSet.hasTransitPass,
          ridehailDiscount: ridehailDiscount?.percentOff,
          bikeBenefit: bikeBenefitLabel,
        }
      : undefined,
    debug,
  };
}

// ============================================
// GENERATE PASS INSIGHT
// ============================================

/**
 * Generate a single insight line about the pass for the depth layer
 * Keep it short and relevant to the current trip
 */
export function generatePassInsight(
  plan: MobilityPlan,
  entitlementSet: EntitlementSet
): string | null {
  if (!entitlementSet.isActive) {
    return null;
  }

  const hasTransitStep = plan.steps.some((s) => s.mode === "transit");
  const hasRidehailStep = plan.steps.some((s) => s.mode === "ridehail");
  const hasBikeStep = plan.steps.some((s) => s.mode === "bike");

  if (hasTransitStep && entitlementSet.hasTransitPass) {
    return "Your pass covers transit on this route.";
  }

  if (hasRidehailStep && entitlementSet.hasRidehailDiscount) {
    const discount = entitlementSet.entitlements.find(
      (e) => e.type === "ridehail_discount"
    ) as RidehailDiscount | undefined;
    if (discount) {
      return `Your pass gives ${discount.percentOff}% off this ride.`;
    }
  }

  if (hasBikeStep && entitlementSet.hasBikeBenefit) {
    return "Your pass includes bike benefits for this route.";
  }

  return null;
}
