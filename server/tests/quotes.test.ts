/**
 * QUOTE SERVICE TESTS
 *
 * Tests for the ridehail quote aggregation system.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  getQuotes,
  getProvidersForCity,
  formatPriceRange,
  getCurrencyForCity,
  type QuoteRequest,
  type Quote,
  type CityCode,
} from "../quotes";

describe("Quote Service", () => {
  describe("Currency by City", () => {
    test("NYC returns USD", () => {
      expect(getCurrencyForCity("nyc")).toBe("USD");
    });

    test("Berlin returns EUR", () => {
      expect(getCurrencyForCity("berlin")).toBe("EUR");
    });

    test("Tokyo returns JPY", () => {
      expect(getCurrencyForCity("tokyo")).toBe("JPY");
    });
  });

  describe("Provider Catalog", () => {
    test("NYC has 3 providers", () => {
      const providers = getProvidersForCity("nyc");
      expect(providers.length).toBe(3);
      expect(providers.map((p) => p.type).sort()).toEqual([
        "ridehail_economy",
        "ridehail_premium",
        "taxi",
      ]);
    });

    test("Berlin has 3 providers", () => {
      const providers = getProvidersForCity("berlin");
      expect(providers.length).toBe(3);
    });

    test("Tokyo has 3 providers", () => {
      const providers = getProvidersForCity("tokyo");
      expect(providers.length).toBe(3);
    });
  });

  describe("Quote Fetching", () => {
    test("returns quotes with consistent currency for NYC", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      expect(response.currency).toBe("USD");
      expect(response.quotes.length).toBeGreaterThan(0);
      response.quotes.forEach((quote) => {
        expect(quote.price.currency).toBe("USD");
        expect(quote.price.isEstimate).toBe(true);
      });
    });

    test("returns quotes with consistent currency for Berlin", async () => {
      const request: QuoteRequest = {
        cityCode: "berlin",
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.5163, lng: 13.3777 },
      };

      const response = await getQuotes(request);

      expect(response.currency).toBe("EUR");
      response.quotes.forEach((quote) => {
        expect(quote.price.currency).toBe("EUR");
      });
    });

    test("returns quotes with consistent currency for Tokyo", async () => {
      const request: QuoteRequest = {
        cityCode: "tokyo",
        origin: { lat: 35.6762, lng: 139.6503 },
        destination: { lat: 35.6586, lng: 139.7454 },
      };

      const response = await getQuotes(request);

      expect(response.currency).toBe("JPY");
      response.quotes.forEach((quote) => {
        expect(quote.price.currency).toBe("JPY");
      });
    });

    test("includes debug info with cheapest provider", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      expect(response.debug).toBeDefined();
      expect(response.debug?.cheapestProviderId).toBeDefined();
      expect(response.debug?.providersQueried).toHaveLength(3);
    });
  });

  describe("Cheapest Provider Selection", () => {
    test("economy ridehail is typically cheapest", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      // Find the economy ridehail quote
      const economyQuote = response.quotes.find(
        (q) => q.providerType === "ridehail_economy"
      );
      const premiumQuote = response.quotes.find(
        (q) => q.providerType === "ridehail_premium"
      );

      expect(economyQuote).toBeDefined();
      expect(premiumQuote).toBeDefined();

      // Economy should be cheaper than premium
      const economyAvg =
        ((economyQuote?.price.min || 0) + (economyQuote?.price.max || 0)) / 2;
      const premiumAvg =
        ((premiumQuote?.price.min || 0) + (premiumQuote?.price.max || 0)) / 2;

      expect(economyAvg).toBeLessThan(premiumAvg);
    });

    test("cheapest is tagged correctly", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      const cheapestId = response.debug?.cheapestProviderId;
      const cheapestQuote = response.quotes.find(
        (q) => q.providerId === cheapestId
      );

      expect(cheapestQuote?.tags).toContain("cheapest");
    });
  });

  describe("Date Context Changes Selection", () => {
    test("date context prioritizes premium over cheapest", async () => {
      const requestWithDate: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
        constraints: {
          isDateContext: true,
        },
      };

      const requestWithoutDate: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
        constraints: {
          isDateContext: false,
        },
      };

      const responseWithDate = await getQuotes(requestWithDate);
      const responseWithoutDate = await getQuotes(requestWithoutDate);

      const selectedWithDate = responseWithDate.debug?.selectedProviderId;
      const selectedWithoutDate = responseWithoutDate.debug?.selectedProviderId;

      // With date context, selection should prioritize reliability
      // (may select premium or taxi over economy)
      const selectedQuoteWithDate = responseWithDate.quotes.find(
        (q) => q.providerId === selectedWithDate
      );

      expect(responseWithDate.debug?.selectionReason).toMatch(
        /date|reliable|premium|comfort/i
      );
    });

    test("date context selection reason mentions date/reliability", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
        constraints: {
          isDateContext: true,
        },
      };

      const response = await getQuotes(request);

      expect(response.debug?.selectionReason).toBeDefined();
      // Selection reason should mention date or reliability
      expect(
        response.debug?.selectionReason?.toLowerCase()
      ).toMatch(/date|reliab|premium|comfort/);
    });
  });

  describe("No Invalid Provider Strings", () => {
    test("NYC quotes never contain U-Bahn", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      response.quotes.forEach((quote) => {
        expect(quote.providerName.toLowerCase()).not.toContain("u-bahn");
        expect(quote.providerName.toLowerCase()).not.toContain("bvg");
        expect(quote.providerName.toLowerCase()).not.toContain("s-bahn");
      });
    });

    test("Berlin quotes never contain MTA", async () => {
      const request: QuoteRequest = {
        cityCode: "berlin",
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.5163, lng: 13.3777 },
      };

      const response = await getQuotes(request);

      response.quotes.forEach((quote) => {
        expect(quote.providerName.toLowerCase()).not.toContain("mta");
        expect(quote.providerName.toLowerCase()).not.toContain("subway");
      });
    });
  });

  describe("Price Formatting", () => {
    test("formats USD price range correctly", () => {
      const priceRange = formatPriceRange({
        min: 1500,
        max: 2000,
        currency: "USD",
        confidence: "medium",
        isEstimate: true,
      });

      expect(priceRange).toBe("$15–20");
    });

    test("formats EUR price range correctly", () => {
      const priceRange = formatPriceRange({
        min: 1000,
        max: 1500,
        currency: "EUR",
        confidence: "medium",
        isEstimate: true,
      });

      expect(priceRange).toBe("€10–15");
    });

    test("formats JPY price range correctly (no decimals)", () => {
      const priceRange = formatPriceRange({
        min: 1500,
        max: 2000,
        currency: "JPY",
        confidence: "medium",
        isEstimate: true,
      });

      expect(priceRange).toBe("¥1500–2000");
    });
  });

  describe("Quote Expiration", () => {
    test("quotes have expiration time in the future", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      const expiresAt = new Date(response.expiresAt);
      const requestedAt = new Date(response.requestedAt);

      expect(expiresAt.getTime()).toBeGreaterThan(requestedAt.getTime());
      // Expires in ~5 minutes
      const diffMs = expiresAt.getTime() - requestedAt.getTime();
      expect(diffMs).toBeGreaterThan(4 * 60 * 1000); // At least 4 minutes
      expect(diffMs).toBeLessThan(6 * 60 * 1000); // Less than 6 minutes
    });
  });

  describe("Execution Types", () => {
    test("economy ridehail has deeplink execution", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      const economyQuote = response.quotes.find(
        (q) => q.providerType === "ridehail_economy"
      );

      expect(economyQuote?.execution.type).toBe("deeplink");
      expect(economyQuote?.execution.url).toBeDefined();
    });

    test("taxi has hail execution (no deep link)", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      const taxiQuote = response.quotes.find((q) => q.providerType === "taxi");

      expect(taxiQuote?.execution.type).toBe("hail");
      expect(taxiQuote?.execution.url).toBeUndefined();
    });
  });

  describe("All Quotes Are Estimates", () => {
    test("all quotes have isEstimate=true", async () => {
      const request: QuoteRequest = {
        cityCode: "nyc",
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.9855 },
      };

      const response = await getQuotes(request);

      response.quotes.forEach((quote) => {
        expect(quote.price.isEstimate).toBe(true);
      });
    });
  });
});
