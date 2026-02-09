/**
 * RIDE BROKER TESTS
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RideBroker, createRideBroker } from "../broker";
import type { QuoteRequest } from "../types";

describe("RideBroker", () => {
  let broker: RideBroker;

  beforeEach(() => {
    broker = createRideBroker();
  });

  describe("providers", () => {
    it("has demo provider registered by default", () => {
      const providers = broker.getProviders();

      expect(providers.length).toBeGreaterThan(0);
      const demo = providers.find((p) => p.id === "demo_provider");
      expect(demo).toBeTruthy();
      expect(demo?.isDemo).toBe(true);
      expect(demo?.available).toBe(true);
    });

    it("prevents duplicate provider registration", () => {
      // Demo provider is already registered
      expect(() => broker.registerProvider({
        providerId: "demo_provider",
        providerName: "Duplicate",
        isDemo: true,
        isAvailable: () => true,
        getQuotes: async () => [],
        requestRide: async () => ({} as any),
        getStatus: async () => ({} as any),
        cancelRide: async () => ({} as any),
      })).toThrow("already registered");
    });
  });

  describe("getQuotes", () => {
    const request: QuoteRequest = {
      pickupLat: 40.7128,
      pickupLng: -74.006,
      pickupAddress: "Times Square",
      dropoffLat: 40.7484,
      dropoffLng: -73.9857,
      dropoffAddress: "Empire State Building",
    };

    it("aggregates quotes from all providers", async () => {
      const result = await broker.getQuotes(request);

      expect(result.quotes.length).toBeGreaterThan(0);
      expect(result.providers).toContain("demo_provider");
      expect(result.errors).toHaveLength(0);
    });

    it("identifies cheapest and fastest options", async () => {
      const result = await broker.getQuotes(request);

      expect(result.cheapest).toBeTruthy();
      expect(result.fastest).toBeTruthy();
    });

    it("includes fetchedAt timestamp", async () => {
      const result = await broker.getQuotes(request);

      expect(result.fetchedAt).toBeTruthy();
      const fetchedAt = new Date(result.fetchedAt);
      expect(fetchedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("requestRide", () => {
    let quoteId: string;

    beforeEach(async () => {
      const quotes = await broker.getQuotes({
        pickupLat: 40.7128,
        pickupLng: -74.006,
        pickupAddress: "Times Square",
        dropoffLat: 40.7484,
        dropoffLng: -73.9857,
        dropoffAddress: "Empire State Building",
      });
      quoteId = quotes.quotes[0].id;
    });

    it("requests ride from correct provider", async () => {
      const booking = await broker.requestRide({
        quoteId,
        passengerName: "Test User",
      });

      expect(booking.id).toBeTruthy();
      expect(booking.status).toBe("requested");
      expect(booking.providerId).toBe("demo_provider");
    });

    it("rejects unknown quote ID", async () => {
      await expect(
        broker.requestRide({
          quoteId: "unknown-quote",
          passengerName: "Test",
        })
      ).rejects.toThrow("Quote not found");
    });
  });

  describe("getBookingStatus", () => {
    let bookingId: string;

    beforeEach(async () => {
      const quotes = await broker.getQuotes({
        pickupLat: 40.7128,
        pickupLng: -74.006,
        pickupAddress: "Times Square",
        dropoffLat: 40.7484,
        dropoffLng: -73.9857,
        dropoffAddress: "Empire State Building",
      });

      const booking = await broker.requestRide({
        quoteId: quotes.quotes[0].id,
        passengerName: "Test",
      });
      bookingId = booking.id;
    });

    it("retrieves booking status", async () => {
      const status = await broker.getBookingStatus(bookingId);

      expect(status.id).toBe(bookingId);
      expect(status.status).toBeTruthy();
    });

    it("throws for unknown booking", async () => {
      await expect(broker.getBookingStatus("unknown")).rejects.toThrow("Booking not found");
    });
  });

  describe("cancelBooking", () => {
    let bookingId: string;

    beforeEach(async () => {
      const quotes = await broker.getQuotes({
        pickupLat: 40.7128,
        pickupLng: -74.006,
        pickupAddress: "Times Square",
        dropoffLat: 40.7484,
        dropoffLng: -73.9857,
        dropoffAddress: "Empire State Building",
      });

      const booking = await broker.requestRide({
        quoteId: quotes.quotes[0].id,
        passengerName: "Test",
      });
      bookingId = booking.id;
    });

    it("cancels a booking", async () => {
      const cancelled = await broker.cancelBooking(bookingId);

      expect(cancelled.status).toBe("cancelled");
    });

    it("throws for unknown booking", async () => {
      await expect(broker.cancelBooking("unknown")).rejects.toThrow("Booking not found");
    });
  });
});
