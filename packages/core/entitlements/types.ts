/**
 * ENTITLEMENTS ENGINE — Types
 *
 * Types for the membership/entitlements system.
 * These define what benefits a user has access to.
 */

import { z } from "zod";
import type { CityCode, Mode } from "../mobility/types";

// ============================================
// BENEFIT TYPES
// ============================================

export const BenefitTypeSchema = z.enum([
  "free_pass",        // Full coverage (e.g., unlimited transit)
  "discount_percent", // Percentage discount
  "free_minutes",     // Free usage minutes (for bikes)
  "free_unlocks",     // Free unlock count (for bikes)
]);

export type BenefitType = z.infer<typeof BenefitTypeSchema>;

// ============================================
// PROVIDER TYPE
// ============================================

export const ProviderTypeSchema = z.enum(["transit", "ridehail", "bike"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// ============================================
// TRANSIT PASS ENTITLEMENT
// ============================================

export const TransitPassSchema = z.object({
  type: z.literal("transit_pass"),
  providerId: z.string(),
  providerName: z.string(),
  zones: z.array(z.string()).optional(), // e.g., ["A", "B"] for Berlin
  unlimited: z.boolean(),
  validUntil: z.string(), // ISO timestamp
  isVerified: z.boolean(), // Whether we've confirmed activation
});

export type TransitPass = z.infer<typeof TransitPassSchema>;

// ============================================
// RIDEHAIL DISCOUNT ENTITLEMENT
// ============================================

export const RidehailDiscountSchema = z.object({
  type: z.literal("ridehail_discount"),
  providerId: z.string(),
  providerName: z.string(),
  percentOff: z.number().min(0).max(100),
  dailyCapCents: z.number().optional(), // Max daily discount
  validUntil: z.string(),
  isVerified: z.boolean(),
});

export type RidehailDiscount = z.infer<typeof RidehailDiscountSchema>;

// ============================================
// BIKE UNLOCK ENTITLEMENT
// ============================================

export const BikeUnlockSchema = z.object({
  type: z.literal("bike_unlock"),
  providerId: z.string(),
  providerName: z.string(),
  freeUnlocksPerDay: z.number().optional(),
  includedMinutesPerDay: z.number().optional(),
  remainingUnlocksToday: z.number().optional(),
  remainingMinutesToday: z.number().optional(),
  validUntil: z.string(),
  isVerified: z.boolean(),
});

export type BikeUnlock = z.infer<typeof BikeUnlockSchema>;

// ============================================
// ENTITLEMENT UNION
// ============================================

export const EntitlementSchema = z.discriminatedUnion("type", [
  TransitPassSchema,
  RidehailDiscountSchema,
  BikeUnlockSchema,
]);

export type Entitlement = z.infer<typeof EntitlementSchema>;

// ============================================
// ENTITLEMENT SET
// ============================================

/**
 * EntitlementSet is the complete set of active entitlements for a user in a city
 */
export const EntitlementSetSchema = z.object({
  userId: z.string(),
  cityCode: z.string(),
  packageId: z.string().optional(),
  packageName: z.string().optional(),
  validFrom: z.string(),
  validUntil: z.string(),
  isActive: z.boolean(),
  entitlements: z.array(EntitlementSchema),
  // Convenience flags
  hasTransitPass: z.boolean(),
  hasRidehailDiscount: z.boolean(),
  hasBikeBenefit: z.boolean(),
  // Verification status
  allVerified: z.boolean(),
  verificationStatus: z.record(z.string(), z.boolean()), // providerId -> verified
});

export type EntitlementSet = z.infer<typeof EntitlementSetSchema>;

// ============================================
// EMPTY ENTITLEMENT SET
// ============================================

export function createEmptyEntitlementSet(userId: string, cityCode: string): EntitlementSet {
  return {
    userId,
    cityCode,
    packageId: undefined,
    packageName: undefined,
    validFrom: new Date().toISOString(),
    validUntil: new Date().toISOString(),
    isActive: false,
    entitlements: [],
    hasTransitPass: false,
    hasRidehailDiscount: false,
    hasBikeBenefit: false,
    allVerified: false,
    verificationStatus: {},
  };
}

// ============================================
// ACTIVATION STATUS
// ============================================

export const ActivationStatusSchema = z.enum([
  "active",           // Fully activated and verified
  "pending",          // Purchased but not activated
  "requires_action",  // User needs to take action (e.g., open app)
  "expired",          // Past validity date
  "unknown",          // Status could not be determined
]);

export type ActivationStatus = z.infer<typeof ActivationStatusSchema>;

export interface ProviderActivationStatus {
  providerId: string;
  providerName: string;
  providerType: ProviderType;
  status: ActivationStatus;
  actionRequired?: string; // e.g., "Open Uber app to connect account"
  actionUrl?: string;      // Deep link to provider app
}

// ============================================
// COVERAGE RESULT
// ============================================

export interface CoverageResult {
  coverage: "included" | "discounted" | "pay" | "unknown";
  costLabel: string;
  discountPercent?: number;
  benefitApplied?: string; // e.g., "7-day transit pass"
  isVerified: boolean;
}
