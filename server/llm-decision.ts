/**
 * LLM-POWERED ROUTE DECISION ENGINE
 *
 * This module uses Gemini to make intelligent route decisions based on:
 * - Route candidates with their metrics
 * - User context (intent, notes, preferences)
 * - Environmental factors (weather, time, city)
 * - Learned user behavior patterns
 *
 * CRITICAL: This is where the AI actually THINKS about the best route,
 * not just applying fixed weights.
 */

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type {
  TripIntent,
  CityProfile,
  LearnedPreferences,
  TravelMood,
} from "@shared/schema";
import type { RouteCandidate } from "./route-scoring";
import type { WeatherData } from "./weather-service";

// ============================================
// SCHEMAS
// ============================================

/**
 * The LLM's decision output - validated with Zod
 */
const LLMDecisionSchema = z.object({
  selectedCandidateIndex: z.number().int().min(0),
  reasoning: z.string(),
  confidenceScore: z.number().min(0).max(1),
  keyFactors: z.array(z.string()).max(5),
  tradeoffAcknowledgment: z.string().optional(),
  alternativeConsideration: z.string().optional(),
  walkingRecommendation: z.string().optional(),
});

export type LLMDecision = z.infer<typeof LLMDecisionSchema>;

/**
 * Context passed to the LLM for decision-making
 */
export interface LLMDecisionContext {
  candidates: CandidateSummary[];
  userContext: {
    intent: TripIntent;
    userNote?: string;
    mood?: TravelMood;
    calmVsFast: number; // 0-100
    economyVsComfort: number; // 0-100
    unfamiliarWithCity: boolean;
    wantsToWalk?: boolean; // User explicitly requested walking
    walkingPreference?: number; // 0-1, how much user wants to walk
  };
  environmentContext: {
    weather: {
      condition: string;
      temperature: number;
      isOutdoorFriendly: boolean;
    };
    isRushHour: boolean;
    isNightTime: boolean;
    isLateNight?: boolean;
    localTimeStr?: string;
    cityName: string;
    cityCharacteristics: {
      walkingFriendliness: number;
      transitReliability: number;
      nightSafety: number;
    };
  };
  learnedPreferences?: {
    preferredWalkingTolerance: number;
    transferTolerance: number;
    typicalCalmVsQuickBias: number;
    recentPatterns: string[];
  };
}

/**
 * Simplified candidate representation for the LLM
 */
interface CandidateSummary {
  index: number;
  mode: string;
  durationMinutes: number;
  walkingMinutes: number;
  transferCount: number;
  estimatedCost: string;
  stressIndicators: string[];
  advantages: string[];
  disadvantages: string[];
}

// ============================================
// LLM CLIENT (Lazy Initialization)
// ============================================

let _aiClient: InstanceType<typeof GoogleGenAI> | null = null;

/**
 * Get the AI client (lazy initialization)
 */
function getAIClient(): InstanceType<typeof GoogleGenAI> {
  if (!_aiClient) {
    const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('AI_INTEGRATIONS_GEMINI_API_KEY not set');
    }
    _aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      },
    });
  }
  return _aiClient;
}

/**
 * Check if LLM is available
 */
export function isLLMAvailable(): boolean {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  return !!apiKey && apiKey !== "your_gemini_api_key_here";
}

// ============================================
// SYSTEM PROMPT
// ============================================

const DECISION_SYSTEM_PROMPT = `You select the best route for a user. Respond with ONLY a JSON object, nothing else.

You are generating user-facing text. Be calm, reassuring, and confident.

RULES:
1. Pick one route. Be decisive.
2. "reasoning" format:
   - Start with "Go with [mode]."
   - Then 2-3 sentences max, using concrete factors: time constraints, weather, transfers, walking effort.
   - If the user mentions a deadline or time constraint (e.g. "class at 3pm"), explicitly acknowledge it.
   - Second sentence can mention a secondary benefit (comfort, photography-friendly, scenic).
   - Max 50 words total. No bullet fragments.
3. "tradeoffAcknowledgment" = ONE sentence if relevant. Max 20 words. Omit if not needed.
4. "walkingRecommendation" = ONE sentence about which segment to walk. Max 20 words. Omit if not a walking route.
5. NEVER mention food, restaurants, cafes, eateries, dining, or places to eat. You have ZERO venue data — detour suggestions are added separately.
6. NEVER use: "discover", "explore", "experience", "immersive", "charming", "organically", "leveraging", "embrace", "best balances", "prioritizes enjoyment".
7. NEVER reference option numbers, candidate indices, or internal labels in text fields.
8. Reasoning MUST reference actual conditions from CURRENT CONDITIONS. If night, say "at this hour". If weather is bad, mention it. NEVER invent conditions.
9. NEVER use atmospheric adjectives: "pleasant", "lovely", "nice", "beautiful", "delightful", "wonderful". Describe facts, not feelings.

{
  "selectedCandidateIndex": <0-based>,
  "reasoning": "<Go with [mode]. 2-3 sentences, max 50 words>",
  "confidenceScore": <0.0-1.0>,
  "keyFactors": ["<2-4 word factor>", ...],
  "tradeoffAcknowledgment": "<optional, ONE sentence, max 20 words>",
  "alternativeConsideration": "<optional, ONE sentence, max 20 words>",
  "walkingRecommendation": "<optional, ONE sentence about the walk segment, max 20 words>"
}`;

// ============================================
// CANDIDATE SUMMARIZATION
// ============================================

/**
 * Convert RouteCandidate to a simplified summary for the LLM
 */
function summarizeCandidate(
  candidate: RouteCandidate,
  index: number,
  context: {
    weather: { isOutdoorFriendly: boolean; temperature: number };
    isNightTime: boolean;
    isRushHour: boolean;
    cityProfile: CityProfile;
  }
): CandidateSummary {
  const { metrics, mode, archetype } = candidate;
  const stressIndicators: string[] = [];
  const advantages: string[] = [];
  const disadvantages: string[] = [];

  // Analyze stress indicators
  if (metrics.transferCount > 0) {
    stressIndicators.push(`${metrics.transferCount} transfer${metrics.transferCount > 1 ? 's' : ''}`);
  }
  if (metrics.hasComplexStation) {
    stressIndicators.push('complex station navigation');
  }
  if (metrics.walkingMinutes > 15) {
    stressIndicators.push(`${metrics.walkingMinutes} min of walking`);
  }
  if (!context.weather.isOutdoorFriendly && metrics.walkingMinutes > 5) {
    stressIndicators.push('outdoor exposure in bad weather');
  }
  if (context.isRushHour && mode === 'transit') {
    stressIndicators.push('rush hour crowding');
  }
  if (context.isNightTime && mode === 'walking') {
    stressIndicators.push('walking at night');
  }

  // Analyze advantages
  if (metrics.transferCount === 0 && mode === 'transit') {
    advantages.push('direct route, no transfers');
  }
  if (metrics.walkingMinutes <= 5) {
    advantages.push('minimal walking');
  }
  // Walking advantages - for users who want to walk
  if (metrics.walkingMinutes >= 10 && metrics.walkingMinutes <= 25) {
    advantages.push(`includes ${metrics.walkingMinutes} min pleasant walk`);
  }
  if (mode === 'walking') {
    if (context.weather.isOutdoorFriendly) {
      advantages.push('free, healthy, and scenic');
    } else {
      advantages.push('free option');
    }
    if (metrics.durationMinutes <= 20) {
      advantages.push('quick walk');
    }
  }
  if (mode === 'driving') {
    advantages.push('door-to-door comfort');
    advantages.push('climate controlled');
  }
  if (archetype === 'calm') {
    advantages.push('low-stress option');
  }
  if (archetype === 'fast') {
    advantages.push('fastest option');
  }

  // Analyze disadvantages
  if (metrics.durationMinutes > 40) {
    disadvantages.push('long journey time');
  }
  if (mode === 'driving') {
    disadvantages.push('higher cost');
  }
  if (metrics.transferCount >= 2) {
    disadvantages.push('multiple connections');
  }
  if (mode === 'walking' && metrics.durationMinutes > 20) {
    disadvantages.push('tiring walk');
  }

  // Estimate cost display
  let estimatedCost = 'Unknown';
  if (mode === 'walking') {
    estimatedCost = 'Free';
  } else if (mode === 'transit') {
    estimatedCost = 'Standard fare (~$3)';
  } else if (mode === 'driving') {
    estimatedCost = 'Rideshare (~$15-25)';
  }

  return {
    index,
    mode: mode === 'driving' ? 'rideshare' : mode,
    durationMinutes: metrics.durationMinutes,
    walkingMinutes: metrics.walkingMinutes,
    transferCount: metrics.transferCount,
    estimatedCost,
    stressIndicators,
    advantages,
    disadvantages,
  };
}

// ============================================
// PROMPT BUILDING
// ============================================

function buildDecisionPrompt(context: LLMDecisionContext): string {
  const candidateDescriptions = context.candidates
    .map((c, i) => `
Candidate ${i} — ${c.mode.toUpperCase()} route:
- Duration: ${c.durationMinutes} minutes
- Walking: ${c.walkingMinutes} minutes
- Transfers: ${c.transferCount}
- Cost: ${c.estimatedCost}
- Advantages: ${c.advantages.length > 0 ? c.advantages.join(', ') : 'None notable'}
- Disadvantages: ${c.disadvantages.length > 0 ? c.disadvantages.join(', ') : 'None notable'}
- Stress factors: ${c.stressIndicators.length > 0 ? c.stressIndicators.join(', ') : 'Low stress'}`)
    .join('\n');

  const userNote = context.userContext.userNote
    ? `\nUser's note: "${context.userContext.userNote}"`
    : '';

  const learnedPatterns = context.learnedPreferences?.recentPatterns?.length
    ? `\nLearned patterns: ${context.learnedPreferences.recentPatterns.join('; ')}`
    : '';

  // Walking preference section
  let walkingSection = '';
  if (context.userContext.wantsToWalk || (context.userContext.walkingPreference && context.userContext.walkingPreference > 0.3)) {
    walkingSection = `
*** IMPORTANT - USER WANTS TO WALK ***
The user has expressed a desire to include walking in their journey.
- Walking preference strength: ${Math.round((context.userContext.walkingPreference || 0.5) * 100)}%
- Weather suitable for walking: ${context.environmentContext.weather.isOutdoorFriendly ? 'Yes' : 'No (consider shorter walk)'}
- City walking friendliness: ${Math.round(context.environmentContext.cityCharacteristics.walkingFriendliness * 100)}/100
- Night time: ${context.environmentContext.isNightTime ? 'Yes (consider safety)' : 'No'}

When selecting a route, PRIORITIZE options that include 10-20 minutes of pleasant walking.
If pure transit is selected, suggest a walking segment they could add (e.g., "get off one stop early").
`;
  }

  return `
ROUTE OPTIONS:
${candidateDescriptions}

USER CONTEXT:
- Trip purpose: ${context.userContext.intent}${userNote}
- Mood preference: ${context.userContext.mood || 'normal'}
- Calm vs Fast preference: ${context.userContext.calmVsFast}/100 (0=very calm, 100=very fast)
- Economy vs Comfort: ${context.userContext.economyVsComfort}/100 (0=budget, 100=comfort)
- Familiar with city: ${context.userContext.unfamiliarWithCity ? 'No, first time visitor' : 'Yes'}
${learnedPatterns}
${walkingSection}
CURRENT CONDITIONS:
- Local time: ${context.environmentContext.localTimeStr || 'unknown'}
- Weather: ${context.environmentContext.weather.condition}, ${context.environmentContext.weather.temperature}°C
- Outdoor-friendly: ${context.environmentContext.weather.isOutdoorFriendly ? 'Yes' : 'No'}
- Time: ${context.environmentContext.isLateNight ? 'Late night' : context.environmentContext.isNightTime ? 'Night time' : context.environmentContext.isRushHour ? 'Rush hour' : 'Normal hours'}
- City: ${context.environmentContext.cityName}
- City walking score: ${Math.round(context.environmentContext.cityCharacteristics.walkingFriendliness * 100)}/100
- Transit reliability: ${Math.round(context.environmentContext.cityCharacteristics.transitReliability * 100)}/100

Select the best option and explain your reasoning. Consider ALL factors, not just speed.
`;
}

// ============================================
// MAIN DECISION FUNCTION
// ============================================

export interface LLMDecisionResult {
  decision: LLMDecision;
  selectedCandidate: RouteCandidate;
  usedLLM: boolean;
  debugInfo?: {
    prompt: string;
    rawResponse: string;
    latencyMs: number;
  };
}

/**
 * Make an LLM-powered route decision
 *
 * @param candidates - The route options to choose from
 * @param context - Full context for decision-making
 * @returns The selected candidate with reasoning
 */
export async function makeLLMDecision(
  candidates: RouteCandidate[],
  userContext: LLMDecisionContext['userContext'],
  environmentContext: LLMDecisionContext['environmentContext'],
  learnedPreferences?: LLMDecisionContext['learnedPreferences'],
  debugMode: boolean = false
): Promise<LLMDecisionResult> {
  if (!isLLMAvailable()) {
    throw new Error('LLM not available - API key not configured');
  }

  if (candidates.length === 0) {
    throw new Error('No candidates to choose from');
  }

  if (candidates.length === 1) {
    // Only one option - no decision needed
    return {
      decision: {
        selectedCandidateIndex: 0,
        reasoning: "This is the only available route option.",
        confidenceScore: 1.0,
        keyFactors: ["only option available"],
      },
      selectedCandidate: candidates[0],
      usedLLM: false,
    };
  }

  // Build candidate summaries
  const candidateSummaries = candidates.map((c, i) =>
    summarizeCandidate(c, i, {
      weather: environmentContext.weather,
      isNightTime: environmentContext.isNightTime,
      isRushHour: environmentContext.isRushHour,
      cityProfile: {
        id: environmentContext.cityName.toLowerCase(),
        name: environmentContext.cityName,
        country: '',
        timezone: '',
        complexStations: [],
        nightReliability: environmentContext.cityCharacteristics.nightSafety,
        transitVsTaxiBias: 0.5,
        walkingFriendliness: environmentContext.cityCharacteristics.walkingFriendliness,
        cognitiveLoadIndex: { navigation: 0.5, signage: 0.5, crowding: 0.5, overall: 0.5 },
        currency: 'USD',
        transitTypes: [],
        rideshareApps: [],
      },
    })
  );

  const fullContext: LLMDecisionContext = {
    candidates: candidateSummaries,
    userContext,
    environmentContext,
    learnedPreferences,
  };

  const prompt = buildDecisionPrompt(fullContext);
  const startTime = Date.now();

  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: DECISION_SYSTEM_PROMPT }] },
        { role: "model", parts: [{ text: "Understood. I'll pick the best route and respond with JSON only." }] },
        { role: "user", parts: [{ text: prompt }] },
      ],
    });

    const latencyMs = Date.now() - startTime;
    const rawResponse = response.text || "";

    // Parse and validate the response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const decision = LLMDecisionSchema.parse(parsed);

    // Validate the selected index
    if (decision.selectedCandidateIndex >= candidates.length) {
      throw new Error(`Invalid candidate index: ${decision.selectedCandidateIndex}`);
    }

    // Sanitize: strip internal labels like "Option 0", "Candidate 1" from user-facing text
    const sanitizeLabels = (text: string) =>
      text.replace(/\b(Option|Candidate)\s+\d+\b/gi, (match) => {
        const idx = parseInt(match.replace(/\D/g, ''), 10);
        if (idx >= 0 && idx < candidateSummaries.length) {
          return `the ${candidateSummaries[idx].mode} route`;
        }
        return 'this route';
      });

    // Strip hallucinated food/restaurant mentions — this LLM has no venue data
    const stripFoodHallucinations = (text: string) =>
      text
        .replace(/\b(discover|find|explore|stop at|visit|check out)\s+(local\s+)?(eateries|restaurants|cafes|food spots|dining|charming food|culinary|food places)[^.]*\./gi, '')
        .replace(/\b(finding|discovering|exploring)\s+(local\s+)?(eateries|restaurants|cafes|food spots|charming food)[^.]*\./gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Strip atmospheric adjectives — grounding, not feelings
    const stripAtmosphericAdjs = (text: string) =>
      text
        .replace(/\b(pleasant|lovely|nice|beautiful|delightful|wonderful|gorgeous|fantastic)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Enforce max length per field
    const truncate = (text: string, max: number) =>
      text.length > max ? text.slice(0, max - 3).replace(/\s+\S*$/, '') + '...' : text;

    const sanitize = (text: string, max: number) =>
      truncate(stripAtmosphericAdjs(stripFoodHallucinations(sanitizeLabels(text))), max);

    decision.reasoning = sanitize(decision.reasoning, 400);
    if (decision.tradeoffAcknowledgment) decision.tradeoffAcknowledgment = sanitize(decision.tradeoffAcknowledgment, 150);
    if (decision.alternativeConsideration) decision.alternativeConsideration = sanitize(decision.alternativeConsideration, 150);
    if (decision.walkingRecommendation) decision.walkingRecommendation = sanitize(decision.walkingRecommendation, 150);

    const result: LLMDecisionResult = {
      decision,
      selectedCandidate: candidates[decision.selectedCandidateIndex],
      usedLLM: true,
    };

    if (debugMode) {
      result.debugInfo = {
        prompt,
        rawResponse,
        latencyMs,
      };
    }

    return result;
  } catch (error) {
    console.error('LLM decision failed:', error);
    throw error;
  }
}

// ============================================
// FALLBACK: Enhanced Deterministic Decision
// ============================================

/**
 * Fallback decision when LLM is unavailable
 * Uses smarter heuristics than the original fixed weights
 */
export function makeFallbackDecision(
  candidates: RouteCandidate[],
  userContext: LLMDecisionContext['userContext'],
  environmentContext: LLMDecisionContext['environmentContext'],
  learnedPreferences?: LLMDecisionContext['learnedPreferences']
): LLMDecisionResult {
  if (candidates.length === 0) {
    throw new Error('No candidates to choose from');
  }

  if (candidates.length === 1) {
    return {
      decision: {
        selectedCandidateIndex: 0,
        reasoning: "This is the only available route option.",
        confidenceScore: 1.0,
        keyFactors: ["only option available"],
      },
      selectedCandidate: candidates[0],
      usedLLM: false,
    };
  }

  // Score each candidate with context-aware heuristics
  const scores = candidates.map((candidate, index) => {
    let score = 50; // Base score
    const factors: string[] = [];

    const { metrics, mode } = candidate;

    // Intent-based scoring
    if (userContext.intent === 'time_sensitive' || userContext.intent === 'work') {
      // Speed matters more
      score += (60 - metrics.durationMinutes) * 0.5;
      if (metrics.durationMinutes < 20) factors.push('fast option');
    } else if (userContext.intent === 'leisure' || userContext.intent === 'exploring') {
      // Calm matters more
      score -= metrics.transferCount * 10;
      if (metrics.transferCount === 0) factors.push('no transfers');
    }

    // User note analysis - STRONG impact
    if (userContext.userNote) {
      const note = userContext.userNote.toLowerCase();
      if (note.includes('tired') || note.includes('exhausted') || note.includes('no walk') || note.includes('minimize walk')) {
        // Heavy penalty for walking when user is tired
        score -= metrics.walkingMinutes * 5;
        if (metrics.walkingMinutes <= 5) {
          score += 30; // Big bonus for minimal walking
          factors.push('minimal walking');
        }
      }
      if (note.includes('date') || note.includes('romantic') || note.includes('special')) {
        if (mode === 'driving') score += 20;
        score -= metrics.transferCount * 10;
      }
      if (note.includes('cheap') || note.includes('budget') || note.includes('save')) {
        if (mode === 'walking') score += 30;
        if (mode === 'driving') score -= 25;
      }
    }

    // Walking preference - USER WANTS TO WALK
    if (userContext.wantsToWalk || (userContext.walkingPreference && userContext.walkingPreference > 0.3)) {
      const walkPref = userContext.walkingPreference || 0.5;
      
      // Pure walking route is STRONGLY preferred when user wants to walk
      if (mode === 'walking') {
        if (metrics.durationMinutes <= 20) {
          // Short walk - perfect!
          score += 60 * walkPref;
          factors.push('perfect walking distance');
        } else if (metrics.durationMinutes <= 35) {
          // Medium walk - still good
          score += 45 * walkPref;
          factors.push('nice leisurely walk');
        } else {
          // Long walk - depends on preference strength
          score += 30 * walkPref;
          factors.push('longer walk option');
        }
      }
      
      // Boost routes with moderate walking (10-25 min is ideal for a "little walk")
      if (metrics.walkingMinutes >= 10 && metrics.walkingMinutes <= 25 && mode !== 'walking') {
        score += 35 * walkPref;
        factors.push('includes pleasant walk');
      } else if (metrics.walkingMinutes >= 5 && metrics.walkingMinutes < 10 && mode !== 'walking') {
        score += 20 * walkPref;
        factors.push('short walk included');
      }
      
      // Penalize routes with NO walking when user wants to walk
      if (metrics.walkingMinutes < 5 && mode !== 'walking') {
        score -= 25 * walkPref;
      }
      
      // Weather consideration - reduce walk bonus BUT don't eliminate it
      // User explicitly asked to walk, so respect that even in imperfect weather
      if (!environmentContext.weather.isOutdoorFriendly) {
        // Smaller penalty than before - user's preference matters more
        score -= 10 * walkPref;
        // But if it's EXTREME cold (<-10C) or actual rain, be more cautious
        if (environmentContext.weather.temperature < -10) {
          score -= 15 * walkPref;
        }
      }
    }

    // Weather impact
    if (!environmentContext.weather.isOutdoorFriendly) {
      score -= metrics.walkingMinutes * 2;
      if (mode === 'driving') {
        score += 10;
        factors.push('weather protection');
      }
    }

    // Time-based scoring
    if (environmentContext.isNightTime) {
      if (mode === 'walking' && metrics.durationMinutes > 15) {
        score -= 20;
      }
      if (mode === 'driving') {
        score += 10;
        factors.push('safe for night');
      }
    }

    // Late-night specific scoring (stronger than generic night)
    if (environmentContext.isLateNight) {
      if (mode === 'walking') {
        score -= 35;
        factors.push('late hour');
      }
      if (mode === 'driving') {
        score += 15;
        factors.push('safe for late night');
      }
    }

    if (environmentContext.isRushHour && mode === 'transit') {
      score -= 10;
    }

    // Unfamiliar city
    if (userContext.unfamiliarWithCity) {
      score -= metrics.transferCount * 8;
      if (metrics.hasComplexStation) score -= 15;
      if (mode === 'driving') score += 10;
    }

    // Slider preferences - STRONGER impact
    const calmBias = (100 - userContext.calmVsFast) / 100;
    score -= metrics.transferCount * 8 * calmBias;
    score += (30 - metrics.durationMinutes) * 0.5 * (1 - calmBias);

    // Economy vs Comfort slider - MUCH STRONGER impact
    const economyBias = (100 - userContext.economyVsComfort) / 100; // 1 = economy, 0 = comfort
    if (mode === 'driving') {
      // Heavily penalize driving when economy-focused
      score -= 40 * economyBias;
      // Boost driving when comfort-focused
      score += 20 * (1 - economyBias);
    }
    if (mode === 'transit') {
      // Slight boost for transit when economy-focused (it's cheaper than driving)
      score += 10 * economyBias;
    }
    if (mode === 'walking') {
      // Walking is free - boost for economy-focused users
      score += 15 * economyBias;
    }

    // Learned preferences - STRONG impact
    if (learnedPreferences) {
      const walkingThreshold = learnedPreferences.preferredWalkingTolerance * 10;
      if (metrics.walkingMinutes > walkingThreshold) {
        // Strong penalty for exceeding learned walking tolerance
        const excess = metrics.walkingMinutes - walkingThreshold;
        score -= excess * 3;
      } else if (metrics.walkingMinutes <= 5 && walkingThreshold <= 10) {
        // Bonus for minimal walking when user has low tolerance
        factors.push('minimal walking');
      }

      if (metrics.transferCount > learnedPreferences.transferTolerance) {
        score -= (metrics.transferCount - learnedPreferences.transferTolerance) * 12;
      }
    }

    return { index, score, factors };
  });

  // Select the best
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const runnerUp = scores[1];

  // Build reasoning — calm, concrete, 2-3 sentences
  const selectedCandidate = candidates[best.index];
  const modeLabel = selectedCandidate.mode === 'driving' ? 'rideshare' : selectedCandidate.mode;
  let reasoning = `Go with ${modeLabel}.`;

  // Build a natural reasoning sentence from factors
  if (best.factors.length > 0) {
    const factorStr = best.factors.slice(0, 2).join(' and ');
    reasoning += ` It gets you there with ${factorStr}.`;
  }

  // Add secondary benefit based on mode
  if (selectedCandidate.mode === 'driving') {
    reasoning += ' Door-to-door with no transfers.';
  } else if (selectedCandidate.mode === 'walking' && selectedCandidate.metrics.durationMinutes <= 25) {
    reasoning += ' A straightforward walk at your own pace.';
  }

  // Check for tradeoff
  let tradeoff: string | undefined;
  if (runnerUp && scores[0].score - scores[1].score < 10) {
    const runnerUpCandidate = candidates[runnerUp.index];
    if (runnerUpCandidate.metrics.durationMinutes < selectedCandidate.metrics.durationMinutes - 5) {
      tradeoff = `A faster option exists (${runnerUpCandidate.metrics.durationMinutes} min) but involves more stress.`;
    }
  }

  return {
    decision: {
      selectedCandidateIndex: best.index,
      reasoning,
      confidenceScore: 0.7, // Lower confidence for fallback
      keyFactors: best.factors.slice(0, 3),
      tradeoffAcknowledgment: tradeoff,
    },
    selectedCandidate: candidates[best.index],
    usedLLM: false,
  };
}

// ============================================
// COMBINED DECISION FUNCTION
// ============================================

/**
 * Make a route decision - uses LLM if available, falls back to heuristics
 */
export async function makeRouteDecision(
  candidates: RouteCandidate[],
  userContext: LLMDecisionContext['userContext'],
  environmentContext: LLMDecisionContext['environmentContext'],
  learnedPreferences?: LLMDecisionContext['learnedPreferences'],
  options: { preferLLM?: boolean; debugMode?: boolean } = {}
): Promise<LLMDecisionResult> {
  const { preferLLM = true, debugMode = false } = options;

  // Try LLM first if available and preferred
  if (preferLLM && isLLMAvailable()) {
    try {
      return await makeLLMDecision(
        candidates,
        userContext,
        environmentContext,
        learnedPreferences,
        debugMode
      );
    } catch (error) {
      console.warn('LLM decision failed, falling back to heuristics:', error);
    }
  }

  // Fallback to enhanced heuristics
  return makeFallbackDecision(
    candidates,
    userContext,
    environmentContext,
    learnedPreferences
  );
}
