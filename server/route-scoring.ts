/**
 * ROUTED ROUTE SCORING ENGINE
 *
 * This module implements deterministic, traceable route scoring that:
 * 1. Generates multiple route candidates with explicit archetypes
 * 2. Scores based on CALM, FAST, COMFORT dimensions
 * 3. Wires intent and semantic notes into scoring weights
 * 4. Produces explanations based on ACTUAL decisions, not generic fluff
 */

import type { TripIntent, CityProfile, RouteStep } from "@shared/schema";
import type { GoogleMapsRoute, TravelMode } from "./google-maps-service";

// ============================================
// TYPES
// ============================================

export type RouteArchetype = "calm" | "fast" | "comfort";

export interface RouteCandidate {
  mode: TravelMode;
  archetype: RouteArchetype;
  route: GoogleMapsRoute;

  // Scoring dimensions (0-100, higher is better for that dimension)
  scores: {
    calm: number;      // Fewer transfers, simpler stations, less cognitive load
    fast: number;      // Shortest ETA
    comfort: number;   // Weather-protected, minimal walking, easier navigation
    cost?: number;     // Optional cost score (for ridehail quotes)
  };

  // Raw metrics for explanation
  metrics: {
    durationMinutes: number;
    walkingMinutes: number;
    walkingMeters?: number;
    transferCount: number;
    hasComplexStation: boolean;
    isWeatherExposed?: boolean;
    stopsCount?: number;
    nightReliabilityAdjusted?: boolean;
  };

  // Final weighted score (computed based on intent/notes)
  finalScore: number;

  // Quote data for ridehail candidates
  quoteData?: {
    providerId: string;
    providerName: string;
    priceLabel: string;
    pickupEtaMin: number;
    execution: {
      type: string;
      url?: string;
      label?: string;
    };
    tags: string[];
  };
}

export interface ScoringContext {
  intent: TripIntent;
  userNote?: string;
  calmVsFast: number;       // 0=calm, 100=fast
  economyVsComfort: number; // 0=economy, 100=comfort
  unfamiliarWithCity: boolean;
  cityProfile: CityProfile;
  weather: {
    isOutdoorFriendly: boolean;
    condition: string;
    temperature: number;
  };
  isNightTime: boolean;
  isLateNight: boolean;
  isRushHour: boolean;
  // Learned preferences from user history
  learnedPreferences?: {
    walkingToleranceMin: number; // Minimum acceptable walking (learned from behavior)
    transferTolerance: number;   // 1-5 scale
    calmQuickBias: number;       // 0-1, 0 = prefer calm, 1 = prefer quick
    saveSpendBias: number;       // 0-1, 0 = save money, 1 = spend for comfort
  };
}

export interface ScoringWeights {
  calm: number;
  fast: number;
  comfort: number;
}

export interface DecisionContext {
  chosenArchetype: RouteArchetype;
  primaryReason: string;
  secondaryReasons: string[];
  tradeoffs: string[];
  wasOnlyOption: boolean;
  intentInfluence: string | null;
  noteInfluence: string | null;
}

// ============================================
// INTENT → WEIGHT MAPPING
// ============================================

export const INTENT_WEIGHTS: Record<TripIntent, ScoringWeights> = {
  work: { calm: 0.2, fast: 0.6, comfort: 0.2 },
  appointment: { calm: 0.2, fast: 0.5, comfort: 0.3 },
  time_sensitive: { calm: 0.1, fast: 0.7, comfort: 0.2 },
  leisure: { calm: 0.5, fast: 0.2, comfort: 0.3 },
  exploring: { calm: 0.6, fast: 0.1, comfort: 0.3 },
};

// ============================================
// NOTE KEYWORD PARSING
// ============================================

interface NoteModifiers {
  walkingPenalty: number;     // 0-1, higher = penalize walking more
  walkingPreference: number;  // 0-1, higher = user WANTS to walk
  rushPenalty: number;        // 0-1, higher = penalize rushed routes
  comfortBonus: number;       // 0-1, higher = prefer comfort
  arrivalBufferMinutes: number;
  keywords: string[];
}

export function parseNoteKeywords(note: string | undefined): NoteModifiers {
  if (!note) {
    return {
      walkingPenalty: 0,
      walkingPreference: 0,
      rushPenalty: 0,
      comfortBonus: 0,
      arrivalBufferMinutes: 0,
      keywords: [],
    };
  }

  const lower = note.toLowerCase();
  const keywords: string[] = [];
  let walkingPenalty = 0;
  let walkingPreference = 0;
  let rushPenalty = 0;
  let comfortBonus = 0;
  let arrivalBufferMinutes = 0;

  // USER WANTS TO WALK - key feature for leisure/exploration
  // Detect phrases like "want to walk", "take a walk", "stroll", "stretch legs"
  if (lower.includes("want to walk") || lower.includes("wanna walk") ||
      lower.includes("like to walk") || lower.includes("take a walk") ||
      lower.includes("lil walk") || lower.includes("little walk") ||
      lower.includes("short walk") || lower.includes("stroll") ||
      lower.includes("stretch") || lower.includes("enjoy the walk") ||
      lower.includes("walk around") || lower.includes("walk a bit") ||
      lower.includes("scenic") || lower.includes("explore on foot")) {
    keywords.push("wants_walk");
    walkingPreference += 0.7;
    rushPenalty += 0.2; // Don't rush if they want to walk
  }

  // Date/romantic context → calm + comfort, avoid rushing
  if (lower.includes("date") || lower.includes("romantic") || lower.includes("special")) {
    keywords.push("date");
    comfortBonus += 0.3;
    rushPenalty += 0.3;
    // Dates can include pleasant walks
    if (!keywords.includes("wants_walk")) {
      walkingPreference += 0.3;
    }
  }

  // Meeting/interview → fast + buffer
  if (lower.includes("meeting") || lower.includes("interview") || lower.includes("important")) {
    keywords.push("meeting");
    arrivalBufferMinutes += 10;
  }

  // Tired/fatigue → minimize walking heavily
  if (lower.includes("tired") || lower.includes("exhausted") || lower.includes("fatigue") ||
      lower.includes("don't want to walk") || lower.includes("no walking")) {
    keywords.push("tired");
    walkingPenalty += 0.5;
    walkingPreference = 0; // Override any walk preference
    comfortBonus += 0.2;
  }

  // Reservation/time constraint → arrival accuracy
  if (lower.includes("reservation") || lower.includes("booking") || lower.includes("at ")) {
    keywords.push("reservation");
    arrivalBufferMinutes += 5;
  }

  // Heavy luggage/bags → minimize walking
  if (lower.includes("luggage") || lower.includes("bags") || lower.includes("suitcase") ||
      lower.includes("heavy")) {
    keywords.push("luggage");
    walkingPenalty += 0.4;
    walkingPreference = 0; // Can't walk much with luggage
    comfortBonus += 0.2;
  }

  // Kids/children → prefer comfort and simplicity
  if (lower.includes("kid") || lower.includes("child") || lower.includes("family") ||
      lower.includes("stroller")) {
    keywords.push("family");
    walkingPenalty += 0.2;
    comfortBonus += 0.3;
  }

  // Hurry/rush → speed priority
  if (lower.includes("hurry") || lower.includes("rush") || lower.includes("urgent") ||
      lower.includes("late") || lower.includes("quick")) {
    keywords.push("hurry");
    rushPenalty = Math.max(0, rushPenalty - 0.3); // Actually want speed
    walkingPreference = 0; // No time for leisurely walks
  }

  return {
    walkingPenalty: Math.min(1, walkingPenalty),
    walkingPreference: Math.min(1, walkingPreference),
    rushPenalty: Math.min(1, rushPenalty),
    comfortBonus: Math.min(1, comfortBonus),
    arrivalBufferMinutes,
    keywords,
  };
}

// ============================================
// ROUTE SCORING
// ============================================

export function scoreRouteCandidate(
  mode: TravelMode,
  route: GoogleMapsRoute,
  context: ScoringContext
): RouteCandidate {
  const { cityProfile, weather, isNightTime, isLateNight } = context;

  // Extract raw metrics
  const durationMinutes = Math.ceil(route.duration.value / 60);
  const walkingSteps = route.steps.filter(s => s.travelMode === "WALKING");
  const walkingMinutes = walkingSteps.reduce((acc, s) => acc + Math.ceil(s.duration.value / 60), 0);
  const walkingMeters = walkingSteps.reduce((acc, s) => acc + s.distance.value, 0);
  const transitSteps = route.steps.filter(s => s.travelMode === "TRANSIT");
  const transferCount = Math.max(0, transitSteps.length - 1);
  const stopsCount = transitSteps.reduce((acc, s) => acc + (s.transitDetails?.numStops || 0), 0);

  // Check for complex stations
  const stationNames = transitSteps.map(s =>
    s.transitDetails?.departureStop.name || ""
  ).concat(transitSteps.map(s =>
    s.transitDetails?.arrivalStop.name || ""
  ));
  const hasComplexStation = stationNames.some(name =>
    cityProfile.complexStations.some(complex =>
      name.toLowerCase().includes(complex.toLowerCase())
    )
  );

  // Weather exposure (walking in bad weather)
  const isWeatherExposed = !weather.isOutdoorFriendly && (
    mode === "walking" || walkingMinutes > 10
  );

  const metrics = {
    durationMinutes,
    walkingMinutes,
    walkingMeters,
    transferCount,
    hasComplexStation,
    isWeatherExposed,
    stopsCount,
  };

  // Calculate dimension scores (0-100)
  const scores = {
    calm: calculateCalmScore(metrics, mode, isNightTime, cityProfile, isLateNight),
    fast: calculateFastScore(metrics),
    comfort: calculateComfortScore(metrics, mode, weather, isNightTime, isLateNight),
  };

  // Determine primary archetype
  const archetype = determineArchetype(scores);

  return {
    mode,
    archetype,
    route,
    scores,
    metrics,
    finalScore: 0, // Will be computed in selectBestRoute
  };
}

function calculateCalmScore(
  metrics: RouteCandidate["metrics"],
  mode: TravelMode,
  isNightTime: boolean,
  cityProfile: CityProfile,
  isLateNight: boolean = false
): number {
  let score = 100;

  // Penalize transfers heavily (each transfer is stressful)
  score -= metrics.transferCount * 15;

  // Penalize complex stations
  if (metrics.hasComplexStation) {
    score -= 20;
  }

  // Penalize excessive walking (>15 min is tiring)
  if (metrics.walkingMinutes > 15) {
    score -= (metrics.walkingMinutes - 15) * 2;
  }

  // Walking at night is stressful in some cities
  if (isNightTime && mode === "walking") {
    score -= 30 * (1 - cityProfile.nightReliability);
  }

  // Strong walking penalty after 22:00
  if (isLateNight && mode === "walking") {
    score -= 25;
  }

  // Transit at night can be unreliable
  if (isNightTime && mode === "transit") {
    score -= 20 * (1 - cityProfile.nightReliability);
  }

  // Driving at night is safer/calmer - contextual bonus only
  if (isNightTime && mode === "driving") {
    score += 10;
  }

  // NOTE: Removed unconditional +10 for driving.
  // Calm score should reflect cognitive load - driving in traffic is still stressful.

  return Math.max(0, Math.min(100, score));
}

function calculateFastScore(metrics: RouteCandidate["metrics"]): number {
  // Fastest possible is ~10 min, slowest we'd show is ~90 min
  // Score inversely proportional to duration
  const maxReasonableDuration = 90;
  const minDuration = 10;

  const normalized = Math.max(0, Math.min(1,
    1 - (metrics.durationMinutes - minDuration) / (maxReasonableDuration - minDuration)
  ));

  return Math.round(normalized * 100);
}

function calculateComfortScore(
  metrics: RouteCandidate["metrics"],
  mode: TravelMode,
  weather: ScoringContext["weather"],
  isNightTime: boolean,
  isLateNight: boolean = false
): number {
  let score = 100;

  // Walking in bad weather is uncomfortable
  if (!weather.isOutdoorFriendly) {
    score -= metrics.walkingMinutes * 3;
    // Climate-controlled vehicle is a comfort advantage in bad weather
    if (mode === "driving") {
      score += 15;
    }
  }

  // Excessive walking reduces comfort
  if (metrics.walkingMinutes > 10) {
    score -= (metrics.walkingMinutes - 10) * 1.5;
  }

  // Transfers reduce comfort (waiting, finding platforms)
  score -= metrics.transferCount * 10;

  // Night travel is less comfortable — amplified for late night
  if (isNightTime) {
    score -= isLateNight ? 20 : 10;
  }

  // Late night driving gets comfort boost
  if (isLateNight && mode === "driving") {
    score += 15;
  }

  // Extreme temperatures - driving provides climate control
  if (weather.temperature < 5 || weather.temperature > 30) {
    score -= metrics.walkingMinutes * 2;
    if (mode === "driving" && weather.isOutdoorFriendly) {
      // Only add bonus if not already added for bad weather
      score += 10;
    }
  }

  // NOTE: Removed unconditional +20 for driving.
  // Comfort bonus for driving now only applies when weather/temp justifies it.

  return Math.max(0, Math.min(100, score));
}

function determineArchetype(scores: RouteCandidate["scores"]): RouteArchetype {
  const { calm, fast, comfort } = scores;

  // Find which dimension this route is strongest in
  if (calm >= fast && calm >= comfort) return "calm";
  if (fast >= calm && fast >= comfort) return "fast";
  return "comfort";
}

// ============================================
// ROUTE SELECTION
// ============================================

export function selectBestRoute(
  candidates: RouteCandidate[],
  context: ScoringContext
): { selected: RouteCandidate; decision: DecisionContext } {
  if (candidates.length === 0) {
    throw new Error("No route candidates to select from");
  }

  if (candidates.length === 1) {
    const single = candidates[0];
    // Still describe the route characteristics even if it's the only option
    let primaryReason: string;

    // Check transfer count directly (more reliable than archetype for describing route)
    if (single.metrics.transferCount === 0 && single.mode !== "driving") {
      primaryReason = "a direct route with no transfers (the only option available)";
    } else if (single.metrics.transferCount === 1) {
      primaryReason = "a simple route with one transfer (the only option available)";
    } else if (single.mode === "driving") {
      primaryReason = "a door-to-door ride (the only option available)";
    } else {
      primaryReason = `a ${single.metrics.durationMinutes}-minute route (the only option available)`;
    }

    return {
      selected: single,
      decision: {
        chosenArchetype: single.archetype,
        primaryReason,
        secondaryReasons: [],
        tradeoffs: [],
        wasOnlyOption: true,
        intentInfluence: null,
        noteInfluence: null,
      },
    };
  }

  // Get base weights from intent
  const baseWeights = INTENT_WEIGHTS[context.intent] || INTENT_WEIGHTS.leisure;

  // Parse note modifiers
  const noteModifiers = parseNoteKeywords(context.userNote);

  // Adjust weights based on slider values
  let weights = { ...baseWeights };

  // calmVsFast slider: 0=calm, 100=fast
  const calmBias = (100 - context.calmVsFast) / 100; // 0-1, higher = prefer calm
  weights.calm += calmBias * 0.3;
  weights.fast += (1 - calmBias) * 0.3;

  // economyVsComfort slider: affects mode filtering more than weights
  // (handled separately)

  // Apply note modifiers
  if (noteModifiers.comfortBonus > 0) {
    weights.comfort += noteModifiers.comfortBonus * 0.2;
    weights.calm += noteModifiers.comfortBonus * 0.1;
  }
  if (noteModifiers.rushPenalty > 0) {
    weights.fast -= noteModifiers.rushPenalty * 0.2;
    weights.calm += noteModifiers.rushPenalty * 0.1;
  }
  if (noteModifiers.walkingPenalty > 0) {
    weights.comfort += noteModifiers.walkingPenalty * 0.2;
  }

  // Unfamiliar with city → boost calm (simplicity)
  if (context.unfamiliarWithCity) {
    weights.calm += 0.15;
  }

  // Apply learned preferences if available
  if (context.learnedPreferences) {
    const lp = context.learnedPreferences;

    // Adjust based on learned calm/quick bias
    // If user historically prefers calm (bias near 0), boost calm weight
    const calmAdjustment = (0.5 - lp.calmQuickBias) * 0.3; // -0.15 to +0.15
    weights.calm += calmAdjustment;
    weights.fast -= calmAdjustment;

    // Adjust based on learned save/spend bias
    // If user historically spends for comfort (bias near 1), boost comfort
    const comfortAdjustment = (lp.saveSpendBias - 0.5) * 0.2; // -0.1 to +0.1
    weights.comfort += comfortAdjustment;
  }

  // Normalize weights
  const total = weights.calm + weights.fast + weights.comfort;
  weights.calm /= total;
  weights.fast /= total;
  weights.comfort /= total;

  // Filter by economy preference BEFORE scoring
  let filteredCandidates = candidates;
  if (context.economyVsComfort <= 30) {
    // Budget mode: exclude driving if transit/walking available
    const nonDriving = candidates.filter(c => c.mode !== "driving");
    if (nonDriving.length > 0) {
      filteredCandidates = nonDriving;
    }
  }

  // Score each candidate
  for (const candidate of filteredCandidates) {
    candidate.finalScore =
      candidate.scores.calm * weights.calm +
      candidate.scores.fast * weights.fast +
      candidate.scores.comfort * weights.comfort;

    // Apply walking penalty from notes
    if (noteModifiers.walkingPenalty > 0) {
      const walkingPenalty = (candidate.metrics.walkingMinutes / 30) * noteModifiers.walkingPenalty * 20;
      candidate.finalScore -= walkingPenalty;
    }

    // Apply learned preference penalties
    if (context.learnedPreferences) {
      const lp = context.learnedPreferences;

      // Penalize routes that exceed user's learned walking tolerance
      if (candidate.metrics.walkingMinutes > lp.walkingToleranceMin * 10) {
        const excess = candidate.metrics.walkingMinutes - (lp.walkingToleranceMin * 10);
        candidate.finalScore -= excess * 0.5;
      }

      // Penalize routes that exceed user's transfer tolerance
      if (candidate.metrics.transferCount > lp.transferTolerance) {
        const excessTransfers = candidate.metrics.transferCount - lp.transferTolerance;
        candidate.finalScore -= excessTransfers * 8;
      }
    }
  }

  // Sort by final score
  filteredCandidates.sort((a, b) => b.finalScore - a.finalScore);

  const selected = filteredCandidates[0];
  const runnerUp = filteredCandidates[1];

  // Build decision context
  const decision = buildDecisionContext(selected, runnerUp, context, noteModifiers, weights);

  return { selected, decision };
}

function buildDecisionContext(
  selected: RouteCandidate,
  runnerUp: RouteCandidate | undefined,
  context: ScoringContext,
  noteModifiers: NoteModifiers,
  weights: ScoringWeights
): DecisionContext {
  const primaryReasons: string[] = [];
  const secondaryReasons: string[] = [];
  const tradeoffs: string[] = [];

  // Explain based on archetype
  if (selected.archetype === "calm") {
    if (selected.metrics.transferCount === 0) {
      primaryReasons.push("a direct route with no transfers");
    } else if (selected.metrics.transferCount === 1) {
      primaryReasons.push("a simple route with just one transfer");
    } else {
      primaryReasons.push("a route that minimizes complexity");
    }
  } else if (selected.archetype === "fast") {
    primaryReasons.push(`the fastest option at ${selected.metrics.durationMinutes} minutes`);
  } else {
    if (selected.mode === "driving") {
      primaryReasons.push("a comfortable door-to-door ride");
    } else {
      primaryReasons.push("a route that minimizes walking and exposure");
    }
  }

  // Weather influence
  if (!context.weather.isOutdoorFriendly && selected.metrics.walkingMinutes < 10) {
    secondaryReasons.push(`keeps you dry with only ${selected.metrics.walkingMinutes} minutes outdoors`);
  }

  // Night time influence
  if (context.isNightTime && selected.mode === "driving") {
    secondaryReasons.push("safer for late-night travel");
  }

  // Tradeoffs if there was a faster option we didn't pick
  if (runnerUp && runnerUp.archetype === "fast" && selected.archetype !== "fast") {
    const timeDiff = runnerUp.metrics.durationMinutes - selected.metrics.durationMinutes;
    if (timeDiff < -5) {
      tradeoffs.push(`There's a faster route (${Math.abs(timeDiff)} min quicker) but it involves more transfers.`);
    }
  }

  // Intent influence
  let intentInfluence: string | null = null;
  if (context.intent === "work" || context.intent === "appointment") {
    intentInfluence = "Since this is for work/an appointment, I prioritized reliability.";
  } else if (context.intent === "leisure" || context.intent === "exploring") {
    intentInfluence = "Since you're not in a rush, I chose a calmer route.";
  } else if (context.intent === "time_sensitive") {
    intentInfluence = "Given the time pressure, I focused on speed.";
  }

  // Note influence
  let noteInfluence: string | null = null;
  if (noteModifiers.keywords.includes("date")) {
    noteInfluence = "Since it's a date, I picked a route where you'll arrive relaxed.";
  } else if (noteModifiers.keywords.includes("tired")) {
    noteInfluence = "Since you're tired, I minimized walking.";
  } else if (noteModifiers.keywords.includes("meeting")) {
    noteInfluence = "For your meeting, I added buffer time for a comfortable arrival.";
  } else if (noteModifiers.keywords.includes("luggage")) {
    noteInfluence = "With luggage, I minimized stairs and transfers.";
  }

  return {
    chosenArchetype: selected.archetype,
    primaryReason: primaryReasons[0] || "the best balance for your trip",
    secondaryReasons,
    tradeoffs,
    wasOnlyOption: false,
    intentInfluence,
    noteInfluence,
  };
}

// ============================================
// EXPLANATION GENERATION
// ============================================

export function generateExplanation(decision: DecisionContext): string {
  if (decision.wasOnlyOption) {
    // Still describe route characteristics if available
    if (decision.primaryReason.includes("direct") || decision.primaryReason.includes("transfer")) {
      return `This is ${decision.primaryReason}.`;
    }
    return "This is the only reliable route available right now.";
  }

  let explanation = `I chose ${decision.primaryReason}`;

  if (decision.secondaryReasons.length > 0) {
    explanation += ` — ${decision.secondaryReasons[0]}`;
  }

  explanation += ".";

  // Add intent/note context if it influenced the decision
  if (decision.noteInfluence) {
    explanation += ` ${decision.noteInfluence}`;
  } else if (decision.intentInfluence) {
    explanation += ` ${decision.intentInfluence}`;
  }

  return explanation;
}

// ============================================
// STRESS SCORE CALCULATION
// ============================================

export function calculateStressScore(candidate: RouteCandidate, context: ScoringContext): number {
  let stress = 0.2; // Base stress

  // Transfers add stress
  stress += candidate.metrics.transferCount * 0.12;

  // Complex stations add stress
  if (candidate.metrics.hasComplexStation) {
    stress += 0.15;
  }

  // Excessive walking
  if (candidate.metrics.walkingMinutes > 15) {
    stress += (candidate.metrics.walkingMinutes - 15) * 0.015;
  }

  // Weather exposure
  if (candidate.metrics.isWeatherExposed) {
    stress += 0.15;
  }

  // Night time
  if (context.isNightTime) {
    stress += 0.1;
  }

  // Rush hour
  if (context.isRushHour && candidate.mode === "transit") {
    stress += 0.1;
  }

  // Unfamiliar city
  if (context.unfamiliarWithCity) {
    stress += 0.1;
  }

  // Driving is generally less stressful (no navigation)
  if (candidate.mode === "driving") {
    stress -= 0.1;
  }

  return Math.max(0, Math.min(1, stress));
}

// ============================================
// ROUTE VALIDATION
// ============================================

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
}

export function validateRoute(candidate: RouteCandidate): ValidationResult {
  const issues: string[] = [];
  let confidence = 0.9;

  const steps = candidate.route.steps;

  // Check for empty route
  if (steps.length === 0) {
    return { isValid: false, confidence: 0, issues: ["Route has no steps"] };
  }

  // Validate step sequence makes sense
  for (let i = 0; i < steps.length - 1; i++) {
    const current = steps[i];
    const next = steps[i + 1];

    // Transit should be preceded/followed by walking (getting to/from station)
    // This is a soft check - some systems have connected transfers
    if (current.travelMode === "TRANSIT" && next.travelMode === "TRANSIT") {
      // Two transit steps in a row is a transfer - valid but note it
      confidence -= 0.05;
    }
  }

  // Check for unreasonable duration
  if (candidate.metrics.durationMinutes > 180) {
    issues.push("Route is unusually long (over 3 hours)");
    confidence -= 0.2;
  }

  // Check for excessive walking
  if (candidate.metrics.walkingMinutes > 60) {
    issues.push("Route involves over an hour of walking");
    confidence -= 0.1;
  }

  // Check for missing transit details on transit steps
  const transitSteps = steps.filter(s => s.travelMode === "TRANSIT");
  for (const step of transitSteps) {
    if (!step.transitDetails) {
      issues.push("Missing transit details for a transit step");
      confidence -= 0.1;
    }
  }

  return {
    isValid: issues.length === 0 || confidence > 0.5,
    confidence: Math.max(0, confidence),
    issues,
  };
}
