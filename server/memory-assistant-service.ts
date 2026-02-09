/**
 * API client wrapper for memory-assistant with graceful fallback.
 *
 * This service connects Routed's trip system with the memory-assistant backend
 * for richer, semantic learning from user interactions.
 *
 * Follows patterns from weather-service.ts:
 * - Environment config
 * - Fetch-based API calls
 * - Graceful error handling (failures logged but don't break trips)
 */

import {
  getMemoryUserId,
  setUserMapping,
  hasMemoryMapping,
} from "./memory-user-mapping";

// Configuration from environment
const MEMORY_ASSISTANT_URL = process.env.MEMORY_ASSISTANT_URL || "http://localhost:8000";
const MEMORY_ASSISTANT_API_KEY = process.env.MEMORY_ASSISTANT_API_KEY || "dev-api-key-change-me";

// Types matching memory-assistant API
export interface MemoryResponse {
  id: string;
  user_id: string;
  type: "preference" | "profile" | "constraint" | "goal" | "episode";
  text: string;
  structured_json: Record<string, unknown> | null;
  confidence: number;
  sensitivity: "low" | "med" | "high";
  created_at: string;
  expires_at: string | null;
}

export interface MemoryListResponse {
  memories: MemoryResponse[];
  total: number;
}

export interface UserResponse {
  id: string;
  created_at: string;
}

export interface ChatResponse {
  reply: string;
  used_memories: string[];
  stored_memories: string[];
}

export interface MemorySummary {
  total: number;
  byType: Record<string, number>;
  recent: MemoryResponse[];
  highlights: string[];
}

interface TripEpisodeData {
  tripId: string;
  cityId: string;
  mode?: string;
  userNote?: string | null;
  stepsCompleted?: number;
  success?: boolean;
}

interface NoteContext {
  cityId?: string;
  intent?: string;
  tripId?: string;
}

// Types for detour suggestions API
export interface DetourSuggestion {
  poi_id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  category: string | null;
  adds_minutes: number;
  corridor_distance_km: number;
  social_score: number;
  why_special: string;
  what_to_order: string[];
  warnings: string[];
  vibe_tags: string[];
  confidence: number;
  sources_count: Record<string, number>;
  is_open: boolean | null;
}

export interface DetourSuggestResponse {
  suggestions: DetourSuggestion[];
  corridor_buffer_km: number;
  note: string;
}

/**
 * Check if the memory-assistant service is configured and available.
 */
export function isMemoryAssistantConfigured(): boolean {
  return !!MEMORY_ASSISTANT_URL && !!MEMORY_ASSISTANT_API_KEY;
}

/**
 * Make an API request to the memory-assistant service.
 * Wraps fetch with error handling and auth headers.
 */
async function memoryApiRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<T | null> {
  if (!isMemoryAssistantConfigured()) {
    console.warn("[memory-assistant] Service not configured, skipping request");
    return null;
  }

  const url = `${MEMORY_ASSISTANT_URL}${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MEMORY_ASSISTANT_API_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[memory-assistant] API error ${response.status}: ${errorText}`);
      return null;
    }

    return await response.json() as T;
  } catch (error) {
    console.error(`[memory-assistant] Request failed:`, error);
    return null;
  }
}

/**
 * Create a new user in the memory-assistant service.
 */
async function createMemoryUser(): Promise<string | null> {
  const result = await memoryApiRequest<UserResponse>("POST", "/v1/users", {});
  return result?.id || null;
}

/**
 * Ensure a memory-assistant user exists for the given Routed user.
 * Creates one if needed and stores the mapping.
 *
 * @param routedUserId - Routed's cookie-based user ID
 * @returns The memory-assistant user UUID, or null if creation failed
 */
export async function ensureMemoryUser(routedUserId: string): Promise<string | null> {
  // Check if we already have a mapping
  const existingId = getMemoryUserId(routedUserId);
  if (existingId) {
    return existingId;
  }

  // Create a new user in memory-assistant
  const memoryUserId = await createMemoryUser();
  if (!memoryUserId) {
    console.warn(`[memory-assistant] Failed to create user for routed=${routedUserId.slice(0, 8)}...`);
    return null;
  }

  // Store the mapping
  setUserMapping(routedUserId, memoryUserId);
  return memoryUserId;
}

/**
 * Create a conversation in the memory-assistant service.
 */
async function createConversation(memoryUserId: string): Promise<string | null> {
  const result = await memoryApiRequest<{ id: string }>("POST", "/v1/conversations", {
    user_id: memoryUserId,
  });
  return result?.id || null;
}

/**
 * Send a chat message to extract memories from user notes.
 * The memory-assistant will automatically extract and store relevant memories.
 *
 * @param routedUserId - Routed's user ID
 * @param note - The user's note (e.g., "i'm a budget conscious student")
 * @param context - Additional context about the trip
 */
export async function extractMemoriesFromNote(
  routedUserId: string,
  note: string,
  context?: NoteContext
): Promise<void> {
  if (!note?.trim()) {
    return;
  }

  try {
    // Ensure user exists in memory-assistant
    const memoryUserId = await ensureMemoryUser(routedUserId);
    if (!memoryUserId) {
      console.warn("[memory-assistant] Could not ensure user, skipping memory extraction");
      return;
    }

    // Create a conversation for this extraction
    const conversationId = await createConversation(memoryUserId);
    if (!conversationId) {
      console.warn("[memory-assistant] Could not create conversation, skipping memory extraction");
      return;
    }

    // Build a message that helps the LLM understand the context
    let contextMessage = `User note for trip planning`;
    if (context?.cityId) {
      contextMessage += ` in ${context.cityId}`;
    }
    if (context?.intent) {
      contextMessage += ` (${context.intent} trip)`;
    }
    contextMessage += `: "${note}"`;

    // Send to chat endpoint - this will extract and store memories
    const result = await memoryApiRequest<ChatResponse>("POST", "/v1/chat", {
      user_id: memoryUserId,
      conversation_id: conversationId,
      message: contextMessage,
    });

    if (result && result.stored_memories.length > 0) {
      console.log(
        `[memory-assistant] Extracted ${result.stored_memories.length} memories from note for user ${routedUserId.slice(0, 8)}...`
      );
    }
  } catch (error) {
    // Non-blocking - log error but don't throw
    console.error("[memory-assistant] extractMemoriesFromNote failed:", error);
  }
}

/**
 * Record a trip completion as an episode memory.
 * This helps build context about user travel patterns.
 *
 * @param routedUserId - Routed's user ID
 * @param tripData - Information about the completed trip
 */
export async function recordTripEpisode(
  routedUserId: string,
  tripData: TripEpisodeData
): Promise<void> {
  try {
    // Ensure user exists in memory-assistant
    const memoryUserId = await ensureMemoryUser(routedUserId);
    if (!memoryUserId) {
      console.warn("[memory-assistant] Could not ensure user, skipping trip episode");
      return;
    }

    // Create a conversation for this episode
    const conversationId = await createConversation(memoryUserId);
    if (!conversationId) {
      console.warn("[memory-assistant] Could not create conversation, skipping trip episode");
      return;
    }

    // Build a message describing the trip
    const status = tripData.success !== false ? "completed" : "abandoned";
    let message = `Trip ${status} in ${tripData.cityId}`;
    if (tripData.mode) {
      message += ` using ${tripData.mode}`;
    }
    if (tripData.stepsCompleted) {
      message += ` (${tripData.stepsCompleted} steps)`;
    }
    if (tripData.userNote) {
      message += `. User note: "${tripData.userNote}"`;
    }

    // Send to chat - will be processed as potential episode memory
    const result = await memoryApiRequest<ChatResponse>("POST", "/v1/chat", {
      user_id: memoryUserId,
      conversation_id: conversationId,
      message: message,
    });

    if (result) {
      console.log(
        `[memory-assistant] Recorded trip episode for user ${routedUserId.slice(0, 8)}... (${result.stored_memories.length} memories)`
      );
    }
  } catch (error) {
    // Non-blocking - log error but don't throw
    console.error("[memory-assistant] recordTripEpisode failed:", error);
  }
}

/**
 * Get memories relevant to a query (for future use in route recommendations).
 *
 * @param routedUserId - Routed's user ID
 * @param query - The query to search memories for (optional)
 * @param type - Filter by memory type (optional)
 * @returns List of relevant memories, or empty array on failure
 */
export async function getRelevantMemories(
  routedUserId: string,
  query?: string,
  type?: string
): Promise<MemoryResponse[]> {
  try {
    const memoryUserId = getMemoryUserId(routedUserId);
    if (!memoryUserId) {
      // User has no memory profile yet
      return [];
    }

    let path = `/v1/memories?user_id=${memoryUserId}`;
    if (type) {
      path += `&type=${type}`;
    }

    const result = await memoryApiRequest<MemoryListResponse>("GET", path);
    return result?.memories || [];
  } catch (error) {
    console.error("[memory-assistant] getRelevantMemories failed:", error);
    return [];
  }
}

/**
 * Get a summary of what the system has learned about a user.
 * Used for the UI transparency feature.
 *
 * @param routedUserId - Routed's user ID
 * @returns Summary of user memories, or null if not available
 */
export async function getUserMemorySummary(
  routedUserId: string
): Promise<MemorySummary | null> {
  try {
    const memoryUserId = getMemoryUserId(routedUserId);
    if (!memoryUserId) {
      // User has no memory profile yet
      return null;
    }

    const result = await memoryApiRequest<MemoryListResponse>(
      "GET",
      `/v1/memories?user_id=${memoryUserId}`
    );

    if (!result) {
      return null;
    }

    // Build summary from memories
    const byType: Record<string, number> = {};
    for (const memory of result.memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
    }

    // Get recent memories (last 5)
    const recent = result.memories.slice(0, 5);

    // Extract key highlights (high confidence preferences and constraints)
    const highlights = result.memories
      .filter(
        (m) =>
          m.confidence >= 0.8 &&
          (m.type === "preference" || m.type === "constraint" || m.type === "profile")
      )
      .slice(0, 5)
      .map((m) => m.text);

    return {
      total: result.total,
      byType,
      recent,
      highlights,
    };
  } catch (error) {
    console.error("[memory-assistant] getUserMemorySummary failed:", error);
    return null;
  }
}

/**
 * Delete a specific memory (for user control/privacy).
 *
 * @param routedUserId - Routed's user ID
 * @param memoryId - The memory-assistant memory ID to delete
 * @returns true if deleted, false otherwise
 */
export async function deleteMemory(
  routedUserId: string,
  memoryId: string
): Promise<boolean> {
  try {
    const memoryUserId = getMemoryUserId(routedUserId);
    if (!memoryUserId) {
      return false;
    }

    const result = await memoryApiRequest<{ status: string }>(
      "DELETE",
      `/v1/memories/${memoryId}?user_id=${memoryUserId}`
    );

    return result?.status === "deleted";
  } catch (error) {
    console.error("[memory-assistant] deleteMemory failed:", error);
    return false;
  }
}

/**
 * Get detour suggestions for a trip corridor.
 * Calls the Python detour suggest API with origin/destination coordinates.
 */
export async function getDetourSuggestions(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  category?: string,
  maxDetourMinutes?: number,
): Promise<DetourSuggestResponse | null> {
  return memoryApiRequest<DetourSuggestResponse>("POST", "/v1/detours/suggest", {
    origin: { lat: originLat, lng: originLng },
    destination: { lat: destLat, lng: destLng },
    max_detour_minutes: maxDetourMinutes ?? 15,
    filters: {
      category: category || "any",
    },
  });
}

/**
 * Check if memory-assistant service is healthy.
 */
export async function checkHealth(): Promise<boolean> {
  if (!isMemoryAssistantConfigured()) {
    return false;
  }

  try {
    const response = await fetch(`${MEMORY_ASSISTANT_URL}/health`, {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}
