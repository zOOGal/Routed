/**
 * LLM CLIENT WRAPPER
 *
 * Wraps Gemini API with:
 * - Availability checking (env var exists)
 * - Latency tracking
 * - Validation with Zod
 * - Debug instrumentation
 */

import { z } from "zod";
import type { LLMClient, LLMDebugInfo } from "../skills/types";

// Re-export types for convenience
export type { LLMClient, LLMDebugInfo };

// ============================================
// GEMINI CLIENT IMPLEMENTATION
// ============================================

interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function createGeminiClient(config?: GeminiConfig): LLMClient {
  const apiKey = config?.apiKey || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = config?.baseUrl || process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  const model = config?.model || "gemini-2.5-flash";

  let debugInfo: LLMDebugInfo = {
    called: false,
    provider: "none",
    validated: false,
  };

  const isAvailable = (): boolean => {
    const available = !!apiKey && apiKey !== "your_gemini_api_key_here";
    if (!available) {
      debugInfo.fallbackReason = "API key not configured";
      debugInfo.provider = "none";
    }
    return available;
  };

  const generate = async <T = string>(
    prompt: string,
    schema?: z.ZodType<T>
  ): Promise<T> => {
    debugInfo.called = true;
    debugInfo.inputTokensEstimate = Math.ceil(prompt.length / 4);

    if (!isAvailable()) {
      debugInfo.fallbackReason = "API key not configured";
      throw new Error("LLM not available: API key not configured");
    }

    debugInfo.provider = "gemini";
    debugInfo.model = model;

    const startTime = Date.now();

    try {
      // Dynamic import to avoid loading @google/genai if not needed
      const { GoogleGenAI } = await import("@google/genai");

      const ai = new GoogleGenAI({
        apiKey: apiKey!,
        httpOptions: {
          apiVersion: "",
          baseUrl,
        },
      });

      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      debugInfo.latencyMs = Date.now() - startTime;

      const content = response.text || "";
      debugInfo.rawPreview = content.slice(0, 200);

      // If no schema, return raw string
      if (!schema) {
        debugInfo.validated = true;
        return content as T;
      }

      // Try to parse JSON and validate with schema
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          debugInfo.validated = false;
          debugInfo.fallbackReason = "No JSON found in response";
          throw new Error("No JSON found in LLM response");
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const validated = schema.parse(parsed);
        debugInfo.validated = true;
        return validated;
      } catch (parseError) {
        debugInfo.validated = false;
        debugInfo.fallbackReason = `Validation failed: ${parseError instanceof Error ? parseError.message : "unknown"}`;
        throw parseError;
      }
    } catch (error) {
      debugInfo.latencyMs = Date.now() - startTime;
      if (!debugInfo.fallbackReason) {
        debugInfo.fallbackReason = error instanceof Error ? error.message : "Unknown error";
      }
      throw error;
    }
  };

  return {
    generate,
    isAvailable,
    getDebugInfo: () => ({ ...debugInfo }),
    resetDebugInfo: () => {
      debugInfo = {
        called: false,
        provider: "none",
        validated: false,
      };
    },
  };
}

// ============================================
// NULL CLIENT (for testing/fallback)
// ============================================

export function createNullLLMClient(reason: string = "LLM disabled"): LLMClient {
  const debugInfo: LLMDebugInfo = {
    called: false,
    provider: "none",
    validated: false,
    fallbackReason: reason,
  };

  return {
    generate: async <T>(): Promise<T> => {
      debugInfo.called = true;
      throw new Error(reason);
    },
    isAvailable: () => false,
    getDebugInfo: () => ({ ...debugInfo }),
    resetDebugInfo: () => {
      debugInfo.called = false;
    },
  };
}
