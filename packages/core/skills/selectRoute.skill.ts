/**
 * SELECT ROUTE SKILL — LLM-Powered Route Selection
 *
 * Uses LLM to intelligently select the best route from scored candidates.
 * Falls back to highest-scoring candidate if LLM is unavailable.
 *
 * This skill is called AFTER scoreCandidates to make the final decision.
 */

import { z } from "zod";
import type { Skill, SkillContext } from "./types";
import type { RouteCandidate } from "./scoreCandidates.skill";

// ============================================
// SCHEMAS
// ============================================

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

const SelectRouteInputSchema = z.object({
  candidates: z.array(z.object({
    id: z.string(),
    mode: z.enum(["transit", "walking", "driving", "bicycling"]),
    durationMinutes: z.number(),
    walkingMinutes: z.number(),
    transferCount: z.number(),
    hasUnderground: z.boolean(),
    isOutdoorRoute: z.boolean(),
    estimatedCost: z.number().optional(),
    steps: z.array(z.any()),
  })),
  scoredCandidates: z.array(ScoredCandidateSchema),
  tripIntent: z.enum(["work", "leisure", "appointment", "time_sensitive", "exploring"]).optional(),
  userNote: z.string().optional(),
  weather: z.object({
    isOutdoorFriendly: z.boolean(),
    temperature: z.number(),
    condition: z.string().optional(),
  }).optional(),
  cityName: z.string(),
  isRushHour: z.boolean().optional(),
  isNightTime: z.boolean().optional(),
  unfamiliarWithCity: z.boolean().optional(),
});

const SelectRouteOutputSchema = z.object({
  selectedId: z.string(),
  reasoning: z.string(),
  confidenceScore: z.number().min(0).max(1),
  keyFactors: z.array(z.string()),
  tradeoff: z.string().optional(),
  usedLLM: z.boolean(),
});

export type SelectRouteInput = z.infer<typeof SelectRouteInputSchema>;
export type SelectRouteOutput = z.infer<typeof SelectRouteOutputSchema>;

// ============================================
// LLM RESPONSE SCHEMA
// ============================================

const LLMResponseSchema = z.object({
  selectedIndex: z.number().int().min(0),
  reasoning: z.string(),
  confidenceScore: z.number().min(0).max(1),
  keyFactors: z.array(z.string()),
  tradeoff: z.string().optional(),
});

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `You are an expert mobility advisor. Your task is to select the BEST route option for the user based on their specific context.

IMPORTANT: Consider ALL factors, not just speed. Different situations need different priorities:
- "tired" in user note → STRONGLY prefer minimal walking
- Date or special occasion → Prefer comfort and calm over speed
- Time-sensitive/work → Speed matters more
- Bad weather → Avoid outdoor walking
- Unfamiliar with city → Prefer simpler routes with fewer transfers
- Rush hour → Factor in crowding on transit
- Night time → Consider safety

Respond with ONLY a valid JSON object:
{
  "selectedIndex": <0-based index of chosen route>,
  "reasoning": "<2-3 sentences explaining your choice>",
  "confidenceScore": <0.0 to 1.0>,
  "keyFactors": ["factor1", "factor2"],
  "tradeoff": "<optional: what you're sacrificing and why it's worth it>"
}`;

// ============================================
// PROMPT BUILDER
// ============================================

function buildPrompt(input: SelectRouteInput): string {
  const candidateList = input.candidates.map((c, i) => {
    const scored = input.scoredCandidates.find(s => s.id === c.id);
    const violation = scored?.violatesConstraints ? " [VIOLATES CONSTRAINTS]" : "";
    return `Option ${i}: ${c.mode.toUpperCase()}${violation}
  - Duration: ${c.durationMinutes} min
  - Walking: ${c.walkingMinutes} min
  - Transfers: ${c.transferCount}
  - Cost: ${c.estimatedCost ? `$${c.estimatedCost}` : "Unknown"}
  - Scores: calm=${scored?.breakdown.calm || 0}, fast=${scored?.breakdown.fast || 0}, comfort=${scored?.breakdown.comfort || 0}`;
  }).join("\n\n");

  const contextInfo = [
    `Trip purpose: ${input.tripIntent || "general"}`,
    input.userNote ? `User says: "${input.userNote}"` : null,
    input.weather ? `Weather: ${input.weather.condition || "clear"}, ${input.weather.temperature}°C, ${input.weather.isOutdoorFriendly ? "nice outside" : "not great outside"}` : null,
    input.isRushHour ? "Rush hour (transit may be crowded)" : null,
    input.isNightTime ? "Night time" : null,
    input.unfamiliarWithCity ? "User is unfamiliar with this city" : null,
    `City: ${input.cityName}`,
  ].filter(Boolean).join("\n");

  return `ROUTE OPTIONS:
${candidateList}

USER CONTEXT:
${contextInfo}

Select the best option for this specific user and explain why.`;
}

// ============================================
// FALLBACK SELECTION
// ============================================

function selectFallback(input: SelectRouteInput): SelectRouteOutput {
  // Find viable candidates (not violating constraints)
  const viable = input.scoredCandidates.filter(s => !s.violatesConstraints);
  const pool = viable.length > 0 ? viable : input.scoredCandidates;

  // Sort by score
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const best = sorted[0];

  // Find the candidate details
  const candidate = input.candidates.find(c => c.id === best.id);
  const keyFactors: string[] = [];

  // Determine key factors based on what made it score well
  if (best.breakdown.calm >= best.breakdown.fast && best.breakdown.calm >= best.breakdown.comfort) {
    keyFactors.push("calm route");
  }
  if (best.breakdown.fast >= best.breakdown.calm && best.breakdown.fast >= best.breakdown.comfort) {
    keyFactors.push("fast option");
  }
  if (candidate?.transferCount === 0) {
    keyFactors.push("no transfers");
  }
  if (candidate?.walkingMinutes && candidate.walkingMinutes < 10) {
    keyFactors.push("minimal walking");
  }

  // Build reasoning
  let reasoning = `Selected ${candidate?.mode || "this route"} based on scoring.`;
  if (keyFactors.length > 0) {
    reasoning = `Selected ${candidate?.mode || "this route"} because it offers ${keyFactors.join(" and ")}.`;
  }

  return {
    selectedId: best.id,
    reasoning,
    confidenceScore: 0.7, // Lower confidence for fallback
    keyFactors: keyFactors.slice(0, 3),
    usedLLM: false,
  };
}

// ============================================
// SKILL DEFINITION
// ============================================

export const selectRouteSkill: Skill<SelectRouteInput, SelectRouteOutput> = {
  name: "selectRoute",

  inputSchema: SelectRouteInputSchema,
  outputSchema: SelectRouteOutputSchema,

  async run(ctx, input) {
    const notes: string[] = [];

    // Handle single candidate
    if (input.candidates.length <= 1) {
      notes.push("Only one candidate, no decision needed");
      return {
        output: {
          selectedId: input.candidates[0]?.id || "",
          reasoning: "This is the only available route.",
          confidenceScore: 1.0,
          keyFactors: ["only option"],
          usedLLM: false,
        },
        meta: { ok: true, usedFallback: false, notes },
      };
    }

    // Try LLM if available
    if (ctx.flags.useLLM && ctx.llm && ctx.llm.isAvailable()) {
      try {
        const prompt = buildPrompt(input);
        notes.push("Attempting LLM route selection");

        const llmResponse = await ctx.llm.generate(prompt, LLMResponseSchema);

        // Validate the selected index
        if (llmResponse.selectedIndex >= input.candidates.length) {
          throw new Error(`Invalid index: ${llmResponse.selectedIndex}`);
        }

        const selectedCandidate = input.candidates[llmResponse.selectedIndex];

        notes.push(`LLM selected: ${selectedCandidate.id}`);

        return {
          output: {
            selectedId: selectedCandidate.id,
            reasoning: llmResponse.reasoning,
            confidenceScore: llmResponse.confidenceScore,
            keyFactors: llmResponse.keyFactors,
            tradeoff: llmResponse.tradeoff,
            usedLLM: true,
          },
          meta: { ok: true, usedFallback: false, notes },
        };
      } catch (error) {
        notes.push(`LLM failed: ${error instanceof Error ? error.message : "unknown"}`);
        ctx.logger.warn("LLM route selection failed, using fallback", { error });
      }
    } else {
      notes.push("LLM not available, using scoring fallback");
    }

    // Fallback to scoring-based selection
    const fallback = selectFallback(input);
    notes.push(`Fallback selected: ${fallback.selectedId}`);

    return {
      output: fallback,
      meta: { ok: true, usedFallback: true, notes },
    };
  },

  fallback(input) {
    return selectFallback(input);
  },
};
