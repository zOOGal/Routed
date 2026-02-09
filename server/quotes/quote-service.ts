/**
 * QUOTE SERVICE
 *
 * Aggregates quotes from multiple ridehail/taxi providers.
 * Ranks and selects best option based on constraints.
 *
 * PoC RULES:
 * - All prices are estimates
 * - No real API calls
 * - Generic provider names only
 */

import type {
  Quote,
  QuoteRequest,
  QuoteResponse,
  QuoteProviderAdapter,
  CityCode,
} from "./types";
import { getCurrencyForCity } from "./types";
import { createTaxiProviders } from "./providers/local-taxi-meter";
import { createRidehailAProviders } from "./providers/ridehail-a";
import { createRidehailBProviders } from "./providers/ridehail-b";

// ============================================
// PROVIDER REGISTRY
// ============================================

const allProviders: QuoteProviderAdapter[] = [
  ...createTaxiProviders(),
  ...createRidehailAProviders(),
  ...createRidehailBProviders(),
];

function getProvidersForCity(cityCode: CityCode): QuoteProviderAdapter[] {
  return allProviders.filter((p) => p.cityCode === cityCode);
}

// ============================================
// QUOTE AGGREGATION
// ============================================

export async function getQuotes(request: QuoteRequest): Promise<QuoteResponse> {
  const providers = getProvidersForCity(request.cityCode);
  const currency = getCurrencyForCity(request.cityCode);
  const requestedAt = new Date().toISOString();
  // Quotes expire in 5 minutes
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Fetch quotes from all providers in parallel
  const quotePromises = providers.map((p) => p.getQuote(request));
  const quoteResults = await Promise.all(quotePromises);

  // Filter out null quotes
  const quotes = quoteResults.filter((q): q is Quote => q !== null);

  // Validate currency consistency
  for (const quote of quotes) {
    if (quote.price.currency !== currency) {
      console.warn(
        `[QuoteService] Currency mismatch: provider ${quote.providerId} ` +
        `returned ${quote.price.currency}, expected ${currency}`
      );
      // Override to correct currency (this is a bug in provider implementation)
      quote.price.currency = currency;
    }
  }

  // Find cheapest provider
  const cheapest = findCheapest(quotes);

  // Select best quote based on constraints
  const { selected, reason } = selectBestQuote(quotes, request);

  // Tag the cheapest quote
  if (cheapest) {
    if (!cheapest.tags.includes("cheapest")) {
      cheapest.tags.push("cheapest");
    }
  }

  return {
    quotes,
    currency,
    requestedAt,
    expiresAt,
    debug: {
      cheapestProviderId: cheapest?.providerId,
      selectedProviderId: selected?.providerId,
      selectionReason: reason,
      providersQueried: providers.map((p) => p.id),
    },
  };
}

// ============================================
// QUOTE SELECTION
// ============================================

function findCheapest(quotes: Quote[]): Quote | null {
  if (quotes.length === 0) return null;

  return quotes.reduce((cheapest, quote) => {
    const avgPrice = (quote.price.min + quote.price.max) / 2;
    const cheapestAvg = (cheapest.price.min + cheapest.price.max) / 2;
    return avgPrice < cheapestAvg ? quote : cheapest;
  });
}

interface SelectionResult {
  selected: Quote | null;
  reason: string;
}

function selectBestQuote(quotes: Quote[], request: QuoteRequest): SelectionResult {
  if (quotes.length === 0) {
    return { selected: null, reason: "No quotes available" };
  }

  if (quotes.length === 1) {
    return { selected: quotes[0], reason: "Only option available" };
  }

  const constraints = request.constraints || {};

  // Score each quote
  const scoredQuotes = quotes.map((quote) => ({
    quote,
    score: calculateQuoteScore(quote, constraints),
  }));

  // Sort by score (higher is better)
  scoredQuotes.sort((a, b) => b.score - a.score);

  const best = scoredQuotes[0];
  const reason = generateSelectionReason(best.quote, constraints, quotes);

  return { selected: best.quote, reason };
}

function calculateQuoteScore(
  quote: Quote,
  constraints: QuoteRequest["constraints"]
): number {
  let score = 100; // Base score

  const avgPrice = (quote.price.min + quote.price.max) / 2;

  // === PRICE SCORING ===
  // Lower price is better (normalize to ~0-30 range)
  const priceScore = Math.max(0, 30 - avgPrice / 100);
  score += priceScore;

  // Max price constraint
  if (constraints?.maxPriceCents && avgPrice > constraints.maxPriceCents) {
    score -= 50; // Heavy penalty for exceeding budget
  }

  // === PICKUP ETA SCORING ===
  // Faster pickup is better (0-20 points)
  const pickupScore = Math.max(0, 20 - quote.pickupEtaMin * 2);
  score += pickupScore;

  // Max pickup ETA constraint
  if (constraints?.maxPickupEtaMin && quote.pickupEtaMin > constraints.maxPickupEtaMin) {
    score -= 30; // Penalty for slow pickup
  }

  // === DATE CONTEXT ===
  // If user mentioned "date", prioritize reliability and comfort over price
  if (constraints?.isDateContext) {
    // Boost premium/reliable options
    if (quote.tags.includes("most_reliable")) {
      score += 25;
    }
    if (quote.tags.includes("premium")) {
      score += 20;
    }
    // Penalize long pickup times more heavily
    if (quote.pickupEtaMin > 5) {
      score -= 15;
    }
    // Reduce price importance
    score -= priceScore * 0.5; // Cut price benefit in half
  }

  // === RELIABILITY PREFERENCE ===
  if (constraints?.preferReliability) {
    if (quote.availabilityConfidence === "high") {
      score += 15;
    } else if (quote.availabilityConfidence === "low") {
      score -= 15;
    }
    if (quote.tags.includes("most_reliable")) {
      score += 10;
    }
  }

  // === COMFORT PREFERENCE ===
  if (constraints?.preferComfort) {
    if (quote.tags.includes("premium")) {
      score += 20;
    }
  }

  // === AVAILABILITY CONFIDENCE ===
  if (quote.availabilityConfidence === "high") {
    score += 5;
  } else if (quote.availabilityConfidence === "low") {
    score -= 10;
  }

  // === PRICE CONFIDENCE ===
  if (quote.price.confidence === "high") {
    score += 5;
  } else if (quote.price.confidence === "low") {
    score -= 5;
  }

  return score;
}

function generateSelectionReason(
  selected: Quote,
  constraints: QuoteRequest["constraints"],
  allQuotes: Quote[]
): string {
  const cheapest = findCheapest(allQuotes);
  const isCheapest = cheapest?.providerId === selected.providerId;

  if (constraints?.isDateContext) {
    if (selected.tags.includes("premium")) {
      return "Selected premium option for date reliability";
    }
    if (selected.tags.includes("most_reliable")) {
      return "Selected most reliable option for date";
    }
    if (!isCheapest) {
      return "Selected for better reliability (date context)";
    }
  }

  if (constraints?.preferComfort && selected.tags.includes("premium")) {
    return "Selected for comfort preference";
  }

  if (constraints?.preferReliability && selected.tags.includes("most_reliable")) {
    return "Selected for reliability";
  }

  if (isCheapest) {
    return "Selected as cheapest option";
  }

  if (selected.pickupEtaMin <= 3) {
    return "Selected for fastest pickup";
  }

  return "Selected as best overall option";
}

// ============================================
// SINGLE PROVIDER QUOTE
// ============================================

export async function getQuoteFromProvider(
  providerId: string,
  request: QuoteRequest
): Promise<Quote | null> {
  const provider = allProviders.find((p) => p.id === providerId);
  if (!provider) {
    return null;
  }
  return provider.getQuote(request);
}

// ============================================
// EXPORTS
// ============================================

export { allProviders, getProvidersForCity };
