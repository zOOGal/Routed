/**
 * CITY PRICING CONFIGURATION
 *
 * Static meter rules and surge factors for PoC.
 * These are approximate based on public information.
 *
 * DO NOT claim these are real-time prices!
 */

import type { CityCode, Currency } from "./types";
import { CITY_CURRENCY } from "./types";

// ============================================
// TAXI METER RULES
// ============================================

export interface TaxiMeterRules {
  baseFare: number;         // In cents (or yen for Tokyo)
  perKmRate: number;        // Per km in cents
  perMinRate: number;       // Per minute waiting/slow traffic
  minimumFare: number;      // Minimum fare
  airportSurcharge?: number;
  nightSurcharge?: number;  // % increase at night
  nightStartHour: number;   // When night pricing starts
  nightEndHour: number;     // When night pricing ends
}

export const TAXI_METER_RULES: Record<CityCode, TaxiMeterRules> = {
  nyc: {
    baseFare: 300,          // $3.00
    perKmRate: 175,         // $1.75 per km (≈$2.80/mile)
    perMinRate: 50,         // $0.50 per minute
    minimumFare: 300,
    airportSurcharge: 1750, // $17.50 JFK surcharge
    nightSurcharge: 50,     // 50% surcharge at night
    nightStartHour: 20,
    nightEndHour: 6,
  },
  berlin: {
    baseFare: 390,          // €3.90
    perKmRate: 230,         // €2.30 per km
    perMinRate: 60,         // €0.60 per minute
    minimumFare: 390,
    nightSurcharge: 0,      // No night surcharge in Berlin
    nightStartHour: 22,
    nightEndHour: 6,
  },
  tokyo: {
    baseFare: 50000,        // ¥500 (in yen, not cents)
    perKmRate: 30000,       // ¥300 per km
    perMinRate: 10000,      // ¥100 per minute
    minimumFare: 50000,
    nightSurcharge: 20,     // 20% surcharge at night
    nightStartHour: 22,
    nightEndHour: 5,
  },
};

// ============================================
// RIDEHAIL PRICING MODELS
// ============================================

export interface RidehailPricingModel {
  name: string;
  baseFare: number;
  perKmRate: number;
  perMinRate: number;
  minimumFare: number;
  bookingFee: number;
  // Surge simulation
  defaultSurgeMultiplier: number;
  rushHourSurgeMultiplier: number;
  rushHourStart: number;
  rushHourEnd: number;
  eveningRushStart: number;
  eveningRushEnd: number;
}

// Provider A: Economy ridehail (think UberX-like)
export const RIDEHAIL_A_PRICING: Record<CityCode, RidehailPricingModel> = {
  nyc: {
    name: "Economy Ride",
    baseFare: 250,          // $2.50
    perKmRate: 125,         // $1.25 per km
    perMinRate: 35,         // $0.35 per minute
    minimumFare: 750,       // $7.50 minimum
    bookingFee: 275,        // $2.75 booking fee
    defaultSurgeMultiplier: 1.0,
    rushHourSurgeMultiplier: 1.4,
    rushHourStart: 7,
    rushHourEnd: 9,
    eveningRushStart: 17,
    eveningRushEnd: 19,
  },
  berlin: {
    name: "Economy Ride",
    baseFare: 200,          // €2.00
    perKmRate: 100,         // €1.00 per km
    perMinRate: 25,         // €0.25 per minute
    minimumFare: 500,       // €5.00 minimum
    bookingFee: 150,        // €1.50 booking fee
    defaultSurgeMultiplier: 1.0,
    rushHourSurgeMultiplier: 1.3,
    rushHourStart: 7,
    rushHourEnd: 9,
    eveningRushStart: 17,
    eveningRushEnd: 19,
  },
  tokyo: {
    name: "Economy Ride",
    baseFare: 40000,        // ¥400
    perKmRate: 20000,       // ¥200 per km
    perMinRate: 7500,       // ¥75 per minute
    minimumFare: 60000,     // ¥600 minimum
    bookingFee: 30000,      // ¥300 booking fee
    defaultSurgeMultiplier: 1.0,
    rushHourSurgeMultiplier: 1.5,
    rushHourStart: 7,
    rushHourEnd: 9,
    eveningRushStart: 17,
    eveningRushEnd: 20,
  },
};

// Provider B: Premium ridehail (think Uber Black/Comfort-like)
export const RIDEHAIL_B_PRICING: Record<CityCode, RidehailPricingModel> = {
  nyc: {
    name: "Comfort Ride",
    baseFare: 500,          // $5.00
    perKmRate: 200,         // $2.00 per km
    perMinRate: 50,         // $0.50 per minute
    minimumFare: 1500,      // $15.00 minimum
    bookingFee: 300,        // $3.00 booking fee
    defaultSurgeMultiplier: 1.0,
    rushHourSurgeMultiplier: 1.2, // Less surge for premium
    rushHourStart: 7,
    rushHourEnd: 9,
    eveningRushStart: 17,
    eveningRushEnd: 19,
  },
  berlin: {
    name: "Comfort Ride",
    baseFare: 400,          // €4.00
    perKmRate: 180,         // €1.80 per km
    perMinRate: 40,         // €0.40 per minute
    minimumFare: 1000,      // €10.00 minimum
    bookingFee: 200,        // €2.00 booking fee
    defaultSurgeMultiplier: 1.0,
    rushHourSurgeMultiplier: 1.15,
    rushHourStart: 7,
    rushHourEnd: 9,
    eveningRushStart: 17,
    eveningRushEnd: 19,
  },
  tokyo: {
    name: "Comfort Ride",
    baseFare: 80000,        // ¥800
    perKmRate: 35000,       // ¥350 per km
    perMinRate: 12000,      // ¥120 per minute
    minimumFare: 100000,    // ¥1000 minimum
    bookingFee: 50000,      // ¥500 booking fee
    defaultSurgeMultiplier: 1.0,
    rushHourSurgeMultiplier: 1.2,
    rushHourStart: 7,
    rushHourEnd: 9,
    eveningRushStart: 17,
    eveningRushEnd: 20,
  },
};

// ============================================
// ETA SIMULATION
// ============================================

export interface EtaConfig {
  basePickupEtaMin: number;
  rushHourPickupEtaMin: number;
  nightPickupEtaMin: number;
  // Average speed for trip estimation
  avgSpeedKmh: number;
  rushHourAvgSpeedKmh: number;
}

export const ETA_CONFIG: Record<CityCode, EtaConfig> = {
  nyc: {
    basePickupEtaMin: 4,
    rushHourPickupEtaMin: 8,
    nightPickupEtaMin: 6,
    avgSpeedKmh: 25,
    rushHourAvgSpeedKmh: 12,
  },
  berlin: {
    basePickupEtaMin: 5,
    rushHourPickupEtaMin: 7,
    nightPickupEtaMin: 8,
    avgSpeedKmh: 30,
    rushHourAvgSpeedKmh: 18,
  },
  tokyo: {
    basePickupEtaMin: 3,
    rushHourPickupEtaMin: 6,
    nightPickupEtaMin: 5,
    avgSpeedKmh: 20,
    rushHourAvgSpeedKmh: 10,
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

export function isRushHour(hour: number, config: RidehailPricingModel): boolean {
  return (
    (hour >= config.rushHourStart && hour < config.rushHourEnd) ||
    (hour >= config.eveningRushStart && hour < config.eveningRushEnd)
  );
}

export function isNightTime(hour: number, rules: TaxiMeterRules): boolean {
  if (rules.nightStartHour > rules.nightEndHour) {
    // Night spans midnight (e.g., 22:00 - 06:00)
    return hour >= rules.nightStartHour || hour < rules.nightEndHour;
  }
  return hour >= rules.nightStartHour && hour < rules.nightEndHour;
}

export function calculateDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): number {
  // Haversine formula for distance in km
  const R = 6371; // Earth's radius in km
  const dLat = toRad(destination.lat - origin.lat);
  const dLng = toRad(destination.lng - origin.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(origin.lat)) *
      Math.cos(toRad(destination.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

export function estimateTripDuration(
  distanceKm: number,
  cityCode: CityCode,
  isRushHourNow: boolean
): number {
  const config = ETA_CONFIG[cityCode];
  const speed = isRushHourNow ? config.rushHourAvgSpeedKmh : config.avgSpeedKmh;
  return Math.ceil((distanceKm / speed) * 60); // Minutes
}

export function getPickupEta(
  cityCode: CityCode,
  isRushHourNow: boolean,
  isNightNow: boolean
): number {
  const config = ETA_CONFIG[cityCode];
  if (isRushHourNow) return config.rushHourPickupEtaMin;
  if (isNightNow) return config.nightPickupEtaMin;
  return config.basePickupEtaMin;
}
