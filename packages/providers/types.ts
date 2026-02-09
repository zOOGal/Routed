/**
 * PROVIDER ADAPTER TYPES
 *
 * Interface for mobility providers (transit, ridehail, bike).
 * Adapters are stubs but architected for real integration.
 */

import { z } from "zod";
import type { CityCode, Mode, Execution } from "../core/mobility/types";
import type { Entitlement, CoverageResult, ProviderType } from "../core/entitlements/types";

// ============================================
// PROVIDER CAPABILITIES
// ============================================

export interface ProviderCapabilities {
  supportsActivationApi: boolean;  // Can we activate membership via API?
  supportsStatusCheck: boolean;    // Can we check membership status?
  supportsPurchaseLink: boolean;   // Can we link to provider for purchase?
  supportsRealTimePricing: boolean; // Can we get live prices?
  supportsDeepLink: boolean;       // Can we deep link into provider app?
}

// ============================================
// DEEP LINK REQUEST
// ============================================

export interface DeepLinkRequest {
  origin: { name: string; lat?: number; lng?: number };
  destination: { name: string; lat?: number; lng?: number };
  step?: {
    mode: Mode;
    line?: string;
    departureStop?: string;
    arrivalStop?: string;
  };
}

export interface DeepLinkResult {
  url: string;
  label: string;
  execution: Execution;
}

// ============================================
// FARE ESTIMATE REQUEST
// ============================================

export interface FareEstimateRequest {
  durationMin: number;
  distanceM: number;
  entitlements: Entitlement[];
}

export interface FareEstimateResult extends CoverageResult {
  // Inherited: coverage, costLabel, discountPercent, benefitApplied, isVerified
}

// ============================================
// ACTIVATION REQUEST
// ============================================

export interface ActivationRequest {
  userId: string;
  entitlementId: string;
  authToken?: string; // Provider-specific auth
}

export interface ActivationResult {
  success: boolean;
  status: "active" | "pending" | "requires_action" | "failed";
  actionRequired?: string; // e.g., "Open Uber app to confirm"
  actionUrl?: string;
  entitlementJson?: Record<string, unknown>;
  error?: string;
}

// ============================================
// STATUS CHECK REQUEST
// ============================================

export interface StatusCheckRequest {
  userId: string;
  entitlementId: string;
}

export interface StatusCheckResult {
  status: "active" | "inactive" | "expired" | "unknown";
  validUntil?: string;
  details?: Record<string, unknown>;
}

// ============================================
// PROVIDER ADAPTER INTERFACE
// ============================================

export interface ProviderAdapter {
  // Identity
  id: string;
  name: string;
  displayName: string; // User-friendly name (e.g., "NYC Subway" not "MTA")
  type: ProviderType;
  cityCode: CityCode;
  logoEmoji: string;

  // Capabilities
  capabilities: ProviderCapabilities;

  // Deep linking
  getDeepLink(request: DeepLinkRequest): DeepLinkResult;

  // Fare estimation (no fake precision)
  estimateFare(request: FareEstimateRequest): FareEstimateResult;

  // Activation (stub for now)
  activateMembership(request: ActivationRequest): Promise<ActivationResult>;

  // Status check (stub for now)
  checkMembershipStatus(request: StatusCheckRequest): Promise<StatusCheckResult>;

  // System map link (for transit)
  getSystemMapLink?(): { url: string; label: string };
}

// ============================================
// BASE ADAPTER CLASS
// ============================================

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract id: string;
  abstract name: string;
  abstract displayName: string;
  abstract type: ProviderType;
  abstract cityCode: CityCode;
  abstract logoEmoji: string;

  capabilities: ProviderCapabilities = {
    supportsActivationApi: false,
    supportsStatusCheck: false,
    supportsPurchaseLink: true,
    supportsRealTimePricing: false,
    supportsDeepLink: true,
  };

  abstract getDeepLink(request: DeepLinkRequest): DeepLinkResult;

  estimateFare(request: FareEstimateRequest): FareEstimateResult {
    // Check for relevant entitlement
    const relevantEntitlement = request.entitlements.find((e) => {
      if (this.type === "transit" && e.type === "transit_pass") return true;
      if (this.type === "ridehail" && e.type === "ridehail_discount") return true;
      if (this.type === "bike" && e.type === "bike_unlock") return true;
      return false;
    });

    if (!relevantEntitlement) {
      return this.getDefaultFareEstimate(request);
    }

    return this.applyEntitlementToFare(request, relevantEntitlement);
  }

  protected abstract getDefaultFareEstimate(request: FareEstimateRequest): FareEstimateResult;
  protected abstract applyEntitlementToFare(
    request: FareEstimateRequest,
    entitlement: Entitlement
  ): FareEstimateResult;

  async activateMembership(request: ActivationRequest): Promise<ActivationResult> {
    // Default stub implementation
    return {
      success: true,
      status: "pending",
      actionRequired: `Open ${this.displayName} app to complete activation`,
      actionUrl: this.getDeepLink({
        origin: { name: "current location" },
        destination: { name: "" },
      }).url,
    };
  }

  async checkMembershipStatus(request: StatusCheckRequest): Promise<StatusCheckResult> {
    // Default stub implementation
    return {
      status: "unknown",
    };
  }

  getSystemMapLink?(): { url: string; label: string };
}
