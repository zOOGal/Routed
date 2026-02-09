/**
 * In-memory mapping between Routed cookie IDs and memory-assistant UUIDs.
 *
 * This provides a simple translation layer so that Routed's cookie-based
 * user identification can work with the memory-assistant's UUID-based users.
 *
 * In production, this would be persisted to the database.
 */

// Map from Routed cookie userId to memory-assistant UUID
const routedToMemoryMap = new Map<string, string>();

// Reverse map for lookups
const memoryToRoutedMap = new Map<string, string>();

/**
 * Get the memory-assistant user ID for a Routed user.
 * Returns undefined if no mapping exists.
 */
export function getMemoryUserId(routedUserId: string): string | undefined {
  return routedToMemoryMap.get(routedUserId);
}

/**
 * Get the Routed user ID for a memory-assistant user.
 * Returns undefined if no mapping exists.
 */
export function getRoutedUserId(memoryUserId: string): string | undefined {
  return memoryToRoutedMap.get(memoryUserId);
}

/**
 * Store a mapping between Routed and memory-assistant user IDs.
 */
export function setUserMapping(routedUserId: string, memoryUserId: string): void {
  routedToMemoryMap.set(routedUserId, memoryUserId);
  memoryToRoutedMap.set(memoryUserId, routedUserId);
  console.log(`[memory-mapping] Linked routed=${routedUserId.slice(0, 8)}... to memory=${memoryUserId.slice(0, 8)}...`);
}

/**
 * Check if a Routed user has a memory-assistant mapping.
 */
export function hasMemoryMapping(routedUserId: string): boolean {
  return routedToMemoryMap.has(routedUserId);
}

/**
 * Remove a user mapping (for cleanup/testing).
 */
export function removeUserMapping(routedUserId: string): void {
  const memoryUserId = routedToMemoryMap.get(routedUserId);
  if (memoryUserId) {
    routedToMemoryMap.delete(routedUserId);
    memoryToRoutedMap.delete(memoryUserId);
  }
}

/**
 * Get all current mappings (for debugging).
 */
export function getAllMappings(): Array<{ routedId: string; memoryId: string }> {
  return Array.from(routedToMemoryMap.entries()).map(([routedId, memoryId]) => ({
    routedId,
    memoryId,
  }));
}
