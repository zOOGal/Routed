/**
 * SCORE CANDIDATES SKILL
 *
 * Scores route candidates based on:
 * - Hard constraints (can VETO candidates)
 * - Soft biases (calm/fast/comfort/cost)
 * - Trip intent (different intents produce different winners)
 * - Weather and city context
 *
 * DETERMINISTIC: Pure scoring logic, no LLM involvement.
 */

import { z } from "zod";
import type { Skill, HardConstraints, SoftBiases } from "./types";
import { TripIntentSchema, HardConstraintsSchema, SoftBiasesSchema } from "./types";
import type { CityProfile } from "@shared/schema";

// ============================================
// SCHEMAS
// ============================================

const RouteCandidateSchema = z.object({
  id: z.string(),
  mode: z.enum(["transit", "walking", "driving", "bicycling"]),
  durationMinutes: z.number(),
  walkingMinutes: z.number(),
  transferCount: z.number(),
  hasUnderground: z.boolean(),
  isOutdoorRoute: z.boolean(),
  estimatedCost: z.number().optional(),
  steps: z.array(z.object({
    type: z.enum(["walk", "transit", "rideshare", "bike"]),
    duration: z.number(),
    distance: z.number().optional(),
    line: z.string().optional(),
  })),
});

const WeatherContextSchema = z.object({
  isOutdoorFriendly: z.boolean(),
  temperature: z.number(),
  condition: z.string().optional(),
});

const ScoreCandidatesInputSchema = z.object({
  candidates: z.array(RouteCandidateSchema),
  tripIntent: TripIntentSchema.optional(),
  constraints: HardConstraintsSchema,
  biases: SoftBiasesSchema,
  weather: WeatherContextSchema.optional(),
  cityCode: z.string(),
  isRushHour: z.boolean().optional(),
  isNightTime: z.boolean().optional(),
});

const ScoredCandidateSchema = z.object({
  id: z.string(),
  score: z.number(),
  breakdown: z.object({
    calm: z.number(),
    fast: z.number(),
    comfort: z.number(),
    cost: z.number(),
    total: z.number(),
  }),
  violatesConstraints: z.boolean(),
  violations: z.array(z.string()),
});

const ScoreCandidatesOutputSchema = z.object({
  scoredCandidates: z.array(ScoredCandidateSchema),
  bestCandidateId: z.string().nullable(),
  totalCandidates: z.number(),
  viableCandidates: z.number(),
});

export type RouteCandidate = z.infer<typeof RouteCandidateSchema>;
export type ScoreCandidatesInput = z.infer<typeof ScoreCandidatesInputSchema>;
export type ScoreCandidatesOutput = z.infer<typeof ScoreCandidatesOutputSchema>;
export type ScoredCandidate = z.infer<typeof ScoredCandidateSchema>;

// ============================================
// INTENT → WEIGHT MAPPING
// ============================================

type TripIntent = z.infer<typeof TripIntentSchema>;

const INTENT_WEIGHTS: Record<TripIntent, { calm: number; fast: number; comfort: number; cost: number }> = {
  work: { calm: 0.15, fast: 0.5, comfort: 0.2, cost: 0.15 },
  appointment: { calm: 0.2, fast: 0.45, comfort: 0.25, cost: 0.1 },
  time_sensitive: { calm: 0.1, fast: 0.6, comfort: 0.15, cost: 0.15 },
  leisure: { calm: 0.35, fast: 0.15, comfort: 0.35, cost: 0.15 },
  exploring: { calm: 0.4, fast: 0.1, comfort: 0.3, cost: 0.2 },
};

const DEFAULT_WEIGHTS = { calm: 0.25, fast: 0.25, comfort: 0.25, cost: 0.25 };

// ============================================
// CONSTRAINT CHECKING
// ============================================

function checkConstraints(
  candidate: RouteCandidate,
  constraints: HardConstraints
): { violates: boolean; violations: string[] } {
  const violations: string[] = [];

  // Check avoidUnderground
  if (constraints.avoidUnderground && candidate.hasUnderground) {
    violations.push("Route uses underground transit (constraint: avoidUnderground)");
  }

  // Check preferOutdoors
  if (constraints.preferOutdoors && !candidate.isOutdoorRoute) {
    violations.push("Route is not outdoor-friendly (constraint: preferOutdoors)");
  }

  // Check minContinuousWalkMin
  if (constraints.minContinuousWalkMin !== undefined) {
    // Find longest continuous walk segment
    const walkSegments = candidate.steps.filter(s => s.type === "walk");
    const maxWalkSegment = walkSegments.reduce((max, s) => Math.max(max, s.duration), 0);
    if (maxWalkSegment < constraints.minContinuousWalkMin) {
      violations.push(
        `Longest walk segment (${maxWalkSegment}min) is shorter than required (${constraints.minContinuousWalkMin}min)`
      );
    }
  }

  // Check maxWalkMin
  if (constraints.maxWalkMin !== undefined && candidate.walkingMinutes > constraints.maxWalkMin) {
    violations.push(
      `Total walking (${candidate.walkingMinutes}min) exceeds maximum (${constraints.maxWalkMin}min)`
    );
  }

  // Check requireAccessible (simplified - check for underground/stairs)
  if (constraints.requireAccessible && candidate.hasUnderground && candidate.transferCount > 1) {
    violations.push("Route may have accessibility issues (multiple underground transfers)");
  }

  return {
    violates: violations.length > 0,
    violations,
  };
}

// ============================================
// DIMENSION SCORING
// ============================================

function scoreCalmDimension(candidate: RouteCandidate, isNightTime?: boolean): number {
  let score = 100;

  // Transfers are stressful
  score -= candidate.transferCount * 15;

  // Underground can be confusing
  if (candidate.hasUnderground) {
    score -= 10;
  }

  // Long walks are tiring
  if (candidate.walkingMinutes > 15) {
    score -= (candidate.walkingMinutes - 15) * 1.5;
  }

  // Night travel is stressful
  if (isNightTime) {
    score -= 15;
    // Driving at night is safer/calmer than walking/transit - contextual bonus
    if (candidate.mode === "driving") {
      score += 10;
    }
  }

  // NOTE: Removed unconditional +15 for driving. 
  // Rideshare shouldn't win just because "someone else drives".
  // Calm score is about cognitive load and stress - driving still has traffic stress.

  return Math.max(0, Math.min(100, score));
}

function scoreFastDimension(candidate: RouteCandidate): number {
  // Fastest reasonable trip: 10 min, slowest we'd show: 90 min
  const normalized = 1 - Math.max(0, Math.min(1, (candidate.durationMinutes - 10) / 80));
  return Math.round(normalized * 100);
}

function scoreComfortDimension(
  candidate: RouteCandidate,
  weather?: { isOutdoorFriendly: boolean; temperature: number }
): number {
  let score = 100;

  // Walking in bad weather - penalize outdoor modes
  if (weather && !weather.isOutdoorFriendly) {
    score -= candidate.walkingMinutes * 2.5;
    // Climate-controlled vehicle is a comfort advantage in bad weather
    if (candidate.mode === "driving") {
      score += 15;
    }
  }

  // Extreme temperatures - penalize outdoor exposure
  if (weather && (weather.temperature < 5 || weather.temperature > 30)) {
    score -= candidate.walkingMinutes * 2;
    // Climate-controlled vehicle is a comfort advantage in extreme temps
    if (candidate.mode === "driving" && !weather.isOutdoorFriendly) {
      // Bonus already applied above, don't double-count
    } else if (candidate.mode === "driving") {
      score += 10;
    }
  }

  // Transfers reduce comfort
  score -= candidate.transferCount * 12;

  // Long walks reduce comfort
  if (candidate.walkingMinutes > 10) {
    score -= (candidate.walkingMinutes - 10) * 1.5;
  }

  // NOTE: Removed unconditional +20 for driving.
  // Rideshare comfort bonus now ONLY applies when weather/temperature justifies it.
  // In nice weather, transit can be just as comfortable.

  return Math.max(0, Math.min(100, score));
}

function scoreCostDimension(candidate: RouteCandidate): number {
  // No cost info = assume moderate
  if (candidate.estimatedCost === undefined) {
    return 50;
  }

  // Walking is free
  if (candidate.mode === "walking") {
    return 100;
  }

  // Transit is cheap (~$3)
  if (candidate.mode === "transit" && candidate.estimatedCost <= 5) {
    return 85;
  }

  // Driving can be expensive
  if (candidate.mode === "driving") {
    // Scale: $5 = 80, $30 = 30
    const costScore = Math.max(30, 95 - candidate.estimatedCost * 2);
    return Math.min(100, costScore);
  }

  return 50;
}

// ============================================
// MAIN SCORING LOGIC
// ============================================

function scoreCandidate(
  candidate: RouteCandidate,
  constraints: HardConstraints,
  biases: SoftBiases,
  weights: { calm: number; fast: number; comfort: number; cost: number },
  weather?: { isOutdoorFriendly: boolean; temperature: number },
  isNightTime?: boolean
): ScoredCandidate {
  // Check constraints first
  const constraintCheck = checkConstraints(candidate, constraints);

  // Calculate dimension scores
  const calmScore = scoreCalmDimension(candidate, isNightTime);
  const fastScore = scoreFastDimension(candidate);
  const comfortScore = scoreComfortDimension(candidate, weather);
  const costScore = scoreCostDimension(candidate);

  // Apply biases (biases shift the score, not replace it)
  const biasedCalm = calmScore * (1 + (biases.calm - 0.5) * 0.3);
  const biasedFast = fastScore * (1 + (biases.fast - 0.5) * 0.3);
  const biasedComfort = comfortScore * (1 + (biases.comfort - 0.5) * 0.3);
  const biasedCost = costScore * (1 + (biases.cost - 0.5) * 0.3);

  // Calculate weighted total
  const total =
    biasedCalm * weights.calm +
    biasedFast * weights.fast +
    biasedComfort * weights.comfort +
    biasedCost * weights.cost;

  // If violates constraints, heavily penalize
  const finalScore = constraintCheck.violates ? total * 0.1 : total;

  return {
    id: candidate.id,
    score: Math.round(finalScore * 100) / 100,
    breakdown: {
      calm: Math.round(calmScore),
      fast: Math.round(fastScore),
      comfort: Math.round(comfortScore),
      cost: Math.round(costScore),
      total: Math.round(total),
    },
    violatesConstraints: constraintCheck.violates,
    violations: constraintCheck.violations,
  };
}

// ============================================
// SKILL DEFINITION
// ============================================

export const scoreCandidatesSkill: Skill<ScoreCandidatesInput, ScoreCandidatesOutput> = {
  name: "scoreCandidates",

  inputSchema: ScoreCandidatesInputSchema,
  outputSchema: ScoreCandidatesOutputSchema,

  async run(ctx, input) {
    const notes: string[] = [];

    if (input.candidates.length === 0) {
      notes.push("No candidates to score");
      return {
        output: {
          scoredCandidates: [],
          bestCandidateId: null,
          totalCandidates: 0,
          viableCandidates: 0,
        },
        meta: { ok: true, usedFallback: false, notes },
      };
    }

    // Get weights from intent
    const weights = input.tripIntent
      ? INTENT_WEIGHTS[input.tripIntent]
      : DEFAULT_WEIGHTS;

    notes.push(`Using weights for intent "${input.tripIntent || "default"}": ${JSON.stringify(weights)}`);

    // Score each candidate
    const scoredCandidates = input.candidates.map((candidate) =>
      scoreCandidate(
        candidate,
        input.constraints,
        input.biases,
        weights,
        input.weather,
        input.isNightTime
      )
    );

    // Sort by score (descending)
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Count viable candidates
    const viableCandidates = scoredCandidates.filter((c) => !c.violatesConstraints);

    notes.push(
      `Scored ${input.candidates.length} candidates, ${viableCandidates.length} viable`
    );

    // Best candidate is highest scoring viable, or highest overall if none viable
    const bestCandidate =
      viableCandidates.length > 0 ? viableCandidates[0] : scoredCandidates[0];

    if (bestCandidate) {
      notes.push(
        `Best candidate: ${bestCandidate.id} (score: ${bestCandidate.score})`
      );
    }

    return {
      output: {
        scoredCandidates,
        bestCandidateId: bestCandidate?.id || null,
        totalCandidates: input.candidates.length,
        viableCandidates: viableCandidates.length,
      },
      meta: {
        ok: true,
        usedFallback: false,
        notes,
      },
    };
  },

  fallback(input) {
    // Return candidates with neutral scores
    return {
      scoredCandidates: input.candidates.map((c) => ({
        id: c.id,
        score: 50,
        breakdown: { calm: 50, fast: 50, comfort: 50, cost: 50, total: 50 },
        violatesConstraints: false,
        violations: [],
      })),
      bestCandidateId: input.candidates[0]?.id || null,
      totalCandidates: input.candidates.length,
      viableCandidates: input.candidates.length,
    };
  },
};
