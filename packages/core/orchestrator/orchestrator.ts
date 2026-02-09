/**
 * ROUTED ORCHESTRATOR
 *
 * Runs the skill pipeline in order:
 * 1. ResolvePlaces
 * 2. DetectCityMismatch (early return if mismatch)
 * 3. GetWeather (may be mocked)
 * 4. GetVenueInfo (may be mocked)
 * 5. GenerateRouteCandidates (Directions API or mock)
 * 6. ParseNoteToConstraints
 * 7. ScoreCandidates (deterministic)
 * 8. ChoosePlan (deterministic)
 * 9. BuildSteps
 * 10. DepthLayer (LLM-enhanced phrasing + insights with fallback)
 *
 * Each skill is logged with timing and fallback usage.
 * LLM usage is tracked in debug.llm field.
 */

import { z } from "zod";
import type { SkillContext, SkillResultMeta } from "../skills/types";
import { runSkill } from "../skills/types";
import { resolvePlacesSkill } from "../skills/resolvePlaces.skill";
import { detectCityMismatchSkill } from "../skills/detectCityMismatch.skill";
import { parseNoteToConstraintsSkill } from "../skills/parseNoteToConstraints.skill";
import { scoreCandidatesSkill, type RouteCandidate } from "../skills/scoreCandidates.skill";
import { selectRouteSkill } from "../skills/selectRoute.skill";
import type { LLMClient } from "../llm/client";
import type {
  OrchestratorInput,
  OrchestratorOutput,
  DebugOutput,
  RouteStep,
  ChosenPlan,
  DepthLayerOutput,
  LLMDebugInfo,
} from "./schemas";
import {
  profileToScoringBiases,
  generateMemoryInsight,
  shouldShowMemoryCallback,
  calculateConfidence,
  type UserProfile,
  type ScoringBiases,
} from "../memory";

// ============================================
// ORCHESTRATOR CONTEXT BUILDER
// ============================================

export interface OrchestratorConfig {
  debugMode?: boolean;
  useLLM?: boolean;
  mockExternalCalls?: boolean;
}

/**
 * Create a skill context with the necessary dependencies
 */
export function createSkillContext(
  config: OrchestratorConfig,
  deps: {
    getCityProfile: SkillContext["getCityProfile"];
    getWeather: SkillContext["getWeather"];
    getVenueInfo: SkillContext["getVenueInfo"];
    llm: SkillContext["llm"];
    userId?: string;
  }
): SkillContext {
  return {
    logger: {
      info: (msg, data) => config.debugMode && console.log(`[INFO] ${msg}`, data || ""),
      warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ""),
      error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ""),
      debug: (msg, data) => config.debugMode && console.log(`[DEBUG] ${msg}`, data || ""),
    },
    now: new Date(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    getCityProfile: deps.getCityProfile,
    getWeather: deps.getWeather,
    getVenueInfo: deps.getVenueInfo,
    llm: deps.llm,
    flags: {
      debugMode: config.debugMode || false,
      useLLM: config.useLLM ?? true,
      mockExternalCalls: config.mockExternalCalls || false,
    },
    userId: deps.userId,
  };
}

// ============================================
// SKILL RESULT COLLECTOR
// ============================================

function metaToDebugFormat(meta: SkillResultMeta) {
  return {
    skillName: meta.skillName,
    startedAt: meta.startedAt.toISOString(),
    endedAt: meta.endedAt.toISOString(),
    durationMs: meta.durationMs,
    ok: meta.ok,
    usedFallback: meta.usedFallback,
    error: meta.error,
    notes: meta.notes,
  };
}

// ============================================
// MOCK DATA GENERATORS (for testing/development)
// ============================================

function generateMockCandidates(
  origin: string | null,
  destination: string,
  cityCode: string
): RouteCandidate[] {
  // Generate realistic mock candidates
  return [
    {
      id: "transit-direct",
      mode: "transit",
      durationMinutes: 25,
      walkingMinutes: 8,
      transferCount: 0,
      hasUnderground: true,
      isOutdoorRoute: false,
      estimatedCost: 2.9,
      steps: [
        { type: "walk", duration: 4, distance: 300 },
        { type: "transit", duration: 17, line: "A" },
        { type: "walk", duration: 4, distance: 350 },
      ],
    },
    {
      id: "transit-1-transfer",
      mode: "transit",
      durationMinutes: 22,
      walkingMinutes: 6,
      transferCount: 1,
      hasUnderground: true,
      isOutdoorRoute: false,
      estimatedCost: 2.9,
      steps: [
        { type: "walk", duration: 3, distance: 200 },
        { type: "transit", duration: 10, line: "B" },
        { type: "transit", duration: 6, line: "C" },
        { type: "walk", duration: 3, distance: 250 },
      ],
    },
    {
      id: "walking",
      mode: "walking",
      durationMinutes: 35,
      walkingMinutes: 35,
      transferCount: 0,
      hasUnderground: false,
      isOutdoorRoute: true,
      estimatedCost: 0,
      steps: [{ type: "walk", duration: 35, distance: 2800 }],
    },
    {
      id: "rideshare",
      mode: "driving",
      durationMinutes: 18,
      walkingMinutes: 2,
      transferCount: 0,
      hasUnderground: false,
      isOutdoorRoute: false,
      estimatedCost: 15,
      steps: [
        { type: "walk", duration: 1, distance: 50 },
        { type: "rideshare", duration: 16 },
        { type: "walk", duration: 1, distance: 50 },
      ],
    },
  ];
}

// ============================================
// DEPTH LAYER SCHEMA (for LLM validation)
// ============================================

const DepthLayerSchema = z.object({
  agentPresenceLine: z.string().max(150),
  tripFramingLine: z.string().max(250),
  contextualInsights: z.array(z.string().max(200)).max(4),
  memoryCallbackLine: z.string().optional(),
  responsibilityLine: z.string().max(150),
});

// ============================================
// DEPTH LAYER GENERATION (with LLM enhancement)
// ============================================

interface DepthLayerContext {
  plan: ChosenPlan;
  steps: RouteStep[];
  constraints: { reasonTags: string[] };
  weather?: { isOutdoorFriendly: boolean; temperature: number; condition?: string };
  isRushHour?: boolean;
  isNightTime?: boolean;
  userNote?: string;
  intent?: string;
  origin?: string;
  destination?: string;
}

/**
 * Generate deterministic base output (always works)
 */
function generateDeterministicDepthLayer(ctx: DepthLayerContext): DepthLayerOutput {
  const { plan, steps, constraints, weather, isRushHour, isNightTime } = ctx;

  // Agent presence line - what the agent is aware of
  let agentPresenceLine = "Here's how to get there.";
  if (ctx.userNote) {
    const note = ctx.userNote.toLowerCase();
    if (note.includes("tired") || note.includes("exhausted")) {
      agentPresenceLine = "Keeping it easy for you.";
    } else if (note.includes("date") || note.includes("romantic")) {
      agentPresenceLine = "Found a relaxed way there.";
    } else if (note.includes("hurry") || note.includes("rush")) {
      agentPresenceLine = "Getting you there fast.";
    } else if (note.includes("dog")) {
      agentPresenceLine = "Found a dog-friendly route.";
    }
  } else if (isRushHour) {
    agentPresenceLine = "Rush hour — picked the smoothest option.";
  } else if (isNightTime) {
    agentPresenceLine = "Late night — here's what works.";
  } else if (weather && !weather.isOutdoorFriendly) {
    agentPresenceLine = "Weather's not great — kept you covered.";
  } else if (constraints.reasonTags.includes("dog_walk")) {
    agentPresenceLine = "Found a dog-friendly route.";
  } else if (constraints.reasonTags.includes("tired")) {
    agentPresenceLine = "Keeping it easy for you.";
  }

  // Trip framing line
  let tripFramingLine = `About ${plan.estimatedDuration} minutes total.`;
  const walkSteps = steps.filter((s) => s.type === "walk");
  const transitSteps = steps.filter((s) => s.type === "transit");
  const totalWalkMin = walkSteps.reduce((sum, s) => sum + s.duration, 0);
  const transferCount = Math.max(0, transitSteps.length - 1);

  if (plan.estimatedDuration <= 10) {
    tripFramingLine = "Short hop — you'll be there in no time.";
  } else if (plan.mode === "walking") {
    tripFramingLine = totalWalkMin <= 15 ? "Nice walk — enjoy the stroll." : `${totalWalkMin} minute walk.`;
  } else if (transitSteps.length > 0) {
    if (transferCount === 0) {
      tripFramingLine = totalWalkMin <= 5
        ? "Straight shot — one ride, minimal walking."
        : "One train, bookended by short walks.";
    } else if (transferCount === 1) {
      tripFramingLine = "One transfer, straightforward route.";
    } else {
      tripFramingLine = "A few connections, but manageable.";
    }
  } else if (plan.mode === "driving") {
    tripFramingLine = "Door to door — sit back and ride.";
  }

  // Contextual insights
  const contextualInsights: string[] = [];
  if (weather && !weather.isOutdoorFriendly && totalWalkMin > 5) {
    contextualInsights.push(`${totalWalkMin} minutes of outdoor walking — might want an umbrella.`);
  }
  if (isRushHour && transitSteps.length > 0) {
    contextualInsights.push("Rush hour — trains may be crowded.");
  }
  if (constraints.reasonTags.includes("reservation")) {
    contextualInsights.push("Added buffer time for your reservation.");
  }
  if (constraints.reasonTags.includes("dog_walk")) {
    contextualInsights.push("Route avoids underground transit for your dog.");
  }

  // Responsibility line
  let responsibilityLine = "Check train times before you head out.";
  if (constraints.reasonTags.includes("meeting") || constraints.reasonTags.includes("reservation")) {
    responsibilityLine = "I'll let you know if there are delays.";
  } else if (isRushHour) {
    responsibilityLine = "Watching for service changes.";
  }

  return {
    agentPresenceLine,
    tripFramingLine,
    contextualInsights,
    responsibilityLine,
  };
}

/**
 * Generate depth layer with optional LLM enhancement
 */
async function generateDepthLayerWithLLM(
  ctx: DepthLayerContext,
  llm: LLMClient | null,
  llmDebug: LLMDebugInfo
): Promise<DepthLayerOutput> {
  // Always generate deterministic base
  const baseOutput = generateDeterministicDepthLayer(ctx);

  // Skip LLM if not available or disabled
  if (!llm || !llm.isAvailable()) {
    llmDebug.called = false;
    llmDebug.provider = "none";
    llmDebug.fallbackReason = llm ? "LLM not available (API key missing)" : "LLM client not provided";
    return baseOutput;
  }

  // Skip LLM for simple cases
  if (baseOutput.contextualInsights.length === 0 && !ctx.userNote) {
    llmDebug.called = false;
    llmDebug.provider = "none";
    llmDebug.fallbackReason = "Simple case - LLM not needed";
    return baseOutput;
  }

  // Try LLM enhancement
  try {
    const prompt = buildDepthLayerPrompt(ctx, baseOutput);
    llmDebug.called = true;

    const startTime = Date.now();
    const refined = await llm.generate(prompt, DepthLayerSchema);
    llmDebug.latencyMs = Date.now() - startTime;

    // Copy LLM debug info
    const llmInfo = llm.getDebugInfo();
    llmDebug.provider = llmInfo.provider;
    llmDebug.model = llmInfo.model;
    llmDebug.validated = true;
    llmDebug.rawPreview = llmInfo.rawPreview;

    return refined;
  } catch (error) {
    // Copy LLM debug info on failure
    if (llm) {
      const llmInfo = llm.getDebugInfo();
      llmDebug.provider = llmInfo.provider;
      llmDebug.model = llmInfo.model;
      llmDebug.latencyMs = llmInfo.latencyMs;
      llmDebug.validated = false;
      llmDebug.fallbackReason = error instanceof Error ? error.message : "Unknown error";
      llmDebug.rawPreview = llmInfo.rawPreview;
    }
    return baseOutput;
  }
}

function buildDepthLayerPrompt(ctx: DepthLayerContext, baseOutput: DepthLayerOutput): string {
  return `You are a mobility assistant. Refine this trip communication for a more natural, helpful tone.

Trip Context:
- From: ${ctx.origin || "starting point"}
- To: ${ctx.destination || "destination"}
- Intent: ${ctx.intent || "general travel"}
- User note: ${ctx.userNote || "none"}
- Weather: ${ctx.weather?.condition || "clear"}, ${ctx.weather?.temperature || 20}°C
- Rush hour: ${ctx.isRushHour ? "yes" : "no"}
- Night time: ${ctx.isNightTime ? "yes" : "no"}
- Route: ${ctx.plan.mode}, ${ctx.plan.estimatedDuration} minutes

Base output to refine:
${JSON.stringify(baseOutput, null, 2)}

Rules:
- Be concise and system-like, not chatty
- No exclamation marks or excessive enthusiasm
- Focus on practical, actionable information
- Keep the same structure but improve phrasing

Respond with valid JSON only:`;
}

// ============================================
// MAIN ORCHESTRATOR
// ============================================

export async function orchestrate(
  input: OrchestratorInput,
  ctx: SkillContext,
  getRouteCandidates?: (
    origin: string | null,
    destination: string,
    cityCode: string
  ) => Promise<RouteCandidate[]>
): Promise<OrchestratorOutput> {
  const skillResults: SkillResultMeta[] = [];
  const orchestratorStartTime = Date.now();

  // Initialize LLM debug info
  const llmDebug: LLMDebugInfo = {
    called: false,
    provider: "none",
    validated: false,
  };

  // Check LLM availability upfront
  const llmClient = ctx.llm as LLMClient | null;
  if (llmClient && typeof llmClient.isAvailable === "function") {
    if (!llmClient.isAvailable()) {
      llmDebug.fallbackReason = "API key not configured or invalid";
    }
  } else {
    llmDebug.fallbackReason = "LLM client not properly configured";
  }

  try {
    // ==========================================
    // STEP 1: Resolve Places
    // ==========================================
    const resolvePlacesResult = await runSkill(resolvePlacesSkill, ctx, {
      selectedCityCode: input.selectedCityCode,
      originText: input.originText,
      destinationText: input.destinationText,
    });
    skillResults.push(resolvePlacesResult.meta);

    const { origin, destination, inferredCityCode, confidence } = resolvePlacesResult.output;

    // ==========================================
    // STEP 2: Detect City Mismatch
    // ==========================================
    const mismatchResult = await runSkill(detectCityMismatchSkill, ctx, {
      selectedCityCode: input.selectedCityCode,
      inferredCityCode,
      confidence,
      originName: origin?.name,
      destinationName: destination.name,
    });
    skillResults.push(mismatchResult.meta);

    // Early return if city mismatch detected
    if (mismatchResult.output.mismatch) {
      return {
        type: "city_mismatch",
        suggestedCityCode: mismatchResult.output.suggestedCityCode!,
        suggestedCityName: mismatchResult.output.suggestedCityName!,
        message: mismatchResult.output.message!,
        confidence: mismatchResult.output.confidence,
        debug: ctx.flags.debugMode
          ? {
              skillsRun: skillResults.map(metaToDebugFormat),
              mismatchDetected: true,
            }
          : undefined,
      };
    }

    // ==========================================
    // STEP 3: Get Weather (optional)
    // ==========================================
    let weather: { isOutdoorFriendly: boolean; temperature: number; condition: string } | undefined;
    try {
      const weatherData = await ctx.getWeather(input.selectedCityCode);
      weather = {
        isOutdoorFriendly: weatherData.isOutdoorFriendly,
        temperature: weatherData.temperature,
        condition: weatherData.condition,
      };
    } catch (e) {
      ctx.logger.warn("Weather fetch failed, continuing without weather data");
    }

    // ==========================================
    // STEP 4: Get Venue Info (optional)
    // ==========================================
    // Skipped for now - can be added later

    // ==========================================
    // STEP 5: Generate Route Candidates
    // ==========================================
    let candidates: RouteCandidate[];
    if (getRouteCandidates) {
      candidates = await getRouteCandidates(
        origin?.name || null,
        destination.name,
        input.selectedCityCode
      );
    } else if (ctx.flags.mockExternalCalls) {
      candidates = generateMockCandidates(
        origin?.name || null,
        destination.name,
        input.selectedCityCode
      );
    } else {
      // No route provider - return error
      return {
        type: "error",
        error: "No route provider configured",
        debug: ctx.flags.debugMode
          ? { skillsRun: skillResults.map(metaToDebugFormat) }
          : undefined,
      };
    }

    if (candidates.length === 0) {
      return {
        type: "no_routes",
        message: "No routes found between these locations.",
        debug: ctx.flags.debugMode
          ? { skillsRun: skillResults.map(metaToDebugFormat) }
          : undefined,
      };
    }

    // ==========================================
    // STEP 6: Parse Note to Constraints
    // ==========================================
    const constraintsResult = await runSkill(parseNoteToConstraintsSkill, ctx, {
      noteText: input.userNote || "",
      tripIntent: input.tripIntent,
    });
    skillResults.push(constraintsResult.meta);

    const { hardConstraints, softBiases, reasonTags } = constraintsResult.output;

    // ==========================================
    // STEP 6.5: Merge Profile Biases (if available)
    // ==========================================
    let mergedBiases = { ...softBiases };
    let profileBiasesUsed: ScoringBiases | undefined;
    let memoryCallbackLine: string | undefined;

    if (input.userProfile) {
      const profile: UserProfile = {
        userId: ctx.userId || "anonymous",
        prefs: input.userProfile.prefs,
        cityFamiliarity: input.userProfile.cityFamiliarity,
        totalTrips: input.userProfile.totalTrips,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Convert profile to scoring biases
      profileBiasesUsed = profileToScoringBiases(input.userProfile.prefs);

      // Merge: profile provides baseline, note-derived biases can override
      // Weight: 60% profile, 40% note (if note has strong signals)
      const noteHasSignal =
        softBiases.calm !== 0.5 || softBiases.fast !== 0.5 ||
        softBiases.comfort !== 0.5 || softBiases.cost !== 0.5;

      if (noteHasSignal) {
        // Note has explicit signals - blend with profile
        mergedBiases = {
          calm: profileBiasesUsed.calm * 0.4 + softBiases.calm * 0.6,
          fast: profileBiasesUsed.fast * 0.4 + softBiases.fast * 0.6,
          comfort: profileBiasesUsed.comfort * 0.4 + softBiases.comfort * 0.6,
          cost: profileBiasesUsed.cost * 0.4 + softBiases.cost * 0.6,
        };
      } else {
        // No note signals - use profile primarily
        mergedBiases = {
          calm: profileBiasesUsed.calm * 0.8 + softBiases.calm * 0.2,
          fast: profileBiasesUsed.fast * 0.8 + softBiases.fast * 0.2,
          comfort: profileBiasesUsed.comfort * 0.8 + softBiases.comfort * 0.2,
          cost: profileBiasesUsed.cost * 0.8 + softBiases.cost * 0.2,
        };
      }

      // Check if we should show memory callback
      const confidence = calculateConfidence(profile, []); // Events would be passed in real usage
      if (shouldShowMemoryCallback(profile, confidence)) {
        const insight = generateMemoryInsight(profile, {
          cityCode: input.selectedCityCode,
          hasTransfers: candidates.some((c) => c.transferCount > 0),
          hasLongWalk: candidates.some((c) => c.walkingMinutes > 15),
        });
        if (insight) {
          memoryCallbackLine = insight.line;
        }
      }

      ctx.logger.debug("Profile biases merged", {
        profile: profileBiasesUsed,
        note: softBiases,
        merged: mergedBiases,
      });
    }

    // ==========================================
    // STEP 7: Score Candidates
    // ==========================================
    const now = new Date();
    const hour = now.getHours();
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
    const isNightTime = hour >= 22 || hour <= 5;

    const scoreResult = await runSkill(scoreCandidatesSkill, ctx, {
      candidates,
      tripIntent: input.tripIntent,
      constraints: hardConstraints,
      biases: mergedBiases,
      weather,
      cityCode: input.selectedCityCode,
      isRushHour,
      isNightTime,
    });
    skillResults.push(scoreResult.meta);

    const { scoredCandidates, bestCandidateId } = scoreResult.output;

    if (!bestCandidateId) {
      return {
        type: "no_routes",
        message: "No viable routes found given your constraints.",
        debug: ctx.flags.debugMode
          ? {
              skillsRun: skillResults.map(metaToDebugFormat),
              candidateScores: scoredCandidates.map((c) => ({
                id: c.id,
                score: c.score,
                breakdown: c.breakdown,
                violatesConstraints: c.violatesConstraints,
              })),
              constraintsApplied: hardConstraints,
            }
          : undefined,
      };
    }

    // ==========================================
    // STEP 8: Select Route (LLM-powered decision)
    // ==========================================
    const selectResult = await runSkill(selectRouteSkill, ctx, {
      candidates,
      scoredCandidates,
      tripIntent: input.tripIntent,
      userNote: input.userNote,
      weather,
      cityName: ctx.getCityProfile(input.selectedCityCode)?.name || input.selectedCityCode,
      isRushHour,
      isNightTime,
      unfamiliarWithCity: (input as any).unfamiliarWithCity, // Optional field
    });
    skillResults.push(selectResult.meta);

    const { selectedId, reasoning: llmReasoning, confidenceScore, keyFactors, tradeoff, usedLLM } = selectResult.output;

    // Update LLM debug info
    llmDebug.called = usedLLM;
    if (usedLLM) {
      llmDebug.provider = ctx.llm && typeof ctx.llm.getDebugInfo === 'function'
        ? ctx.llm.getDebugInfo().provider
        : "gemini";
      llmDebug.validated = true;
    }

    const bestCandidate = candidates.find((c) => c.id === selectedId)!;
    const bestScore = scoredCandidates.find((c) => c.id === selectedId)!;

    // Determine archetype from key factors or score breakdown
    const { breakdown } = bestScore;
    let archetype: "calm" | "fast" | "comfort" = "calm";
    if (keyFactors.some(f => f.toLowerCase().includes("fast"))) {
      archetype = "fast";
    } else if (keyFactors.some(f => f.toLowerCase().includes("comfort"))) {
      archetype = "comfort";
    } else if (breakdown.fast >= breakdown.calm && breakdown.fast >= breakdown.comfort) {
      archetype = "fast";
    } else if (breakdown.comfort >= breakdown.calm) {
      archetype = "comfort";
    }

    const chosenPlan: ChosenPlan = {
      mode: bestCandidate.mode === "driving" ? "driving" : bestCandidate.mode,
      summary: buildSummary(bestCandidate, archetype),
      estimatedDuration: bestCandidate.durationMinutes,
      estimatedCost: bestCandidate.estimatedCost,
      costDisplay: formatCost(bestCandidate.estimatedCost, input.selectedCityCode),
      confidence: confidenceScore,
      archetype,
    };

    // ==========================================
    // STEP 9: Build Steps
    // ==========================================
    const steps: RouteStep[] = bestCandidate.steps.map((s, i) => ({
      type: s.type,
      instruction: buildInstruction(s, i, bestCandidate.steps.length),
      duration: s.duration,
      distance: s.distance,
      line: s.line,
    }));

    // ==========================================
    // STEP 10: Depth Layer (with LLM enhancement)
    // ==========================================
    const depthLayerCtx: DepthLayerContext = {
      plan: chosenPlan,
      steps,
      constraints: { reasonTags },
      weather,
      isRushHour,
      isNightTime,
      userNote: input.userNote,
      intent: input.tripIntent,
      origin: origin?.name,
      destination: destination.name,
    };

    const baseDepthLayer = await generateDepthLayerWithLLM(
      depthLayerCtx,
      llmClient,
      llmDebug
    );

    // Add memory callback line if generated
    const depthLayer: DepthLayerOutput = {
      ...baseDepthLayer,
      memoryCallbackLine,
    };

    // ==========================================
    // BUILD TRACE LINE (for debugging)
    // ==========================================
    const totalDurationMs = Date.now() - orchestratorStartTime;
    const anyFallback = skillResults.some((s) => s.usedFallback);
    const trace = `[orchestrator] city=${input.selectedCityCode} dest=${destination.name.slice(0, 20)} llmCalled=${llmDebug.called} llmValidated=${llmDebug.validated} chosenCandidate=${bestCandidateId} fallback=${anyFallback} durationMs=${totalDurationMs}`;

    // Log trace on server
    if (ctx.flags.debugMode) {
      console.log(trace);
    }

    // ==========================================
    // RETURN SUCCESS
    // ==========================================
    return {
      type: "plan",
      resolvedContext: {
        cityCode: input.selectedCityCode,
        origin: origin?.name || null,
        destination: destination.name,
      },
      chosenPlan,
      steps,
      depthLayer,
      debug: ctx.flags.debugMode
        ? {
            skillsRun: skillResults.map(metaToDebugFormat),
            candidateScores: scoredCandidates.map((c) => ({
              id: c.id,
              score: c.score,
              breakdown: c.breakdown,
              violatesConstraints: c.violatesConstraints,
            })),
            constraintsApplied: hardConstraints,
            mismatchDetected: false,
            llm: llmDebug,
            trace,
            profileUsed: !!profileBiasesUsed,
            profileBiases: profileBiasesUsed,
          }
        : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      type: "error",
      error: errorMsg,
      debug: ctx.flags.debugMode
        ? { skillsRun: skillResults.map(metaToDebugFormat) }
        : undefined,
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function buildSummary(candidate: RouteCandidate, archetype: string): string {
  const transitSteps = candidate.steps.filter((s) => s.type === "transit");
  const transfers = Math.max(0, transitSteps.length - 1);

  if (candidate.mode === "walking") {
    return `${candidate.durationMinutes} min walk`;
  }

  if (candidate.mode === "driving") {
    return `${candidate.durationMinutes} min ride`;
  }

  if (transfers === 0 && transitSteps.length === 1) {
    const line = transitSteps[0].line;
    return line ? `${candidate.durationMinutes} min via ${line}` : `${candidate.durationMinutes} min direct`;
  }

  if (transfers === 1) {
    return `${candidate.durationMinutes} min with 1 transfer`;
  }

  return `${candidate.durationMinutes} min with ${transfers} transfers`;
}

function buildInstruction(
  step: RouteCandidate["steps"][0],
  index: number,
  total: number
): string {
  if (step.type === "walk") {
    if (index === 0) {
      return `Walk ${step.duration} min to station`;
    }
    if (index === total - 1) {
      return `Walk ${step.duration} min to destination`;
    }
    return `Walk ${step.duration} min to next station`;
  }

  if (step.type === "transit") {
    return step.line ? `Take ${step.line} for ${step.duration} min` : `Take transit for ${step.duration} min`;
  }

  if (step.type === "rideshare") {
    return `Ride for ${step.duration} min`;
  }

  return `Continue for ${step.duration} min`;
}

function formatCost(cost: number | undefined, cityCode: string): string | undefined {
  if (cost === undefined) return undefined;
  if (cost === 0) return "Free";

  const currencyMap: Record<string, string> = {
    nyc: "$",
    berlin: "€",
    tokyo: "¥",
    london: "£",
    paris: "€",
  };

  const symbol = currencyMap[cityCode] || "$";
  return `${symbol}${cost.toFixed(2)}`;
}
