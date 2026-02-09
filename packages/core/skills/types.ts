/**
 * ROUTED SKILL SYSTEM — TYPE DEFINITIONS
 *
 * A skill is a small, testable, deterministic module with:
 * - Clear input/output contract (Zod validated)
 * - Fallback behavior when external calls fail
 * - Instrumentation for debugging
 */

import { z } from "zod";
import type { TripIntent, CityProfile, LearnedPreferences, VenueInfo } from "@shared/schema";
import type { WeatherData } from "../../../server/weather-service";

// ============================================
// SKILL CONTEXT — shared dependencies
// ============================================

export interface SkillLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

export interface LLMDebugInfo {
  called: boolean;
  provider: "gemini" | "none";
  model?: string;
  latencyMs?: number;
  validated: boolean;
  fallbackReason?: string;
  rawPreview?: string;
  inputTokensEstimate?: number;
}

export interface LLMClient {
  /**
   * Generate text completion with JSON schema validation
   * @param prompt The prompt to send
   * @param schema Optional Zod schema for structured output
   * @returns The generated text or parsed JSON
   */
  generate<T = string>(prompt: string, schema?: z.ZodType<T>): Promise<T>;

  /**
   * Check if LLM is available
   */
  isAvailable(): boolean;

  /**
   * Get debug info about last LLM call
   */
  getDebugInfo(): LLMDebugInfo;

  /**
   * Reset debug info for new request
   */
  resetDebugInfo(): void;
}

export interface SkillContext {
  // Logging
  logger: SkillLogger;

  // Time context
  now: Date;
  timezone: string;

  // City context
  getCityProfile: (cityCode: string) => CityProfile | null;

  // Weather resolver
  getWeather: (cityCode: string, lat?: number, lng?: number) => Promise<WeatherData>;

  // Venue resolver
  getVenueInfo: (placeName: string, cityCode: string) => Promise<VenueInfo | null>;

  // LLM client (for semantic parsing, NOT core decisions)
  llm: LLMClient;

  // Feature flags
  flags: {
    debugMode: boolean;
    useLLM: boolean;
    mockExternalCalls: boolean;
  };

  // User context (optional)
  userId?: string;
  learnedPreferences?: LearnedPreferences;
}

// ============================================
// SKILL RESULT METADATA — instrumentation
// ============================================

export interface SkillResultMeta {
  skillName: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  ok: boolean;
  usedFallback: boolean;
  error?: string;
  notes?: string[];
}

// ============================================
// SKILL INTERFACE
// ============================================

export interface Skill<TInput, TOutput> {
  /** Unique name for this skill */
  name: string;

  /** Zod schema for input validation */
  inputSchema: z.ZodType<TInput>;

  /** Zod schema for output validation */
  outputSchema: z.ZodType<TOutput>;

  /**
   * Execute the skill
   * @param ctx Shared context (logger, time, resolvers, etc.)
   * @param input Validated input
   * @returns Output and metadata
   */
  run(ctx: SkillContext, input: TInput): Promise<{
    output: TOutput;
    meta: Omit<SkillResultMeta, "skillName" | "startedAt" | "endedAt" | "durationMs">;
  }>;

  /**
   * Optional fallback output when skill fails
   * If provided, runSkill will return this instead of throwing
   */
  fallback?: (input: TInput) => TOutput;
}

// ============================================
// SKILL RUNNER — validates, executes, logs
// ============================================

export interface SkillRunResult<TOutput> {
  output: TOutput;
  meta: SkillResultMeta;
}

/**
 * Run a skill with validation, error handling, and instrumentation
 */
export async function runSkill<TInput, TOutput>(
  skill: Skill<TInput, TOutput>,
  ctx: SkillContext,
  rawInput: TInput
): Promise<SkillRunResult<TOutput>> {
  const startedAt = new Date();
  const notes: string[] = [];

  try {
    // 1. Validate input
    const inputResult = skill.inputSchema.safeParse(rawInput);
    if (!inputResult.success) {
      const errorMsg = `Input validation failed: ${inputResult.error.message}`;
      ctx.logger.error(`[${skill.name}] ${errorMsg}`);

      if (skill.fallback) {
        notes.push("Input validation failed, using fallback");
        const fallbackOutput = skill.fallback(rawInput);
        return {
          output: fallbackOutput,
          meta: buildMeta(skill.name, startedAt, true, true, notes),
        };
      }
      throw new Error(errorMsg);
    }

    const input = inputResult.data;

    // 2. Execute skill
    ctx.logger.debug(`[${skill.name}] Starting execution`, { input });
    const result = await skill.run(ctx, input);

    // 3. Validate output
    const outputResult = skill.outputSchema.safeParse(result.output);
    if (!outputResult.success) {
      const errorMsg = `Output validation failed: ${outputResult.error.message}`;
      ctx.logger.error(`[${skill.name}] ${errorMsg}`);

      if (skill.fallback) {
        notes.push("Output validation failed, using fallback");
        const fallbackOutput = skill.fallback(input);
        return {
          output: fallbackOutput,
          meta: buildMeta(skill.name, startedAt, true, true, notes),
        };
      }
      throw new Error(errorMsg);
    }

    // 4. Success
    const allNotes = [...notes, ...(result.meta.notes || [])];
    ctx.logger.debug(`[${skill.name}] Completed successfully`, {
      usedFallback: result.meta.usedFallback,
    });

    return {
      output: outputResult.data,
      meta: buildMeta(
        skill.name,
        startedAt,
        result.meta.ok,
        result.meta.usedFallback,
        allNotes.length > 0 ? allNotes : undefined,
        result.meta.error
      ),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    ctx.logger.error(`[${skill.name}] Execution failed: ${errorMsg}`);

    // Try fallback
    if (skill.fallback) {
      notes.push(`Execution failed (${errorMsg}), using fallback`);
      const fallbackOutput = skill.fallback(rawInput);
      return {
        output: fallbackOutput,
        meta: buildMeta(skill.name, startedAt, false, true, notes, errorMsg),
      };
    }

    // No fallback, re-throw
    throw error;
  }
}

function buildMeta(
  skillName: string,
  startedAt: Date,
  ok: boolean,
  usedFallback: boolean,
  notes?: string[],
  error?: string
): SkillResultMeta {
  const endedAt = new Date();
  return {
    skillName,
    startedAt,
    endedAt,
    durationMs: endedAt.getTime() - startedAt.getTime(),
    ok,
    usedFallback,
    notes,
    error,
  };
}

// ============================================
// COMMON SCHEMAS
// ============================================

export const TripIntentSchema = z.enum([
  "work",
  "leisure",
  "appointment",
  "time_sensitive",
  "exploring",
]);

export const ResolvedPlaceSchema = z.object({
  name: z.string(),
  query: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  inferredCityName: z.string().nullable(),
  inferredCityCode: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["lookup", "geocode", "heuristic"]),
});

export type ResolvedPlaceOutput = z.infer<typeof ResolvedPlaceSchema>;

export const HardConstraintsSchema = z.object({
  avoidUnderground: z.boolean().optional(),
  preferOutdoors: z.boolean().optional(),
  minContinuousWalkMin: z.number().optional(),
  maxWalkMin: z.number().optional(),
  requireAccessible: z.boolean().optional(),
});

export const SoftBiasesSchema = z.object({
  calm: z.number().min(0).max(1),
  fast: z.number().min(0).max(1),
  comfort: z.number().min(0).max(1),
  cost: z.number().min(0).max(1),
});

export type HardConstraints = z.infer<typeof HardConstraintsSchema>;
export type SoftBiases = z.infer<typeof SoftBiasesSchema>;
