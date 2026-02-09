/**
 * PROVIDER ADAPTERS
 *
 * Provider-specific adapters for transit, ridehail, and bike services.
 * Each adapter provides deep links, fare estimates, and activation stubs.
 */

export * from "./types";
export * from "./catalog";

// Re-export individual adapters for direct access
export * from "./adapters/nyc";
export * from "./adapters/berlin";
export * from "./adapters/tokyo";
