/**
 * RESOLVE PLACES SKILL
 *
 * Resolves origin and destination text into structured place data
 * with inferred city codes and confidence scores.
 *
 * DETERMINISTIC: Uses known landmarks lookup and keyword heuristics.
 * LLM: Not used (could be added for ambiguous cases).
 */

import { z } from "zod";
import type { Skill, SkillContext, ResolvedPlaceOutput } from "./types";
import { ResolvedPlaceSchema } from "./types";

// ============================================
// SCHEMAS
// ============================================

const ResolvePlacesInputSchema = z.object({
  selectedCityCode: z.string(),
  originText: z.string().optional(),
  destinationText: z.string(),
});

const ResolvePlacesOutputSchema = z.object({
  origin: ResolvedPlaceSchema.nullable(),
  destination: ResolvedPlaceSchema,
  inferredCityCode: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ResolvePlacesInput = z.infer<typeof ResolvePlacesInputSchema>;
export type ResolvePlacesOutput = z.infer<typeof ResolvePlacesOutputSchema>;

// ============================================
// KNOWN PLACES LOOKUP
// ============================================

interface KnownPlace {
  cityCode: string;
  cityName: string;
  lat: number;
  lng: number;
  aliases: string[];
}

const KNOWN_PLACES: Record<string, KnownPlace> = {
  // New York City
  "central park": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.7829,
    lng: -73.9654,
    aliases: ["central park nyc", "central park new york"],
  },
  "times square": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.758,
    lng: -73.9855,
    aliases: ["times sq", "42nd street"],
  },
  "the met": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.7794,
    lng: -73.9632,
    aliases: ["metropolitan museum", "met museum", "metropolitan museum of art"],
  },
  "empire state building": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.7484,
    lng: -73.9857,
    aliases: ["empire state", "esb"],
  },
  "grand central": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.7527,
    lng: -73.9772,
    aliases: ["grand central terminal", "grand central station"],
  },
  "brooklyn bridge": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.7061,
    lng: -73.9969,
    aliases: [],
  },
  "statue of liberty": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.6892,
    lng: -74.0445,
    aliases: ["liberty island"],
  },
  "jfk airport": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.6413,
    lng: -73.7781,
    aliases: ["jfk", "kennedy airport"],
  },
  "penn station": {
    cityCode: "nyc",
    cityName: "New York City",
    lat: 40.7506,
    lng: -73.9935,
    aliases: ["pennsylvania station"],
  },

  // Berlin
  "brandenburger tor": {
    cityCode: "berlin",
    cityName: "Berlin",
    lat: 52.5163,
    lng: 13.3777,
    aliases: ["brandenburg gate"],
  },
  "alexanderplatz": {
    cityCode: "berlin",
    cityName: "Berlin",
    lat: 52.5219,
    lng: 13.4132,
    aliases: ["alex"],
  },
  "berlin hauptbahnhof": {
    cityCode: "berlin",
    cityName: "Berlin",
    lat: 52.525,
    lng: 13.3695,
    aliases: ["hauptbahnhof", "berlin central station", "berlin hbf"],
  },
  "checkpoint charlie": {
    cityCode: "berlin",
    cityName: "Berlin",
    lat: 52.5075,
    lng: 13.3903,
    aliases: [],
  },
  "potsdamer platz": {
    cityCode: "berlin",
    cityName: "Berlin",
    lat: 52.5096,
    lng: 13.3761,
    aliases: [],
  },
  "east side gallery": {
    cityCode: "berlin",
    cityName: "Berlin",
    lat: 52.5052,
    lng: 13.4397,
    aliases: ["berlin wall"],
  },
  reichstag: {
    cityCode: "berlin",
    cityName: "Berlin",
    lat: 52.5186,
    lng: 13.3761,
    aliases: ["reichstag building", "bundestag"],
  },

  // Tokyo
  "shibuya crossing": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    lat: 35.6595,
    lng: 139.7004,
    aliases: ["shibuya", "shibuya station"],
  },
  "shinjuku station": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    lat: 35.6896,
    lng: 139.7006,
    aliases: ["shinjuku"],
  },
  "tokyo station": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    lat: 35.6812,
    lng: 139.7671,
    aliases: [],
  },
  "tokyo tower": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    lat: 35.6586,
    lng: 139.7454,
    aliases: [],
  },
  "senso-ji": {
    cityCode: "tokyo",
    cityName: "Tokyo",
    lat: 35.7148,
    lng: 139.7967,
    aliases: ["sensoji", "asakusa temple", "asakusa"],
  },
  akihabara: {
    cityCode: "tokyo",
    cityName: "Tokyo",
    lat: 35.7023,
    lng: 139.7745,
    aliases: ["akiba"],
  },
};

// City-specific keywords
const CITY_KEYWORDS: Record<string, string[]> = {
  nyc: [
    "manhattan",
    "brooklyn",
    "queens",
    "bronx",
    "new york",
    "nyc",
    "fifth avenue",
    "broadway",
    "harlem",
    "soho",
    "tribeca",
    "chelsea",
    "williamsburg",
    "wall street",
    "midtown",
  ],
  berlin: [
    "berlin",
    "kreuzberg",
    "mitte",
    "prenzlauer",
    "charlottenburg",
    "friedrichshain",
    "neukölln",
    "tempelhof",
    "schöneberg",
  ],
  tokyo: [
    "tokyo",
    "shibuya",
    "shinjuku",
    "ginza",
    "akihabara",
    "roppongi",
    "harajuku",
    "ikebukuro",
    "ueno",
    "asakusa",
    "odaiba",
  ],
};

// ============================================
// RESOLUTION LOGIC
// ============================================

function resolvePlace(
  query: string,
  selectedCityCode: string,
  getCityProfile: SkillContext["getCityProfile"]
): ResolvedPlaceOutput {
  const normalized = query.toLowerCase().trim();

  // 1. Known places lookup (highest confidence)
  const knownPlace = lookupKnownPlace(normalized);
  if (knownPlace) {
    return {
      name: query,
      query,
      lat: knownPlace.lat,
      lng: knownPlace.lng,
      inferredCityName: knownPlace.cityName,
      inferredCityCode: knownPlace.cityCode,
      confidence: 0.95,
      source: "lookup",
    };
  }

  // 2. Keyword heuristic (medium confidence)
  const keywordMatch = detectCityByKeywords(normalized);
  if (keywordMatch) {
    const profile = getCityProfile(keywordMatch.cityCode);
    return {
      name: query,
      query,
      lat: null,
      lng: null,
      inferredCityName: profile?.name || keywordMatch.cityCode,
      inferredCityCode: keywordMatch.cityCode,
      confidence: keywordMatch.confidence,
      source: "heuristic",
    };
  }

  // 3. Fall back to selected city (low confidence)
  const selectedProfile = getCityProfile(selectedCityCode);
  return {
    name: query,
    query,
    lat: null,
    lng: null,
    inferredCityName: selectedProfile?.name || null,
    inferredCityCode: selectedCityCode,
    confidence: 0.3,
    source: "heuristic",
  };
}

function lookupKnownPlace(query: string): KnownPlace | null {
  // Direct match
  if (KNOWN_PLACES[query]) {
    return KNOWN_PLACES[query];
  }

  // Check aliases
  for (const place of Object.values(KNOWN_PLACES)) {
    if (place.aliases.some((alias) => query.includes(alias) || alias.includes(query))) {
      return place;
    }
  }

  // Partial match
  for (const [name, place] of Object.entries(KNOWN_PLACES)) {
    if (query.includes(name) || name.includes(query)) {
      return place;
    }
  }

  return null;
}

function detectCityByKeywords(
  query: string
): { cityCode: string; confidence: number } | null {
  for (const [cityCode, keywords] of Object.entries(CITY_KEYWORDS)) {
    const matches = keywords.filter((kw) => query.includes(kw));
    if (matches.length > 0) {
      const confidence = Math.min(0.5 + matches.length * 0.1, 0.85);
      return { cityCode, confidence };
    }
  }
  return null;
}

// ============================================
// SKILL DEFINITION
// ============================================

export const resolvePlacesSkill: Skill<ResolvePlacesInput, ResolvePlacesOutput> = {
  name: "resolvePlaces",

  inputSchema: ResolvePlacesInputSchema,
  outputSchema: ResolvePlacesOutputSchema,

  async run(ctx, input) {
    const notes: string[] = [];

    // Resolve destination (required)
    const destination = resolvePlace(
      input.destinationText,
      input.selectedCityCode,
      ctx.getCityProfile
    );
    notes.push(`Destination resolved: ${destination.inferredCityCode} (${destination.confidence})`);

    // Resolve origin if provided
    let origin: ResolvedPlaceOutput | null = null;
    if (input.originText) {
      origin = resolvePlace(input.originText, input.selectedCityCode, ctx.getCityProfile);
      notes.push(`Origin resolved: ${origin.inferredCityCode} (${origin.confidence})`);
    }

    // Determine inferred city (prefer higher confidence)
    let inferredCityCode = input.selectedCityCode;
    let maxConfidence = 0;

    if (destination.confidence > maxConfidence) {
      maxConfidence = destination.confidence;
      inferredCityCode = destination.inferredCityCode || input.selectedCityCode;
    }
    if (origin && origin.confidence > maxConfidence) {
      maxConfidence = origin.confidence;
      inferredCityCode = origin.inferredCityCode || input.selectedCityCode;
    }

    return {
      output: {
        origin,
        destination,
        inferredCityCode,
        confidence: maxConfidence,
      },
      meta: {
        ok: true,
        usedFallback: false,
        notes,
      },
    };
  },

  fallback(input) {
    return {
      origin: input.originText
        ? {
            name: input.originText,
            query: input.originText,
            lat: null,
            lng: null,
            inferredCityName: null,
            inferredCityCode: input.selectedCityCode,
            confidence: 0.1,
            source: "heuristic" as const,
          }
        : null,
      destination: {
        name: input.destinationText,
        query: input.destinationText,
        lat: null,
        lng: null,
        inferredCityName: null,
        inferredCityCode: input.selectedCityCode,
        confidence: 0.1,
        source: "heuristic" as const,
      },
      inferredCityCode: input.selectedCityCode,
      confidence: 0.1,
    };
  },
};
