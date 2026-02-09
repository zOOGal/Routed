/**
 * ROUTED AGENT SERVICE
 *
 * Core decision engine for route recommendations.
 *
 * ARCHITECTURE: LLM-Powered Decision Engine with Deterministic Fallback
 *
 * DECISION FLOW:
 * 1. INPUT VALIDATION — Verify locations match city
 * 2. CONSTRAINT EXTRACTION — Parse intent/notes into constraints
 * 3. CANDIDATE GENERATION — Fetch routes from Google Maps
 * 4. LLM DECISION — Use Gemini to reason about best route (NEW!)
 * 5. FALLBACK — Use enhanced heuristics if LLM unavailable
 * 6. EXPLANATION — Generate wording based on LLM reasoning
 *
 * HONESTY RULES:
 * - Never generate fake routes
 * - Never claim intent influenced decision if only one option
 * - Never show city-specific infrastructure for wrong city
 * - Admit when data is unavailable
 */

import { getCityProfile, calculateCognitiveLoad } from "./city-intelligence";
import { storage } from "./storage";
import {
  getMultipleRoutes,
  mapToRouteSteps,
  generateGoogleMapsDeepLink,
  createSimplifiedRideshareSteps,
  searchPlacesText,
  type GoogleMapsRoute,
  type TravelMode,
  type PlacesTextResult,
} from "./google-maps-service";
import { getWeather, type WeatherData } from "./weather-service";
import { resolveVenueInfo } from "./venue-service";
import { generateDepthLayer, generateSimpleDepthLayer } from "./depth";
import {
  scoreRouteCandidate,
  selectBestRoute,
  generateExplanation,
  calculateStressScore,
  validateRoute,
  parseNoteKeywords,
  type RouteCandidate,
  type ScoringContext,
  type DecisionContext,
} from "./route-scoring";
import {
  estimateRouteCost,
  formatCostDisplay,
  type CostEstimate,
} from "./pricing";
import {
  createDecisionLog,
  logDecision,
  validateDecisionHonesty,
  type DecisionLog,
} from "./decision-log";
import { INTENT_WEIGHTS } from "./route-scoring";
import {
  makeRouteDecision,
  isLLMAvailable,
  type LLMDecisionResult,
  type LLMDecisionContext,
} from "./llm-decision";
import type {
  AgentRequest,
  RouteRecommendation,
  RouteStep,
  CityProfile,
  TravelMood,
  DepthLayerOutput,
  PlacesFallbackResult,
  TripIntent,
  UserPackage,
} from "@shared/schema";
import {
  getQuotes,
  formatPriceRange,
  type Quote,
  type QuoteRequest,
  type CityCode,
} from "./quotes";
import { getDetourSuggestions, type DetourSuggestion } from "./memory-assistant-service";

// ============================================
// TIME UTILITIES
// ============================================

/**
 * Get time context in the city's local timezone
 * This is critical for accurate rush hour / night time detection
 */
export function getTimeContext(timezone?: string): {
  isNightTime: boolean;
  isRushHour: boolean;
  isLateNight: boolean;
  hour: number;
  localTimeStr: string;
  localDate: Date;
} {
  const now = new Date();

  // If timezone provided, get local hour in that timezone
  let hour: number;
  let minute: number;
  let localTimeStr: string;
  let localDate: Date;

  if (timezone) {
    try {
      // Get time in city's timezone using formatToParts for full date/time extraction
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        weekday: 'short',
      });
      const parts = formatter.formatToParts(now);
      const get = (type: string) => parts.find(p => p.type === type)?.value || '';

      const rawHour = parseInt(get('hour'), 10);
      // Intl.DateTimeFormat returns 24 for midnight with hour12:false — normalize to 0
      hour = (isNaN(rawHour) ? now.getHours() : rawHour) % 24;
      minute = parseInt(get('minute'), 10) || now.getMinutes();
      const year = parseInt(get('year'), 10) || now.getFullYear();
      const month = parseInt(get('month'), 10) - 1; // 0-indexed for Date constructor
      const day = parseInt(get('day'), 10) || now.getDate();

      // Construct a Date whose getDay/getHours/toTimeString reflect city-local values
      localDate = new Date(year, month, day, hour, minute, 0, 0);

      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      localTimeStr = timeFormatter.format(now);
    } catch (e) {
      // Fallback to server time if timezone parsing fails
      hour = now.getHours();
      minute = now.getMinutes();
      localDate = now;
      localTimeStr = `${hour}:${minute.toString().padStart(2, '0')} (server)`;
    }
  } else {
    hour = now.getHours();
    minute = now.getMinutes();
    localDate = now;
    localTimeStr = `${hour}:${minute.toString().padStart(2, '0')} (server)`;
  }

  return {
    hour,
    localTimeStr,
    localDate,
    isNightTime: hour < 6 || hour >= 22,
    isLateNight: hour >= 22 || hour < 5,
    isRushHour: (hour >= 7 && hour < 9) || (hour >= 17 && hour < 19),
  };
}

// ============================================
// MODE CONVERSION
// ============================================

function googleModeToRoutedMode(mode: TravelMode): RouteRecommendation["mode"] {
  switch (mode) {
    case "transit": return "transit";
    case "driving": return "rideshare";
    case "walking": return "walk";
    case "bicycling": return "bike";
    default: return "transit";
  }
}

// ============================================
// QUOTE TO CANDIDATE CONVERSION
// ============================================

/**
 * Convert a ridehail quote to a RouteCandidate for scoring.
 * This allows quotes to compete with transit/walking options.
 */
function quoteToCandidate(quote: Quote, origin: string, destination: string): RouteCandidate {
  const avgPrice = (quote.price.min + quote.price.max) / 2;
  const priceLabel = `Est. ${formatPriceRange(quote.price)}`;

  // Create a synthetic Google Maps route from the quote
  const syntheticRoute: GoogleMapsRoute = {
    distance: { text: `${((quote.debug?.distanceKm || 5) * 1000).toFixed(0)}m`, value: (quote.debug?.distanceKm || 5) * 1000 },
    duration: { text: `${quote.tripEtaMin} min`, value: quote.tripEtaMin * 60 },
    steps: [{
      travelMode: "DRIVING",
      distance: { text: `${((quote.debug?.distanceKm || 5) * 1000).toFixed(0)}m`, value: (quote.debug?.distanceKm || 5) * 1000 },
      duration: { text: `${quote.tripEtaMin} min`, value: quote.tripEtaMin * 60 },
      htmlInstructions: `Take ${quote.providerName} to ${destination}`,
      startLocation: { lat: 0, lng: 0 },
      endLocation: { lat: 0, lng: 0 },
    }],
  };

  // Calculate scores for the candidate
  const candidate: RouteCandidate = {
    mode: "driving" as TravelMode,
    route: syntheticRoute,
    archetype: quote.tags.includes("premium") ? "comfort" : "fast",
    metrics: {
      durationMinutes: quote.tripEtaMin + quote.pickupEtaMin, // Include wait time
      walkingMinutes: 0,
      transferCount: 0,
      hasComplexStation: false,
      nightReliabilityAdjusted: quote.availabilityConfidence === "high",
    },
    scores: {
      calm: quote.tags.includes("premium") ? 0.9 : 0.7,
      fast: quote.pickupEtaMin <= 3 ? 0.9 : 0.6,
      comfort: quote.tags.includes("premium") ? 0.95 : 0.7,
      cost: Math.max(0, 1 - (avgPrice / 5000)), // Normalize cost score
    },
    finalScore: 0.7, // Will be recalculated
    // Store quote metadata for later use
    quoteData: {
      providerId: quote.providerId,
      providerName: quote.providerName,
      priceLabel,
      pickupEtaMin: quote.pickupEtaMin,
      execution: quote.execution,
      tags: quote.tags,
    },
  };

  return candidate;
}

/**
 * Fetch ridehail quotes and convert to candidates
 */
async function fetchRidehailCandidates(
  request: AgentRequest,
  cityCode: CityCode,
  originCoords?: { lat: number; lng: number },
  destCoords?: { lat: number; lng: number }
): Promise<RouteCandidate[]> {
  // If we don't have coordinates, we can't get quotes
  if (!originCoords || !destCoords) {
    return [];
  }

  try {
    // Check if user wants to avoid ridehail (economy preference)
    if (request.economyVsComfort !== undefined && request.economyVsComfort <= 20) {
      return []; // Skip quotes for very economy-focused users
    }

    const quoteRequest: QuoteRequest = {
      cityCode,
      origin: { lat: originCoords.lat, lng: originCoords.lng },
      destination: { lat: destCoords.lat, lng: destCoords.lng },
      constraints: {
        isDateContext: request.userNote?.toLowerCase().includes("date") || false,
        preferComfort: (request.economyVsComfort ?? 50) > 70,
        preferReliability: request.intent === "appointment" || request.intent === "time_sensitive",
      },
    };

    const quoteResponse = await getQuotes(quoteRequest);

    // Convert quotes to candidates
    return quoteResponse.quotes.map((quote) =>
      quoteToCandidate(quote, request.origin, request.destination)
    );
  } catch (error) {
    console.warn("[Agent] Failed to fetch ridehail quotes:", error);
    return [];
  }
}

// ============================================
// REQUEST ID GENERATOR
// ============================================

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ============================================
// MAIN RECOMMENDATION ENGINE
// ============================================

export interface RecommendationResult {
  recommendation: RouteRecommendation;
  originCoords?: { lat: number; lng: number };
  destCoords?: { lat: number; lng: number };
  decisionLog?: DecisionLog;
}

export async function getRecommendation(
  request: AgentRequest
): Promise<RecommendationResult> {
  const requestId = generateRequestId();
  const log = createDecisionLog(requestId);

  // Log inputs
  log.inputs = {
    origin: request.origin,
    destination: request.destination,
    cityId: request.cityId,
    intent: request.intent || "leisure",
    userNote: request.userNote,
    calmVsFast: request.calmVsFast ?? 50,
    economyVsComfort: request.economyVsComfort ?? 50,
    unfamiliarWithCity: request.unfamiliarWithCity ?? false,
  };

  const cityProfile = getCityProfile(request.cityId);
  if (!cityProfile) {
    log.warnings.push(`Unknown city: ${request.cityId}`);
    logDecision(log);
    throw new Error(`Unknown city: ${request.cityId}`);
  }

  // Fetch real data in parallel
  const departureTime = request.departureTime ? new Date(request.departureTime) : undefined;
  const [routeOptions, weather, activePackage] = await Promise.all([
    getMultipleRoutes(request.origin, request.destination, departureTime),
    getWeather(request.cityId),
    request.userId ? storage.getUserActivePackage(request.userId, request.cityId) : null,
  ]);

  log.flags.googleMapsReturned = routeOptions.length;

  // Weather fallback (this is safe - weather doesn't affect honesty)
  const weatherData: WeatherData = weather || {
    condition: "clear",
    description: "clear sky",
    temperature: 20,
    feelsLike: 18,
    humidity: 50,
    windSpeed: 3,
    isOutdoorFriendly: true,
    advice: "Weather data unavailable.",
  };

  // Get time context in the CITY's local timezone (not server time)
  const timeContext = getTimeContext(cityProfile.timezone);
  console.log(`[Time] ${cityProfile.name}: ${timeContext.localTimeStr} (${cityProfile.timezone}), night=${timeContext.isNightTime}, lateNight=${timeContext.isLateNight}`);

  // Build scoring context from request + environment
  const scoringContext: ScoringContext = {
    intent: request.intent || "leisure",
    userNote: request.userNote,
    calmVsFast: request.calmVsFast ?? 50,
    economyVsComfort: request.economyVsComfort ?? 50,
    unfamiliarWithCity: request.unfamiliarWithCity ?? false,
    cityProfile,
    weather: {
      isOutdoorFriendly: weatherData.isOutdoorFriendly,
      condition: weatherData.condition,
      temperature: weatherData.temperature,
    },
    isNightTime: timeContext.isNightTime,
    isLateNight: timeContext.isLateNight,
    isRushHour: timeContext.isRushHour,
  };

  // Log constraints derived from inputs
  const intent = request.intent || "leisure";
  const baseWeights = INTENT_WEIGHTS[intent] || INTENT_WEIGHTS.leisure;
  const noteModifiers = parseNoteKeywords(request.userNote);

  log.constraints = {
    intentWeights: { ...baseWeights },
    noteModifiers: {
      walkingPenalty: noteModifiers.walkingPenalty,
      rushPenalty: noteModifiers.rushPenalty,
      comfortBonus: noteModifiers.comfortBonus,
      keywords: noteModifiers.keywords,
    },
    finalWeights: { calm: 0, fast: 0, comfort: 0 }, // Will be set after selection
    modeFiltering: scoringContext.economyVsComfort <= 30 ? "driving excluded due to economy preference" : null,
  };

  // Get user's learned preferences if available
  const learnedPreferences = request.userId
    ? await storage.getLearnedPreferences(request.userId)
    : undefined;

  // Try to extract coordinates from origin/destination for ridehail quotes
  // For now, we'll use approximate coords if the origin looks like coords
  let originCoords: { lat: number; lng: number } | undefined;
  let destCoords: { lat: number; lng: number } | undefined;

  // Check if origin is in "lat,lng" format
  const originMatch = request.origin.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (originMatch) {
    originCoords = { lat: parseFloat(originMatch[1]), lng: parseFloat(originMatch[2]) };
  }

  // If we have route options, try to get coords from the first route
  if (routeOptions.length > 0 && routeOptions[0].route.steps.length > 0) {
    const firstStep = routeOptions[0].route.steps[0];
    const lastStep = routeOptions[0].route.steps[routeOptions[0].route.steps.length - 1];
    if (!originCoords && firstStep.startLocation) {
      originCoords = firstStep.startLocation;
    }
    if (lastStep.endLocation) {
      destCoords = lastStep.endLocation;
    }
  }

  // Fetch ridehail quotes in parallel (non-blocking)
  let ridehailCandidates: RouteCandidate[] = [];
  if (originCoords && destCoords) {
    try {
      ridehailCandidates = await fetchRidehailCandidates(
        request,
        request.cityId as CityCode,
        originCoords,
        destCoords
      );
      log.flags.ridehailQuotesFetched = ridehailCandidates.length;
    } catch (error) {
      console.warn("[Agent] Ridehail quotes failed:", error);
      log.warnings.push("Ridehail quotes unavailable");
    }
  }

  // If we have route options, use LLM to select the best one
  if (routeOptions.length > 0) {
    const result = await processRouteOptions(
      request,
      routeOptions,
      scoringContext,
      cityProfile,
      activePackage ?? null,
      log,
      learnedPreferences ? {
        walkingToleranceMin: learnedPreferences.walkingToleranceMin,
        transferTolerance: learnedPreferences.transferTolerance,
        calmQuickBias: learnedPreferences.calmQuickBias,
      } : undefined,
      ridehailCandidates // Pass ridehail candidates
    );

    // Validate honesty
    const violations = validateDecisionHonesty(log);
    if (violations.length > 0) {
      log.warnings.push(...violations);
    }

    logDecision(log);
    return { recommendation: result, originCoords, destCoords };
  }

  // NO ROUTES AVAILABLE — Be honest about it
  log.flags.usedFallback = true;
  log.warnings.push("Google Maps returned no routes - cannot provide reliable recommendation");

  // Instead of generating fake routes, return an honest failure
  const honestResult = generateHonestNoRoutesResponse(request, cityProfile, log);
  logDecision(log);
  return { recommendation: honestResult, originCoords, destCoords };
}

/**
 * Process route options with the LLM-powered decision engine
 */
async function processRouteOptions(
  request: AgentRequest,
  routeOptions: { mode: TravelMode; route: GoogleMapsRoute }[],
  context: ScoringContext,
  cityProfile: CityProfile,
  activePackage: UserPackage | null,
  log: DecisionLog,
  learnedPreferences?: { walkingToleranceMin: number; transferTolerance: number; calmQuickBias: number },
  ridehailCandidates: RouteCandidate[] = []
): Promise<RouteRecommendation> {
  // Score all transit/walking candidates (still needed for metrics extraction)
  const transitCandidates: RouteCandidate[] = routeOptions.map(({ mode, route }) =>
    scoreRouteCandidate(mode, route, context)
  );

  // Combine with ridehail candidates
  const candidates: RouteCandidate[] = [...transitCandidates, ...ridehailCandidates];

  // Log ridehail options if present
  if (ridehailCandidates.length > 0) {
    log.flags.ridehailOptionsIncluded = ridehailCandidates.length;
    const cheapestRidehail = ridehailCandidates.reduce((a, b) =>
      (a.quoteData?.priceLabel || "").localeCompare(b.quoteData?.priceLabel || "") < 0 ? a : b
    );
    log.debug = log.debug || {};
    log.debug.cheapestRidehailProvider = cheapestRidehail.quoteData?.providerName;
    log.debug.ridehailPriceLabel = cheapestRidehail.quoteData?.priceLabel;
  }

  // Parse note for walking preferences
  const noteModifiers = parseNoteKeywords(context.userNote);
  const wantsToWalk = noteModifiers.keywords.includes('wants_walk');
  const walkingPreference = noteModifiers.walkingPreference;

  // Log walking preference for debugging
  if (wantsToWalk) {
    console.log(`[Agent] User wants to walk! Preference strength: ${walkingPreference}`);
  }

  // Build context for LLM decision
  const userContext: LLMDecisionContext['userContext'] = {
    intent: context.intent,
    userNote: context.userNote,
    calmVsFast: context.calmVsFast,
    economyVsComfort: context.economyVsComfort,
    unfamiliarWithCity: context.unfamiliarWithCity,
    wantsToWalk,
    walkingPreference,
  };

  // Get time context for LLM prompt — reuse from caller via scoring context
  const llmTimeContext = getTimeContext(cityProfile.timezone);

  const environmentContext: LLMDecisionContext['environmentContext'] = {
    weather: {
      condition: context.weather.condition,
      temperature: context.weather.temperature,
      isOutdoorFriendly: context.weather.isOutdoorFriendly,
    },
    isRushHour: context.isRushHour,
    isNightTime: context.isNightTime,
    isLateNight: context.isLateNight,
    localTimeStr: llmTimeContext.localTimeStr,
    cityName: cityProfile.name,
    cityCharacteristics: {
      walkingFriendliness: cityProfile.walkingFriendliness,
      transitReliability: cityProfile.transitVsTaxiBias,
      nightSafety: cityProfile.nightReliability,
    },
  };

  // Convert learned preferences if available
  const llmLearnedPrefs = learnedPreferences ? {
    preferredWalkingTolerance: learnedPreferences.walkingToleranceMin,
    transferTolerance: learnedPreferences.transferTolerance,
    typicalCalmVsQuickBias: learnedPreferences.calmQuickBias,
    recentPatterns: [] as string[], // Could be populated from recent events
  } : undefined;

  // Make LLM-powered decision
  let llmResult: LLMDecisionResult;
  try {
    llmResult = await makeRouteDecision(
      candidates,
      userContext,
      environmentContext,
      llmLearnedPrefs,
      { preferLLM: true, debugMode: log.flags.usedFallback !== undefined }
    );

    log.flags.llmCalled = llmResult.usedLLM;
    log.flags.llmFailed = false;
  } catch (error) {
    console.error('Route decision failed:', error);
    log.flags.llmCalled = true;
    log.flags.llmFailed = true;
    // Ultimate fallback to first candidate
    llmResult = {
      decision: {
        selectedCandidateIndex: 0,
        reasoning: "Decision engine failed, selecting first available option.",
        confidenceScore: 0.3,
        keyFactors: ["fallback selection"],
      },
      selectedCandidate: candidates[0],
      usedLLM: false,
    };
    log.warnings.push(`Decision engine error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  const { decision: llmDecision, selectedCandidate: selected } = llmResult;

  // Log candidates for debugging
  log.candidates = candidates.map(c => ({
    mode: c.mode,
    archetype: c.archetype,
    scores: { ...c.scores },
    finalScore: c.finalScore,
    durationMinutes: c.metrics.durationMinutes,
    walkingMinutes: c.metrics.walkingMinutes,
    transferCount: c.metrics.transferCount,
  }));

  // Build decision context from LLM output
  const decision: DecisionContext = {
    chosenArchetype: selected.archetype,
    primaryReason: llmDecision.reasoning,
    secondaryReasons: llmDecision.keyFactors,
    tradeoffs: llmDecision.tradeoffAcknowledgment ? [llmDecision.tradeoffAcknowledgment] : [],
    wasOnlyOption: candidates.length === 1,
    intentInfluence: llmDecision.keyFactors.find(f => f.toLowerCase().includes(context.intent)) || null,
    noteInfluence: context.userNote && llmDecision.reasoning.toLowerCase().includes(context.userNote.split(' ')[0].toLowerCase())
      ? llmDecision.reasoning
      : null,
  };

  // Log decision
  log.decision = {
    selectedMode: selected.mode,
    selectedArchetype: selected.archetype,
    wasOnlyOption: decision.wasOnlyOption,
    primaryReason: decision.primaryReason,
    intentInfluence: decision.intentInfluence,
    noteInfluence: decision.noteInfluence,
    tradeoffs: decision.tradeoffs,
  };

  // Validate the route
  const validation = validateRoute(selected);
  if (!validation.isValid) {
    log.warnings.push(`Route validation issues: ${validation.issues.join(", ")}`);
  }

  // Build the recommendation with LLM reasoning
  return buildRecommendationWithLLM(
    request,
    selected,
    llmDecision,
    context,
    cityProfile,
    activePackage,
    Math.max(validation.confidence, llmDecision.confidenceScore)
  );
}

/**
 * Build the final recommendation from a selected candidate (legacy)
 */
function buildRecommendation(
  request: AgentRequest,
  candidate: RouteCandidate,
  decision: DecisionContext,
  context: ScoringContext,
  cityProfile: CityProfile,
  activePackage: UserPackage | null,
  confidence: number
): RouteRecommendation {
  const { mode, route, metrics } = candidate;

  // Map steps - use simplified steps for rideshare (no turn-by-turn navigation)
  let steps;
  if (mode === "driving") {
    // For rideshare/taxi, simplify to just the ride itself
    const originCoords = route.steps[0]?.startLocation;
    const destCoords = route.steps[route.steps.length - 1]?.endLocation;
    steps = createSimplifiedRideshareSteps(
      request.origin,
      request.destination,
      metrics.durationMinutes,
      route.distance.value,
      originCoords,
      destCoords
    );
  } else {
    steps = mapToRouteSteps(route.steps, request.origin, request.destination);
  }

  // Calculate stress score
  const stressScore = calculateStressScore(candidate, context);

  // Estimate cost (no fake precision)
  const costEstimate = estimateRouteCost(
    googleModeToRoutedMode(mode),
    metrics.durationMinutes,
    route.distance.value,
    request.cityId,
    route.fare,
    activePackage
  );

  // Generate explanation from ACTUAL decision
  const reasoning = generateExplanation(decision);

  // Build summary
  const summary = buildSummary(candidate, context, decision);

  // Generate maps link
  const googleMapsLink = generateGoogleMapsDeepLink(
    request.origin,
    request.destination,
    mode
  );

  return {
    mode: googleModeToRoutedMode(mode),
    summary,
    estimatedDuration: metrics.durationMinutes,
    estimatedCost: costEstimate.rawValueCents ?? null,
    costDisplay: formatCostDisplay(costEstimate),
    stressScore,
    steps,
    reasoning,
    confidence,
    googleMapsLink,
    // Additional metadata for UI
    decisionMetadata: {
      archetype: candidate.archetype,
      wasOnlyOption: decision.wasOnlyOption,
      tradeoffs: decision.tradeoffs,
      isCoveredByPass: costEstimate.isCoveredByPackage,
    },
  } as RouteRecommendation;
}

/**
 * Build the final recommendation with LLM-generated reasoning
 */
function buildRecommendationWithLLM(
  request: AgentRequest,
  candidate: RouteCandidate,
  llmDecision: { reasoning: string; confidenceScore: number; keyFactors: string[]; tradeoffAcknowledgment?: string; walkingRecommendation?: string },
  context: ScoringContext,
  cityProfile: CityProfile,
  activePackage: UserPackage | null,
  confidence: number
): RouteRecommendation {
  const { mode, route, metrics } = candidate;

  // Map steps - use simplified steps for rideshare (no turn-by-turn navigation)
  let steps;
  if (mode === "driving") {
    // For rideshare/taxi, simplify to just the ride itself
    const originCoords = route.steps[0]?.startLocation;
    const destCoords = route.steps[route.steps.length - 1]?.endLocation;
    steps = createSimplifiedRideshareSteps(
      request.origin,
      request.destination,
      metrics.durationMinutes,
      route.distance.value,
      originCoords,
      destCoords
    );
  } else {
    steps = mapToRouteSteps(route.steps, request.origin, request.destination);
  }

  // Calculate stress score
  const stressScore = calculateStressScore(candidate, context);

  // Estimate cost (no fake precision)
  const costEstimate = estimateRouteCost(
    googleModeToRoutedMode(mode),
    metrics.durationMinutes,
    route.distance.value,
    request.cityId,
    route.fare,
    activePackage
  );

  // Use LLM's reasoning — keep it concise, don't pile on all fields
  let reasoning = llmDecision.reasoning;

  // Only append tradeoff OR walking rec, not both — pick whichever is more relevant
  if (llmDecision.walkingRecommendation && llmDecision.walkingRecommendation.length > 5) {
    reasoning += ` ${llmDecision.walkingRecommendation}`;
  } else if (llmDecision.tradeoffAcknowledgment && llmDecision.tradeoffAcknowledgment.length > 5) {
    reasoning += ` ${llmDecision.tradeoffAcknowledgment}`;
  }

  // Build summary
  const summary = buildLLMSummary(candidate, llmDecision.keyFactors);

  // Generate maps link
  const googleMapsLink = generateGoogleMapsDeepLink(
    request.origin,
    request.destination,
    mode
  );

  return {
    mode: googleModeToRoutedMode(mode),
    summary,
    estimatedDuration: metrics.durationMinutes,
    estimatedCost: costEstimate.rawValueCents ?? null,
    costDisplay: formatCostDisplay(costEstimate),
    stressScore,
    steps,
    reasoning,
    confidence: llmDecision.confidenceScore,
    googleMapsLink,
    // Additional metadata for UI
    decisionMetadata: {
      archetype: candidate.archetype,
      wasOnlyOption: false, // LLM considered options
      tradeoffs: llmDecision.tradeoffAcknowledgment ? [llmDecision.tradeoffAcknowledgment] : [],
      isCoveredByPass: costEstimate.isCoveredByPackage,
    },
  } as RouteRecommendation;
}

/**
 * Build summary using LLM key factors
 */
function buildLLMSummary(candidate: RouteCandidate, keyFactors: string[]): string {
  const { mode, metrics } = candidate;

  // Mode-specific prefix
  let prefix: string;
  if (mode === "transit") {
    if (metrics.transferCount === 0) {
      prefix = "Direct transit";
    } else if (metrics.transferCount === 1) {
      prefix = "Transit with one transfer";
    } else {
      prefix = `Transit with ${metrics.transferCount} transfers`;
    }
  } else if (mode === "driving") {
    prefix = "Rideshare";
  } else if (mode === "walking") {
    prefix = "Walk";
  } else {
    prefix = "Route";
  }

  // Duration
  const duration = `${metrics.durationMinutes} min`;

  // Add first key factor if relevant
  let descriptor = "";
  if (keyFactors.length > 0) {
    const factor = keyFactors[0].toLowerCase();
    if (factor.includes("fast") || factor.includes("quick")) {
      descriptor = " — fastest option";
    } else if (factor.includes("calm") || factor.includes("simple") || factor.includes("no transfer")) {
      descriptor = " — relaxed option";
    } else if (factor.includes("comfort") || factor.includes("weather")) {
      descriptor = " — comfortable choice";
    } else if (factor.includes("walk") && factor.includes("minimal")) {
      descriptor = " — minimal walking";
    }
  }

  return `${prefix}, ${duration}${descriptor}`;
}

/**
 * Build a natural-language summary
 */
function buildSummary(
  candidate: RouteCandidate,
  context: ScoringContext,
  decision: DecisionContext
): string {
  const { mode, metrics, archetype } = candidate;

  // Mode-specific prefix
  let prefix: string;
  if (mode === "transit") {
    if (metrics.transferCount === 0) {
      prefix = "Direct transit";
    } else if (metrics.transferCount === 1) {
      prefix = "Transit with one transfer";
    } else {
      prefix = `Transit with ${metrics.transferCount} transfers`;
    }
  } else if (mode === "driving") {
    prefix = "Rideshare";
  } else if (mode === "walking") {
    prefix = "Walk";
  } else {
    prefix = "Route";
  }

  // Duration
  const duration = `${metrics.durationMinutes} min`;

  // Archetype descriptor - ONLY if there were multiple options
  let descriptor = "";
  if (!decision.wasOnlyOption) {
    if (archetype === "calm") {
      descriptor = " — relaxed pace";
    } else if (archetype === "fast") {
      descriptor = " — fastest option";
    }
  }

  return `${prefix}, ${duration}${descriptor}`;
}

/**
 * HONEST response when Google Maps returns no routes
 *
 * CRITICAL: We do NOT generate fake routes. We tell the user
 * that we couldn't find routes and suggest alternatives.
 */
function generateHonestNoRoutesResponse(
  request: AgentRequest,
  cityProfile: CityProfile,
  log: DecisionLog
): RouteRecommendation {
  log.decision = {
    selectedMode: "unknown",
    selectedArchetype: "unknown",
    wasOnlyOption: true,
    primaryReason: "No routes available from mapping service",
    intentInfluence: null, // HONEST: We can't claim intent influenced anything
    noteInfluence: null,   // HONEST: We can't claim note influenced anything
    tradeoffs: [],
  };

  // Generate a deep link to Google Maps so user can check themselves
  const googleMapsLink = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(request.origin)}&destination=${encodeURIComponent(request.destination)}`;

  return {
    mode: "mixed",
    summary: "Route unavailable",
    estimatedDuration: 0,
    estimatedCost: null,
    costDisplay: "Unknown",
    stressScore: 0.5,
    steps: [],
    reasoning: "I couldn't find routes between these locations. This might mean the places aren't recognized, or they're in a different city. Please verify on Google Maps.",
    confidence: 0.1, // Very low confidence
    googleMapsLink,
    decisionMetadata: {
      archetype: "unknown",
      wasOnlyOption: true,
      tradeoffs: [],
      isCoveredByPass: false,
    },
  } as RouteRecommendation;
}

// ============================================
// TRIP REPLANNING
// ============================================

export async function replanTrip(
  tripId: string,
  reason: "delay" | "weather" | "missed_step" | "user_request"
): Promise<RouteRecommendation | null> {
  const trip = await storage.getTrip(tripId);
  if (!trip) return null;

  const result = await getRecommendation({
    origin: trip.originName,
    destination: trip.destinationName,
    cityId: trip.cityId,
    userId: trip.userId || undefined,
    intent: (trip.intent as TripIntent) || "leisure",
    userNote: trip.userNote || undefined,
  });
  return result.recommendation;
}

// ============================================
// RECOMMENDATION WITH DEPTH LAYER
// ============================================

/**
 * Get recommendation with depth layer output
 * This is the main entry point for the recommendation flow
 */
export async function getRecommendationWithDepth(
  request: AgentRequest
): Promise<{ recommendation: RouteRecommendation; depthLayer: DepthLayerOutput; detourMeta: DetourMeta }> {
  const cityProfile = getCityProfile(request.cityId);
  if (!cityProfile) {
    throw new Error(`Unknown city: ${request.cityId}`);
  }

  // VENUE GATE: Check if destination is closed BEFORE generating routes
  const timeContext = getTimeContext(cityProfile.timezone);
  const venueInfo = await resolveVenueInfo(request.destination, request.cityId, timeContext.localDate);

  if (venueInfo && !venueInfo.isOpenNow) {
    console.log(`[Agent] Venue gate: ${request.destination} is closed at ${timeContext.localTimeStr}`);
    return {
      recommendation: {
        mode: "transit",
        summary: `${request.destination} is currently closed.`,
        estimatedDuration: 0,
        estimatedCost: null,
        stressScore: 0,
        steps: [],
        reasoning: venueInfo.nextOpenTime
          ? `${request.destination} is closed right now. ${venueInfo.nextOpenTime}.`
          : `${request.destination} is closed right now.`,
        confidence: 1.0,
      } as RouteRecommendation,
      depthLayer: {
        agentPresenceLine: `It's ${timeContext.localTimeStr} in ${cityProfile.name}.`,
        tripFramingLine: venueInfo.nextOpenTime || "Check the venue's hours before heading out.",
        contextualInsights: [],
        responsibilityLine: "I'll have a route ready when it reopens.",
      },
      detourMeta: { detour_mode: "none", detour_candidates_returned: 0, places_candidates_returned: 0 },
    };
  }

  // Get the base recommendation (DECISION HAPPENS HERE)
  const { recommendation, originCoords, destCoords } = await getRecommendation(request);

  // If recommendation failed (no routes), return minimal depth layer
  if (recommendation.steps.length === 0) {
    return {
      recommendation,
      depthLayer: {
        agentPresenceLine: "I couldn't find routes for these locations.",
        tripFramingLine: "Please verify the locations are correct.",
        contextualInsights: [],
        responsibilityLine: "Try checking Google Maps directly.",
      },
      detourMeta: { detour_mode: "none", detour_candidates_returned: 0, places_candidates_returned: 0 },
    };
  }

  // Classify POI intent from user note
  const poiClassification = classifyPoiIntent(request.userNote);
  const foodPref = poiClassification.foodPref;
  console.log(`[Agent] POI intent: ${poiClassification.intent || "none"}, foodPref: ${foodPref || "none"}, casual=${poiClassification.noteContext.isCasual}, quickStop=${poiClassification.noteContext.prefersQuickStop}`);

  // Get weather, venue info, and nearby POIs in parallel
  console.log(`[Agent] Depth layer: originCoords=${JSON.stringify(originCoords)}, destCoords=${JSON.stringify(destCoords)}`);
  const [weather, depthVenueInfo, nearbyPois] = await Promise.all([
    getWeather(request.cityId),
    resolveVenueInfo(request.destination, request.cityId, timeContext.localDate),
    (originCoords && destCoords
      ? getDetourSuggestions(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng, "any", 15)
        .then((r) => { console.log(`[Agent] POI fetch returned ${r?.suggestions?.length ?? 0} suggestions`); return r; })
        .catch((e) => { console.warn("[Agent] POI fetch failed:", e); return null; })
      : Promise.resolve(null)
    ),
  ]);

  const weatherData = weather || {
    condition: "clear",
    description: "clear sky",
    temperature: 20,
    feelsLike: 18,
    humidity: 50,
    windSpeed: 3,
    isOutdoorFriendly: true,
    advice: "Weather data unavailable.",
  };

  // Get user's learned preferences and recent events
  const userId = request.userId;
  const learnedPreferences = userId ? await storage.getLearnedPreferences(userId) : undefined;
  const recentEvents = userId ? await storage.getUserEvents(userId, 50) : [];
  const tripCount = userId ? await storage.getUserTripCount(userId) : 0;

  // Prepare POI list for depth layer
  const poiList = nearbyPois?.suggestions?.slice(0, 3) ?? [];
  console.log(`[Agent] POI list for depth layer: ${poiList.map(p => p.name).join(", ") || "none"}`);

  // Generate depth layer (LLM refines wording + incorporates POI data)
  let depthLayer: DepthLayerOutput;
  try {
    depthLayer = await generateDepthLayer({
      userId,
      learnedPreferences,
      recentEvents,
      intent: request.intent || "leisure",
      userNote: request.userNote,
      origin: request.origin,
      destination: request.destination,
      recommendation,
      cityProfile,
      weather: weatherData,
      venueInfo: depthVenueInfo || undefined,
      tripCount,
      nearbyPois: poiList.length > 0 ? poiList : undefined,
    });
  } catch (error) {
    console.warn("Depth layer generation failed, using simple fallback:", error);
    depthLayer = generateSimpleDepthLayer({
      userId,
      learnedPreferences,
      recentEvents,
      intent: request.intent || "leisure",
      userNote: request.userNote,
      origin: request.origin,
      destination: request.destination,
      recommendation,
      cityProfile,
      weather: weatherData,
      venueInfo: depthVenueInfo || undefined,
      tripCount,
    });
  }

  // Filter POIs by classified intent (not just raw food pref)
  const relevantPois = filterPoisByPreference(poiList, foodPref, request.userNote);
  console.log(`[Agent] Relevant POIs after intent filter: ${relevantPois.map(p => p.name).join(", ") || "none"}`);

  // Resolve detour fallback (curated POIs → Places API → nothing)
  const fallbackResult = await resolveDetourFallback({
    relevantPois,
    foodPref,
    allPois: poiList,
    userNote: request.userNote,
    originCoords,
    destCoords,
    poiClassification,
  });

  // Inject curated POI insights into depth layer (only when curated matched)
  if (relevantPois.length > 0) {
    const insightsText = depthLayer.contextualInsights.join(" ").toLowerCase();
    const missingPois = relevantPois.filter(
      (poi) => !insightsText.includes(poi.name.toLowerCase())
    );
    if (missingPois.length > 0) {
      const poiInsights = missingPois.slice(0, 2).map((poi) => {
        const orderTip = poi.what_to_order?.length ? ` — try ${poi.what_to_order[0]}` : "";
        return `${poi.name} (${Math.round(poi.adds_minutes)} min detour)${orderTip}`;
      });
      const available = 4 - depthLayer.contextualInsights.length;
      if (available > 0) {
        depthLayer.contextualInsights.push(...poiInsights.slice(0, available));
      }
    }
  }

  // Store Places fallback results on depth layer
  if (fallbackResult.fallbackResults.length > 0) {
    depthLayer.placesFallbackResults = fallbackResult.fallbackResults;
  }

  // Append reasoning
  if (fallbackResult.reasoningAppend) {
    recommendation.reasoning += fallbackResult.reasoningAppend;
  }

  return { recommendation, depthLayer, detourMeta: fallbackResult.detourMeta };
}

// ============================================
// POI INTENT CLASSIFICATION
// ============================================

/**
 * Typed POI intent — determines what kind of place the user actually wants.
 * This is DIFFERENT from a generic food preference string.
 */
export type PoiIntent =
  | "coffee_primary"    // coffee shop, espresso bar — coffee is the product
  | "cafe_sitdown"      // café with food — sit-down experience
  | "brunch"            // brunch / breakfast spot
  | "restaurant"        // full-service restaurant
  | "bar"               // bar / drinks
  | "bakery"            // bakery / pastry shop
  | "cuisine"           // specific cuisine (stored in foodPref)
  | "general_food"      // generic "food" mention
  | null;               // no POI intent detected

/**
 * Note-derived context that shapes POI behavior.
 */
export interface NoteContext {
  isCasual: boolean;          // dog walk, stroll, quick stop
  prefersOutdoor: boolean;    // walking, park, outdoor
  prefersQuickStop: boolean;  // grab-and-go, quick, on the way
  avoidSitDown: boolean;      // derived from casual + quick signals
}

/**
 * Full POI classification result: intent + food preference + note context.
 */
export interface PoiClassification {
  intent: PoiIntent;
  foodPref: string | null;     // cuisine string for backward compat (e.g. "chinese")
  noteContext: NoteContext;
  searchQuery: string | null;  // what to send to Places API
  searchLabel: string | null;  // human-readable label for reasoning text
}

/**
 * Classify user note into a POI intent with note-aware context.
 *
 * Key distinction: "coffee shop" → COFFEE_PRIMARY (quick, takeaway-friendly)
 *                  "café"        → CAFE_SITDOWN  (sit-down, food-forward)
 *                  "coffee shop" + "dog walk" → COFFEE_PRIMARY + casual + quick
 */
export function classifyPoiIntent(note?: string): PoiClassification {
  const empty: PoiClassification = {
    intent: null,
    foodPref: null,
    noteContext: { isCasual: false, prefersOutdoor: false, prefersQuickStop: false, avoidSitDown: false },
    searchQuery: null,
    searchLabel: null,
  };
  if (!note) return empty;

  const lower = note.toLowerCase();

  // --- 1. Extract note context (applies to ALL intents) ---
  const noteContext = extractNoteContext(lower);

  // --- 2. Check for negative preferences ---
  const negatives: string[] = [];
  const negPatterns = [
    /bored of (\w+)/i,
    /tired of (\w+)/i,
    /no (\w+)/i,
    /not (\w+)/i,
    /sick of (\w+)/i,
    /don'?t want (\w+)/i,
  ];
  for (const pat of negPatterns) {
    const match = lower.match(pat);
    if (match) negatives.push(match[1]);
  }

  // --- 3. Coffee-specific detection (MUST come before generic café) ---
  const coffeePatterns = [
    /\bcoffee\s*shop/i, /\bcoffee\s*recs?/i, /\bcoffee\s*spot/i, /\bcoffee\s*place/i,
    /\bgrab\s*(a\s+)?coffee/i, /\bget\s*(a\s+)?coffee/i, /\bneed\s*(a\s+)?coffee/i,
    /\bespresso\s*(bar|shop)?/i, /\blatte/i, /\bflat\s*white/i,
  ];
  if (coffeePatterns.some((p) => p.test(lower)) && !negatives.includes("coffee")) {
    return {
      intent: "coffee_primary",
      foodPref: "coffee",
      noteContext,
      searchQuery: "coffee shop",
      searchLabel: "coffee",
    };
  }

  // --- 4. Bar / drinks ---
  if (/\b(bars?|drinks?|cocktails?|wine\s*bar|pub|beer)\b/i.test(lower) && !negatives.includes("bar")) {
    return {
      intent: "bar",
      foodPref: "bar",
      noteContext,
      searchQuery: "bar",
      searchLabel: "drinks",
    };
  }

  // --- 5. Bakery ---
  if (/\b(bakery|pastries|pastry\s*shop|fresh\s*bread)\b/i.test(lower) && !negatives.includes("bakery")) {
    return {
      intent: "bakery",
      foodPref: "bakery",
      noteContext,
      searchQuery: "bakery",
      searchLabel: "bakery",
    };
  }

  // --- 6. Brunch (MUST come before café to disambiguate) ---
  if (/\b(brunch|breakfast)\b/i.test(lower) && !negatives.includes("brunch")) {
    return {
      intent: "brunch",
      foodPref: "brunch",
      noteContext,
      searchQuery: "brunch restaurant",
      searchLabel: "brunch",
    };
  }

  // --- 7. Café sit-down (only if "café" is mentioned WITHOUT "coffee") ---
  // Note: \b doesn't work with accented characters, so use lookahead/lookbehind-free approach
  if (/(?:^|\s|[^a-z])caf[eé](?:\s|[^a-z]|$)/i.test(lower) && !negatives.includes("cafe")) {
    // "café" alone → sit-down café; "coffee café" already caught above
    return {
      intent: "cafe_sitdown",
      foodPref: "cafe",
      noteContext,
      searchQuery: "cafe",
      searchLabel: "café",
    };
  }

  // --- 8. Specific cuisine detection ---
  const cuisines: Record<string, string[]> = {
    "chinese": ["chinese", "dim sum", "dumplings", "noodles", "hotpot", "szechuan", "cantonese"],
    "japanese": ["japanese", "sushi", "ramen", "izakaya", "udon", "soba", "tempura"],
    "korean": ["korean", "bibimbap", "kbbq", "korean bbq", "tteokbokki"],
    "thai": ["thai", "pad thai", "tom yum", "green curry"],
    "indian": ["indian", "curry", "tikka", "naan", "biryani", "dosa"],
    "italian": ["italian", "pasta", "risotto", "gelato"],
    "mexican": ["mexican", "tacos", "burritos", "quesadilla"],
    "vietnamese": ["vietnamese", "pho", "banh mi"],
    "mediterranean": ["mediterranean", "falafel", "shawarma", "hummus", "kebab"],
    "french": ["french", "croissant", "crepe", "bistro"],
    "pizza": ["pizza"],
    "burger": ["burger", "burgers"],
    "seafood": ["seafood", "fish", "lobster", "oyster", "crab"],
    "vegetarian": ["vegetarian", "vegan", "plant-based"],
    "dessert": ["dessert", "ice cream", "cake", "pastry", "cookies"],
  };

  for (const [cuisine, keywords] of Object.entries(cuisines)) {
    if (keywords.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(lower))) {
      if (!negatives.includes(cuisine) && !negatives.some((n) => keywords.includes(n))) {
        return {
          intent: "cuisine",
          foodPref: cuisine,
          noteContext,
          searchQuery: `${cuisine} restaurant`,
          searchLabel: cuisine,
        };
      }
    }
  }

  // --- 9. Generic food ---
  if (/\b(food|eat|hungry|meal|restaurant|dining)\b/i.test(lower)) {
    return {
      intent: "general_food",
      foodPref: null,
      noteContext,
      searchQuery: null,
      searchLabel: null,
    };
  }

  return { intent: null, foodPref: null, noteContext, searchQuery: null, searchLabel: null };
}

/**
 * Extract note context signals that shape POI behavior.
 */
export function extractNoteContext(noteLower: string): NoteContext {
  const casualSignals = [
    "dog walk", "walk", "stroll", "wander", "casual", "chill",
    "quick", "grab", "on the way", "along the way", "passing by",
  ];
  const outdoorSignals = [
    "dog walk", "walk", "park", "outdoor", "outside", "fresh air",
    "stroll", "run", "jog", "bike",
  ];
  const quickStopSignals = [
    "quick", "grab", "takeaway", "take away", "to go", "to-go",
    "on the way", "along the way", "passing by", "pop in", "stop by",
    "dog walk", // can't sit down long with a dog
  ];

  const isCasual = casualSignals.some((s) => noteLower.includes(s));
  const prefersOutdoor = outdoorSignals.some((s) => noteLower.includes(s));
  const prefersQuickStop = quickStopSignals.some((s) => noteLower.includes(s));
  const avoidSitDown = (isCasual && prefersQuickStop) || noteLower.includes("dog walk");

  return { isCasual, prefersOutdoor, prefersQuickStop, avoidSitDown };
}

// ============================================
// FOOD PREFERENCE EXTRACTION (backward compat)
// ============================================

/**
 * Extract specific food/cuisine preference from user note.
 * Now delegates to classifyPoiIntent for consistency.
 */
function extractFoodPreference(note?: string): string | null {
  return classifyPoiIntent(note).foodPref;
}

// ============================================
// POI FILTERING
// ============================================

/**
 * Score a POI's relevance to a classified intent.
 * Returns negative score for POIs that should be excluded.
 */
function scorePoiRelevance(
  poi: DetourSuggestion,
  classification: PoiClassification,
): number {
  const searchText = [
    poi.name,
    poi.why_special,
    ...(poi.what_to_order || []),
    ...(poi.vibe_tags || []),
    poi.category || "",
  ].join(" ").toLowerCase();

  let relevance = 0;

  // --- Intent-specific scoring ---
  switch (classification.intent) {
    case "coffee_primary": {
      // STRONG positive: coffee-forward signals
      const coffeeTerms = ["coffee", "espresso", "latte", "roaster", "roastery", "flat white", "brew", "drip"];
      for (const t of coffeeTerms) {
        if (searchText.includes(t)) relevance += 3;
      }
      // PENALTY: brunch / restaurant / full-meal signals
      const brunchTerms = ["brunch", "breakfast", "lunch", "dinner", "restaurant", "dining", "full menu"];
      for (const t of brunchTerms) {
        if (searchText.includes(t)) relevance -= 4;
      }
      // Neutral: "cafe" alone is okay if coffee signals present
      if (searchText.includes("cafe") && relevance <= 0) relevance += 1;
      break;
    }
    case "cafe_sitdown": {
      const cafeTerms = ["cafe", "café", "coffee", "espresso", "pastry", "cake"];
      for (const t of cafeTerms) {
        if (searchText.includes(t)) relevance += 2;
      }
      break;
    }
    case "brunch": {
      const brunchTerms = ["brunch", "breakfast", "pancake", "eggs", "benedict", "mimosa", "avocado toast"];
      for (const t of brunchTerms) {
        if (searchText.includes(t)) relevance += 3;
      }
      if (searchText.includes("cafe") || searchText.includes("café")) relevance += 1;
      break;
    }
    case "bakery": {
      const bakeryTerms = ["bakery", "bread", "pastry", "croissant", "sourdough", "cake", "baked"];
      for (const t of bakeryTerms) {
        if (searchText.includes(t)) relevance += 3;
      }
      break;
    }
    case "bar": {
      const barTerms = ["bar", "cocktail", "beer", "wine", "pub", "tap", "draft", "spirits"];
      for (const t of barTerms) {
        if (searchText.includes(t)) relevance += 3;
      }
      break;
    }
    case "cuisine": {
      // Use foodPref-based matching (existing logic)
      const prefLower = classification.foodPref || "";
      if (searchText.includes(prefLower)) relevance += 3;
      const relatedTerms: Record<string, string[]> = {
        "chinese": ["noodle", "dumpling", "wonton", "dim sum", "fried rice", "chinese"],
        "japanese": ["sushi", "ramen", "miso", "tempura", "japanese"],
        "korean": ["kimchi", "bibimbap", "korean", "bulgogi"],
        "mexican": ["taco", "burrito", "salsa", "guacamole", "mexican", "quesadilla"],
        "italian": ["pasta", "pizza", "risotto", "italian", "mozzarella"],
        "pizza": ["pizza", "slice", "pie"],
        "dessert": ["cookie", "cake", "pastry", "ice cream", "chocolate", "bakery"],
      };
      const related = relatedTerms[prefLower] || [prefLower];
      for (const term of related) {
        if (searchText.includes(term)) relevance += 1;
      }
      break;
    }
    default:
      // general_food or null — generic relevance
      if (searchText.includes(classification.foodPref || "")) relevance += 1;
      break;
  }

  // --- Note context adjustments ---
  if (classification.noteContext.avoidSitDown) {
    // Penalize sit-down / formal dining signals
    const sitDownTerms = ["restaurant", "dining", "reservation", "fine dining", "full menu", "brunch"];
    for (const t of sitDownTerms) {
      if (searchText.includes(t)) relevance -= 3;
    }
    // Boost casual / quick signals
    const casualTerms = ["takeaway", "to-go", "quick", "casual", "counter", "walk-up", "grab"];
    for (const t of casualTerms) {
      if (searchText.includes(t)) relevance += 2;
    }
  }

  if (classification.noteContext.prefersQuickStop) {
    // Boost POIs with low detour time
    if (poi.adds_minutes <= 3) relevance += 2;
    else if (poi.adds_minutes <= 5) relevance += 1;
    else if (poi.adds_minutes > 10) relevance -= 1;
  }

  return relevance;
}

/**
 * Filter POIs by classified intent + note context.
 * Replaces the old preference-only filtering.
 * Returns at most 3 POIs, preferring fewer correct results over more wrong ones.
 */
export function filterPoisByIntent(
  pois: DetourSuggestion[],
  classification: PoiClassification,
): DetourSuggestion[] {
  if (pois.length === 0) return pois;
  if (!classification.intent) return pois;

  const scored = pois.map((poi) => ({
    poi,
    relevance: scorePoiRelevance(poi, classification),
  }));

  // Only return POIs with positive relevance
  const matching = scored.filter((s) => s.relevance > 0);
  if (matching.length > 0) {
    matching.sort((a, b) => b.relevance - a.relevance);
    // Cap at 3 results — prefer fewer correct results
    return matching.slice(0, 3).map((s) => s.poi);
  }

  return [];
}

/**
 * Filter POIs by user's food preference (backward compat wrapper).
 * Now delegates to intent-aware filtering.
 */
function filterPoisByPreference(
  pois: DetourSuggestion[],
  preference: string | null,
  userNote?: string,
): DetourSuggestion[] {
  if (!preference || pois.length === 0) return pois;
  const classification = classifyPoiIntent(userNote);
  // If classification didn't match but we have a raw preference, fall back to old behavior
  if (!classification.intent) {
    return filterPoisByIntent(pois, {
      intent: "cuisine",
      foodPref: preference,
      noteContext: { isCasual: false, prefersOutdoor: false, prefersQuickStop: false, avoidSitDown: false },
      searchQuery: `${preference} restaurant`,
      searchLabel: preference,
    });
  }
  return filterPoisByIntent(pois, classification);
}

// ============================================
// PLACES FALLBACK HELPERS
// ============================================

function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function estimateWalkMinutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const km = haversineKm(from, to);
  return Math.round((km / 5) * 60); // 5 km/h walking speed
}

function extractNeighborhood(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[1] : null;
}

// ============================================
// DETOUR FALLBACK RESOLUTION (exported for testing)
// ============================================

export interface DetourMeta {
  detour_mode: "curated" | "places_fallback" | "none";
  detour_candidates_returned: number;
  places_candidates_returned: number;
}

export interface DetourFallbackInput {
  relevantPois: DetourSuggestion[];
  foodPref: string | null;
  allPois: DetourSuggestion[];
  userNote?: string;
  originCoords?: { lat: number; lng: number };
  destCoords?: { lat: number; lng: number };
  poiClassification?: PoiClassification;
}

export interface DetourFallbackOutput {
  reasoningAppend: string;
  fallbackResults: PlacesFallbackResult[];
  detourMeta: DetourMeta;
}

/**
 * Determine what to append to reasoning when curated POIs don't match.
 * Extracted as a standalone function for testability.
 */
export async function resolveDetourFallback(input: DetourFallbackInput): Promise<DetourFallbackOutput> {
  const { relevantPois, foodPref, allPois, userNote, originCoords, destCoords, poiClassification } = input;

  // Derive search query and label from classification, falling back to raw foodPref
  const searchQuery = poiClassification?.searchQuery || (foodPref ? `${foodPref} restaurant` : null);
  const searchLabel = poiClassification?.searchLabel || foodPref;

  // Case 1: Curated POIs matched
  if (relevantPois.length > 0) {
    const topPois = relevantPois.slice(0, 3);
    const poiLines = topPois.map((poi) => {
      const tip = poi.what_to_order?.[0] ? ` — try ${poi.what_to_order[0]}` : "";
      const mins = Math.round(poi.adds_minutes);
      return `${poi.name} (+${mins} min${tip})`;
    });
    const poiList = poiLines.join(", ");
    return {
      reasoningAppend: ` Nearby stops worth considering: ${poiList}.`,
      fallbackResults: [],
      detourMeta: {
        detour_mode: "curated",
        detour_candidates_returned: relevantPois.length,
        places_candidates_returned: 0,
      },
    };
  }

  // Case 2: User has a food/POI preference but curated POIs didn't match — try Places API
  if (searchQuery && originCoords && destCoords) {
    const mid = midpoint(originCoords, destCoords);
    const placesResults = await searchPlacesText(searchQuery, mid, 3);

    if (placesResults.length > 0) {
      const fallbackResults: PlacesFallbackResult[] = placesResults.map((p) => ({
        name: p.name,
        neighborhood: extractNeighborhood(p.address),
        approxAddedMinutes: estimateWalkMinutes(mid, { lat: p.lat, lng: p.lng }),
        source: "maps" as const,
        provider_place_id: p.placeId,
      }));

      // Use accurate label — not "X food" when intent is coffee
      const labelText = poiClassification?.intent === "coffee_primary"
        ? `Coffee nearby`
        : poiClassification?.intent === "bakery"
        ? `Bakeries nearby`
        : poiClassification?.intent === "bar"
        ? `Drinks nearby`
        : `For ${searchLabel} nearby`;

      const placeDescriptions = fallbackResults.map((r) => {
        const loc = r.neighborhood ? ` in ${r.neighborhood}` : "";
        return `${r.name}${loc} (+${r.approxAddedMinutes} min)`;
      }).join(", ");

      return {
        reasoningAppend: ` ${labelText}: ${placeDescriptions}.`,
        fallbackResults,
        detourMeta: {
          detour_mode: "places_fallback",
          detour_candidates_returned: 0,
          places_candidates_returned: placesResults.length,
        },
      };
    }

    // Places also returned nothing
    return {
      reasoningAppend: ` No ${searchLabel} spots found along this route yet.`,
      fallbackResults: [],
      detourMeta: {
        detour_mode: "none",
        detour_candidates_returned: 0,
        places_candidates_returned: 0,
      },
    };
  }

  // Case 3: Generic food mention but no specific cuisine
  if (allPois.length === 0 && userNote?.toLowerCase().includes("food")) {
    return {
      reasoningAppend: ``,
      fallbackResults: [],
      detourMeta: {
        detour_mode: "none",
        detour_candidates_returned: 0,
        places_candidates_returned: 0,
      },
    };
  }

  // Case 4: User has food pref but no coordinates for fallback
  if (foodPref && allPois.length > 0) {
    return {
      reasoningAppend: ` No ${searchLabel} spots found along this route yet.`,
      fallbackResults: [],
      detourMeta: {
        detour_mode: "none",
        detour_candidates_returned: 0,
        places_candidates_returned: 0,
      },
    };
  }

  // Case 5: No food preference, no POIs to inject
  return {
    reasoningAppend: "",
    fallbackResults: [],
    detourMeta: {
      detour_mode: "none",
      detour_candidates_returned: 0,
      places_candidates_returned: 0,
    },
  };
}
