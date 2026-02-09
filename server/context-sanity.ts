/**
 * CONTEXT SANITY LAYER
 *
 * Prevents impossible city/provider mismatches by:
 * 1. Resolving places with strict city context
 * 2. Detecting city mismatches before route planning
 * 3. Validating that transit providers match the selected city
 *
 * FLOW:
 * Input → Resolve Places → Mismatch Gate → Route Planning → Output Validation
 */

import { getCityProfile } from "./city-intelligence";
import type { CityProfile } from "@shared/schema";

// ============================================
// TYPES
// ============================================

export interface ResolvedPlace {
  name: string;
  query: string;  // Original query
  lat: number | null;
  lng: number | null;
  inferredCityName: string | null;
  inferredCityCode: string | null;
  inferredCountryCode: string | null;
  confidence: number;  // 0..1
  source: "lookup" | "geocode" | "heuristic";
}

export interface CityMismatchResult {
  mismatch: boolean;
  suggestedCityCode?: string;
  suggestedCityName?: string;
  confidence: number;
  reason: string;
  origin: ResolvedPlace;
  destination: ResolvedPlace;
}

// ============================================
// KNOWN PLACES LOOKUP (for common landmarks)
// ============================================

interface KnownPlace {
  cityCode: string;
  cityName: string;
  countryCode: string;
  lat: number;
  lng: number;
  aliases: string[];
}

const KNOWN_PLACES: Record<string, KnownPlace> = {
  // New York City
  "central park": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.7829,
    lng: -73.9654,
    aliases: ["central park nyc", "central park new york"],
  },
  "times square": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.7580,
    lng: -73.9855,
    aliases: ["times sq", "42nd street"],
  },
  "the met": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.7794,
    lng: -73.9632,
    aliases: ["metropolitan museum", "met museum", "metropolitan museum of art"],
  },
  "empire state building": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.7484,
    lng: -73.9857,
    aliases: ["empire state", "esb"],
  },
  "grand central": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.7527,
    lng: -73.9772,
    aliases: ["grand central terminal", "grand central station"],
  },
  "brooklyn bridge": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.7061,
    lng: -73.9969,
    aliases: [],
  },
  "statue of liberty": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.6892,
    lng: -74.0445,
    aliases: ["liberty island"],
  },
  "jfk airport": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.6413,
    lng: -73.7781,
    aliases: ["jfk", "kennedy airport", "john f kennedy"],
  },
  "penn station": {
    cityCode: "nyc",
    cityName: "New York City",
    countryCode: "US",
    lat: 40.7506,
    lng: -73.9935,
    aliases: ["pennsylvania station", "penn sta"],
  },

  // Berlin
  "brandenburger tor": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5163,
    lng: 13.3777,
    aliases: ["brandenburg gate", "brandenburger gate"],
  },
  "alexanderplatz": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5219,
    lng: 13.4132,
    aliases: ["alex", "alexanderplatz berlin"],
  },
  "berlin hauptbahnhof": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5250,
    lng: 13.3695,
    aliases: ["hauptbahnhof", "berlin central station", "berlin hbf"],
  },
  "checkpoint charlie": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5075,
    lng: 13.3903,
    aliases: [],
  },
  "potsdamer platz": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5096,
    lng: 13.3761,
    aliases: [],
  },
  "east side gallery": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5052,
    lng: 13.4397,
    aliases: ["berlin wall", "east side"],
  },
  "reichstag": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5186,
    lng: 13.3761,
    aliases: ["reichstag building", "bundestag"],
  },
  "tegel airport": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.5597,
    lng: 13.2877,
    aliases: ["txl", "berlin tegel"],
  },
  "ber airport": {
    cityCode: "berlin",
    cityName: "Berlin",
    countryCode: "DE",
    lat: 52.3667,
    lng: 13.5033,
    aliases: ["berlin brandenburg airport", "willy brandt airport", "schönefeld"],
  },

  // Tokyo
  "shibuya crossing": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.6595,
    lng: 139.7004,
    aliases: ["shibuya", "shibuya station"],
  },
  "shinjuku station": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.6896,
    lng: 139.7006,
    aliases: ["shinjuku", "shinjuku sta"],
  },
  "tokyo station": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.6812,
    lng: 139.7671,
    aliases: [],
  },
  "tokyo tower": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.6586,
    lng: 139.7454,
    aliases: [],
  },
  "senso-ji": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.7148,
    lng: 139.7967,
    aliases: ["sensoji", "asakusa temple", "asakusa"],
  },
  "akihabara": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.7023,
    lng: 139.7745,
    aliases: ["akiba", "akihabara station"],
  },
  "meiji shrine": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.6764,
    lng: 139.6993,
    aliases: ["meiji jingu", "harajuku shrine"],
  },
  "narita airport": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.7720,
    lng: 140.3929,
    aliases: ["nrt", "narita"],
  },
  "haneda airport": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    countryCode: "JP",
    lat: 35.5494,
    lng: 139.7798,
    aliases: ["hnd", "tokyo haneda"],
  },
};

// City-specific keywords for heuristic detection
const CITY_KEYWORDS: Record<string, string[]> = {
  nyc: [
    "manhattan", "brooklyn", "queens", "bronx", "staten island",
    "new york", "ny ", "nyc", "fifth avenue", "5th avenue",
    "broadway", "harlem", "soho", "tribeca", "chelsea",
    "williamsburg", "wall street", "financial district",
    "upper east side", "upper west side", "midtown",
    "lower east side", "greenwich village", "east village",
  ],
  berlin: [
    "berlin", "kreuzberg", "mitte", "prenzlauer", "charlottenburg",
    "friedrichshain", "neukölln", "tempelhof", "schöneberg",
    "wedding", "moabit", "spandau", "köpenick", "lichtenberg",
    "pankow", "steglitz", "zehlendorf",
  ],
  tokyo: [
    "tokyo", "shibuya", "shinjuku", "ginza", "akihabara",
    "roppongi", "harajuku", "ikebukuro", "ueno", "asakusa",
    "odaiba", "chiyoda", "minato", "meguro", "setagaya",
    "nakano", "nerima", "sumida", "koto", "shinagawa",
  ],
};

// ============================================
// PLACE RESOLUTION
// ============================================

/**
 * Resolve a place query with city context
 *
 * @param query The place name/address to resolve
 * @param selectedCityCode The currently selected city
 * @returns Resolved place with inferred city information
 */
export function resolvePlace(query: string, selectedCityCode: string): ResolvedPlace {
  const normalizedQuery = query.toLowerCase().trim();

  // 1. Try known places lookup first (highest confidence)
  const knownPlace = lookupKnownPlace(normalizedQuery);
  if (knownPlace) {
    return {
      name: query,
      query,
      lat: knownPlace.lat,
      lng: knownPlace.lng,
      inferredCityName: knownPlace.cityName,
      inferredCityCode: knownPlace.cityCode,
      inferredCountryCode: knownPlace.countryCode,
      confidence: 0.95,
      source: "lookup",
    };
  }

  // 2. Try heuristic keyword matching (medium confidence)
  const heuristicResult = detectCityByKeywords(normalizedQuery);
  if (heuristicResult) {
    const cityProfile = getCityProfile(heuristicResult.cityCode);
    return {
      name: query,
      query,
      lat: null,
      lng: null,
      inferredCityName: cityProfile?.name || heuristicResult.cityCode,
      inferredCityCode: heuristicResult.cityCode,
      inferredCountryCode: heuristicResult.countryCode,
      confidence: heuristicResult.confidence,
      source: "heuristic",
    };
  }

  // 3. If contains city name in the query (from autocomplete selection)
  const cityFromQuery = extractCityFromQuery(normalizedQuery);
  if (cityFromQuery) {
    const cityProfile = getCityProfile(cityFromQuery.cityCode);
    return {
      name: query,
      query,
      lat: null,
      lng: null,
      inferredCityName: cityProfile?.name || cityFromQuery.cityName,
      inferredCityCode: cityFromQuery.cityCode,
      inferredCountryCode: cityFromQuery.countryCode,
      confidence: 0.85,
      source: "heuristic",
    };
  }

  // 4. Cannot determine city - assume selected city with low confidence
  const selectedProfile = getCityProfile(selectedCityCode);
  return {
    name: query,
    query,
    lat: null,
    lng: null,
    inferredCityName: selectedProfile?.name || null,
    inferredCityCode: selectedCityCode,
    inferredCountryCode: null,
    confidence: 0.3,  // Low confidence - couldn't verify
    source: "heuristic",
  };
}

/**
 * Look up a known place by name or alias
 */
function lookupKnownPlace(query: string): KnownPlace | null {
  // Direct match
  if (KNOWN_PLACES[query]) {
    return KNOWN_PLACES[query];
  }

  // Check aliases
  for (const [_, place] of Object.entries(KNOWN_PLACES)) {
    if (place.aliases.some(alias => query.includes(alias) || alias.includes(query))) {
      return place;
    }
  }

  // Partial match on main names
  for (const [name, place] of Object.entries(KNOWN_PLACES)) {
    if (query.includes(name) || name.includes(query)) {
      return place;
    }
  }

  return null;
}

/**
 * Detect city from keywords in query
 */
function detectCityByKeywords(query: string): { cityCode: string; countryCode: string; confidence: number } | null {
  for (const [cityCode, keywords] of Object.entries(CITY_KEYWORDS)) {
    const matches = keywords.filter(kw => query.includes(kw));
    if (matches.length > 0) {
      // More matches = higher confidence
      const confidence = Math.min(0.5 + matches.length * 0.1, 0.85);
      const countryCode = cityCode === "nyc" ? "US" : cityCode === "berlin" ? "DE" : "JP";
      return { cityCode, countryCode, confidence };
    }
  }
  return null;
}

/**
 * Extract city from full address string (e.g., from autocomplete)
 */
function extractCityFromQuery(query: string): { cityCode: string; cityName: string; countryCode: string } | null {
  const cityMappings: Array<{ pattern: RegExp; cityCode: string; cityName: string; countryCode: string }> = [
    { pattern: /new york|ny,|nyc|, ny /i, cityCode: "nyc", cityName: "New York City", countryCode: "US" },
    { pattern: /berlin|germany/i, cityCode: "berlin", cityName: "Berlin", countryCode: "DE" },
    { pattern: /tokyo|japan/i, cityCode: "tokyo", cityName: "Tokyo", countryCode: "JP" },
  ];

  for (const mapping of cityMappings) {
    if (mapping.pattern.test(query)) {
      return { cityCode: mapping.cityCode, cityName: mapping.cityName, countryCode: mapping.countryCode };
    }
  }

  return null;
}

// ============================================
// CITY MISMATCH DETECTION
// ============================================

/**
 * Detect if there's a city mismatch between selected city and resolved places
 *
 * @param selectedCityCode The currently selected city
 * @param origin Origin place query
 * @param destination Destination place query
 * @returns Mismatch detection result
 */
export function detectCityMismatch(
  selectedCityCode: string,
  origin: string,
  destination: string
): CityMismatchResult {
  const originResolved = resolvePlace(origin, selectedCityCode);
  const destResolved = resolvePlace(destination, selectedCityCode);

  const selectedProfile = getCityProfile(selectedCityCode);
  const selectedCityName = selectedProfile?.name || selectedCityCode;

  // Check if either location has high-confidence mismatch
  const originMismatch = originResolved.inferredCityCode !== selectedCityCode &&
    originResolved.confidence >= 0.8;
  const destMismatch = destResolved.inferredCityCode !== selectedCityCode &&
    destResolved.confidence >= 0.8;

  if (originMismatch || destMismatch) {
    // Determine suggested city (prefer destination's city if both mismatch)
    const suggestedCityCode = destMismatch
      ? destResolved.inferredCityCode
      : originResolved.inferredCityCode;
    const suggestedCityName = destMismatch
      ? destResolved.inferredCityName
      : originResolved.inferredCityName;

    // Build reason
    let reason: string;
    if (originMismatch && destMismatch) {
      reason = `Both "${origin}" and "${destination}" appear to be in ${suggestedCityName}, not ${selectedCityName}.`;
    } else if (destMismatch) {
      reason = `"${destination}" appears to be in ${suggestedCityName}, not ${selectedCityName}.`;
    } else {
      reason = `"${origin}" appears to be in ${suggestedCityName}, not ${selectedCityName}.`;
    }

    return {
      mismatch: true,
      suggestedCityCode: suggestedCityCode || undefined,
      suggestedCityName: suggestedCityName || undefined,
      confidence: Math.max(originResolved.confidence, destResolved.confidence),
      reason,
      origin: originResolved,
      destination: destResolved,
    };
  }

  // No mismatch detected
  return {
    mismatch: false,
    confidence: Math.min(originResolved.confidence, destResolved.confidence),
    reason: "Places appear to be in the selected city.",
    origin: originResolved,
    destination: destResolved,
  };
}

// ============================================
// PROVIDER NAMING VALIDATION
// ============================================

/**
 * Forbidden transit names per city
 * If any of these appear in output for the wrong city, it's a bug
 */
const FORBIDDEN_TRANSIT_NAMES: Record<string, string[]> = {
  nyc: ["U-Bahn", "S-Bahn", "BVG", "JR ", "Yamanote", "Metro (Tokyo)", "Toei"],
  berlin: ["MTA", "Subway (NYC)", "PATH", "LIRR", "Metro-North", "JR ", "Yamanote"],
  tokyo: ["MTA", "Subway (NYC)", "U-Bahn", "S-Bahn", "BVG", "PATH"],
};

/**
 * Allowed transit names per city
 */
const ALLOWED_TRANSIT_NAMES: Record<string, string[]> = {
  nyc: ["Subway", "MTA", "Bus", "PATH", "LIRR", "Metro-North", "Ferry", "Express Bus"],
  berlin: ["U-Bahn", "S-Bahn", "Tram", "Bus", "Regional Rail", "RE", "RB", "BVG"],
  tokyo: ["JR", "Metro", "Toei", "Bus", "Yamanote", "Chuo", "Shinkansen", "Private Railways"],
};

export interface TransitValidationResult {
  valid: boolean;
  violations: string[];
  cityCode: string;
}

/**
 * Validate that transit names in the output match the selected city
 *
 * @param cityCode Selected city code
 * @param content Text content to validate (summary, steps, etc.)
 * @returns Validation result
 */
export function validateTransitNaming(cityCode: string, content: string): TransitValidationResult {
  const forbidden = FORBIDDEN_TRANSIT_NAMES[cityCode] || [];
  const violations: string[] = [];

  for (const name of forbidden) {
    if (content.includes(name)) {
      violations.push(`Found "${name}" which is not valid for ${cityCode}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    cityCode,
  };
}

/**
 * Sanitize transit name for a specific city
 * Replaces incorrect transit names with generic terms
 *
 * @param transitName The transit name from the route
 * @param cityCode The selected city
 * @returns Sanitized transit name
 */
export function sanitizeTransitName(transitName: string, cityCode: string): string {
  const forbidden = FORBIDDEN_TRANSIT_NAMES[cityCode] || [];

  for (const name of forbidden) {
    if (transitName.includes(name)) {
      // Replace with generic "Transit"
      console.warn(`[Context Sanity] Sanitized forbidden transit name "${name}" for city ${cityCode}`);
      return "Transit";
    }
  }

  return transitName;
}

// ============================================
// SANITY GATE (blocks invalid requests)
// ============================================

export interface SanityGateResult {
  passed: boolean;
  blockReason?: string;
  mismatch?: CityMismatchResult;
  transitValidation?: TransitValidationResult;
}

/**
 * Run all sanity checks before route planning
 *
 * @param selectedCityCode The selected city
 * @param origin Origin query
 * @param destination Destination query
 * @returns Gate result - if passed is false, do NOT proceed with planning
 */
export function runSanityGate(
  selectedCityCode: string,
  origin: string,
  destination: string
): SanityGateResult {
  // Check city mismatch
  const mismatch = detectCityMismatch(selectedCityCode, origin, destination);

  if (mismatch.mismatch) {
    return {
      passed: false,
      blockReason: mismatch.reason,
      mismatch,
    };
  }

  return {
    passed: true,
    mismatch,
  };
}

/**
 * Validate final output before returning to user
 *
 * @param cityCode Selected city
 * @param recommendation The route recommendation
 * @returns Validation result with any issues found
 */
export function validateFinalOutput(
  cityCode: string,
  recommendation: { summary: string; steps: Array<{ instruction: string; line?: string }> }
): TransitValidationResult {
  // Collect all text content
  const contentParts = [
    recommendation.summary,
    ...recommendation.steps.map(s => s.instruction),
    ...recommendation.steps.filter(s => s.line).map(s => s.line!),
  ];
  const fullContent = contentParts.join(" ");

  return validateTransitNaming(cityCode, fullContent);
}
