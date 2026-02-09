import type { RouteStep } from "@shared/schema";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DIRECTIONS_API_URL = "https://maps.googleapis.com/maps/api/directions/json";
const PLACES_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

export type TravelMode = "walking" | "transit" | "driving" | "bicycling";

export interface GoogleMapsRoute {
  distance: { text: string; value: number }; // value in meters
  duration: { text: string; value: number }; // value in seconds
  steps: GoogleMapsStep[];
  fare?: { currency: string; value: number; text: string };
  departureTime?: string;
  arrivalTime?: string;
}

interface GoogleMapsStep {
  travelMode: string;
  distance: { text: string; value: number };
  duration: { text: string; value: number };
  htmlInstructions: string;
  startLocation: { lat: number; lng: number };
  endLocation: { lat: number; lng: number };
  transitDetails?: {
    departureStop: { name: string; location: { lat: number; lng: number } };
    arrivalStop: { name: string; location: { lat: number; lng: number } };
    departureTime?: { text: string; value: number };
    arrivalTime?: { text: string; value: number };
    line: {
      name: string;
      shortName?: string;
      vehicle: { type: string; name: string };
    };
    numStops: number;
  };
}

interface DirectionsResponse {
  routes: Array<{
    legs: Array<{
      distance: { text: string; value: number };
      duration: { text: string; value: number };
      departure_time?: { text: string; value: number };
      arrival_time?: { text: string; value: number };
      steps: Array<{
        travel_mode: string;
        distance: { text: string; value: number };
        duration: { text: string; value: number };
        html_instructions: string;
        start_location: { lat: number; lng: number };
        end_location: { lat: number; lng: number };
        transit_details?: {
          departure_stop: { name: string; location: { lat: number; lng: number } };
          arrival_stop: { name: string; location: { lat: number; lng: number } };
          departure_time?: { text: string; value: number };
          arrival_time?: { text: string; value: number };
          line: {
            name: string;
            short_name?: string;
            vehicle: { type: string; name: string };
          };
          num_stops: number;
        };
      }>;
    }>;
    fare?: { currency: string; value: number; text: string };
  }>;
  status: string;
  error_message?: string;
}

/**
 * Fetch directions from Google Maps Directions API
 */
export async function getDirections(
  origin: string,
  destination: string,
  mode: TravelMode,
  departureTime?: Date
): Promise<GoogleMapsRoute | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn("GOOGLE_MAPS_API_KEY not set, skipping Google Maps API call");
    return null;
  }

  const params = new URLSearchParams({
    origin,
    destination,
    mode,
    key: GOOGLE_MAPS_API_KEY,
  });

  // For transit, add departure time
  if (mode === "transit" && departureTime) {
    params.append("departure_time", Math.floor(departureTime.getTime() / 1000).toString());
  } else if (mode === "transit") {
    params.append("departure_time", Math.floor(Date.now() / 1000).toString());
  }

  try {
    const response = await fetch(`${DIRECTIONS_API_URL}?${params.toString()}`);
    const data: DirectionsResponse = await response.json();

    if (data.status !== "OK") {
      console.error(`Google Maps API error: ${data.status} - ${data.error_message || "Unknown error"}`);
      return null;
    }

    if (!data.routes.length || !data.routes[0].legs.length) {
      return null;
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    return {
      distance: leg.distance,
      duration: leg.duration,
      steps: leg.steps.map(mapGoogleStep),
      fare: route.fare,
      departureTime: leg.departure_time?.text,
      arrivalTime: leg.arrival_time?.text,
    };
  } catch (error) {
    console.error("Failed to fetch Google Maps directions:", error);
    return null;
  }
}

/**
 * Map Google Maps step to internal format
 */
function mapGoogleStep(step: DirectionsResponse["routes"][0]["legs"][0]["steps"][0]): GoogleMapsStep {
  return {
    travelMode: step.travel_mode,
    distance: step.distance,
    duration: step.duration,
    htmlInstructions: step.html_instructions,
    startLocation: step.start_location,
    endLocation: step.end_location,
    transitDetails: step.transit_details ? {
      departureStop: {
        name: step.transit_details.departure_stop.name,
        location: step.transit_details.departure_stop.location,
      },
      arrivalStop: {
        name: step.transit_details.arrival_stop.name,
        location: step.transit_details.arrival_stop.location,
      },
      departureTime: step.transit_details.departure_time,
      arrivalTime: step.transit_details.arrival_time,
      line: {
        name: step.transit_details.line.name,
        shortName: step.transit_details.line.short_name,
        vehicle: step.transit_details.line.vehicle,
      },
      numStops: step.transit_details.num_stops,
    } : undefined,
  };
}

/**
 * Convert Google Maps steps to Routed RouteStep format
 */
export function mapToRouteSteps(googleSteps: GoogleMapsStep[], origin: string, destination: string): RouteStep[] {
  return googleSteps.map((step, index) => {
    const isLastStep = index === googleSteps.length - 1;
    const stepType = mapTravelModeToStepType(step.travelMode);

    // Strip HTML tags from instructions
    const instruction = step.htmlInstructions.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    const routeStep: RouteStep = {
      type: stepType,
      instruction,
      duration: Math.ceil(step.duration.value / 60), // Convert seconds to minutes
      distance: step.distance.value,
    };

    // Add transit-specific details
    if (step.transitDetails) {
      const td = step.transitDetails;
      routeStep.line = td.line.shortName || td.line.name;
      routeStep.direction = td.arrivalStop.name;
      routeStep.stopsCount = td.numStops;
      routeStep.transitDetails = {
        departureStop: td.departureStop.name,
        arrivalStop: td.arrivalStop.name,
        departureTime: td.departureTime?.text,
        arrivalTime: td.arrivalTime?.text,
        vehicleType: td.line.vehicle.type,
      };
    }

    // Generate navigation deep link for each step
    const stepOrigin = index === 0 ? origin : `${step.startLocation.lat},${step.startLocation.lng}`;
    const stepDest = isLastStep ? destination : `${step.endLocation.lat},${step.endLocation.lng}`;
    routeStep.navigationDeepLink = generateGoogleMapsDeepLink(
      stepOrigin,
      stepDest,
      mapStepTypeToTravelMode(stepType)
    );

    // Add rideshare app deep link for driving steps
    if (stepType === "rideshare") {
      // Use Uber universal link as default rideshare app
      const params = new URLSearchParams();
      params.set("pickup[latitude]", step.startLocation.lat.toString());
      params.set("pickup[longitude]", step.startLocation.lng.toString());
      params.set("dropoff[latitude]", step.endLocation.lat.toString());
      params.set("dropoff[longitude]", step.endLocation.lng.toString());
      routeStep.deepLink = `https://m.uber.com/ul/?action=setPickup&${params.toString()}`;
    }

    return routeStep;
  });
}

/**
 * Map Google Maps travel mode to RouteStep type
 */
function mapTravelModeToStepType(travelMode: string): RouteStep["type"] {
  switch (travelMode.toUpperCase()) {
    case "WALKING":
      return "walk";
    case "TRANSIT":
      return "transit";
    case "DRIVING":
      return "rideshare";
    default:
      return "walk";
  }
}

/**
 * Create simplified rideshare steps (no turn-by-turn navigation)
 * For taxi/rideshare, the passenger doesn't need driving directions.
 */
export function createSimplifiedRideshareSteps(
  origin: string,
  destination: string,
  totalDurationMin: number,
  totalDistanceM: number,
  originCoords?: { lat: number; lng: number },
  destCoords?: { lat: number; lng: number }
): RouteStep[] {
  const steps: RouteStep[] = [];

  // Single step: the ride itself
  const rideStep: RouteStep = {
    type: "rideshare",
    instruction: `Ride from ${origin} to ${destination}`,
    duration: totalDurationMin,
    distance: totalDistanceM,
  };

  // Add deep link if we have coordinates
  if (originCoords && destCoords) {
    const params = new URLSearchParams();
    params.set("pickup[latitude]", originCoords.lat.toString());
    params.set("pickup[longitude]", originCoords.lng.toString());
    params.set("dropoff[latitude]", destCoords.lat.toString());
    params.set("dropoff[longitude]", destCoords.lng.toString());
    rideStep.deepLink = `https://m.uber.com/ul/?action=setPickup&${params.toString()}`;
  }

  steps.push(rideStep);

  return steps;
}

/**
 * Map RouteStep type to Google Maps travel mode
 */
function mapStepTypeToTravelMode(stepType: RouteStep["type"]): TravelMode {
  switch (stepType) {
    case "walk":
      return "walking";
    case "transit":
      return "transit";
    case "rideshare":
      return "driving";
    default:
      return "walking";
  }
}

/**
 * Generate Google Maps deep link for navigation
 */
export function generateGoogleMapsDeepLink(
  origin: string,
  destination: string,
  mode: TravelMode
): string {
  const params = new URLSearchParams({
    api: "1",
    origin: origin,
    destination: destination,
    travelmode: mode,
  });

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Map Routed mode to Google Maps travel mode
 */
export function routedModeToGoogleMode(mode: string): TravelMode {
  switch (mode) {
    case "walk":
      return "walking";
    case "transit":
      return "transit";
    case "rideshare":
      return "driving";
    case "bike":
      return "bicycling";
    case "mixed":
      return "transit"; // Default to transit for mixed
    default:
      return "transit";
  }
}

/**
 * Fetch multiple route options for AI to analyze
 */
export async function getMultipleRoutes(
  origin: string,
  destination: string,
  departureTime?: Date
): Promise<{ mode: TravelMode; route: GoogleMapsRoute }[]> {
  const modes: TravelMode[] = ["transit", "walking", "driving"];
  const results: { mode: TravelMode; route: GoogleMapsRoute }[] = [];

  for (const mode of modes) {
    const route = await getDirections(origin, destination, mode, departureTime);
    if (route) {
      results.push({ mode, route });
    }
  }

  return results;
}

// ============================================
// PLACES AUTOCOMPLETE
// ============================================

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface AutocompleteResponse {
  predictions: Array<{
    place_id: string;
    description: string;
    structured_formatting: {
      main_text: string;
      secondary_text: string;
    };
  }>;
  status: string;
  error_message?: string;
}

/**
 * Get place autocomplete suggestions
 */
export async function getPlaceAutocomplete(
  input: string,
  cityBias?: string
): Promise<PlaceSuggestion[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn("GOOGLE_MAPS_API_KEY not set, skipping autocomplete");
    return [];
  }

  if (!input || input.length < 2) {
    return [];
  }

  const params = new URLSearchParams({
    input,
    key: GOOGLE_MAPS_API_KEY,
    types: "geocode|establishment",
  });

  // Add city bias if provided
  if (cityBias) {
    const cityCoords: Record<string, string> = {
      "nyc": "40.7128,-74.0060",
      "new-york": "40.7128,-74.0060",
      "tokyo": "35.6762,139.6503",
      "london": "51.5074,-0.1278",
      "paris": "48.8566,2.3522",
      "berlin": "52.5200,13.4050",
      "san-francisco": "37.7749,-122.4194",
      "los-angeles": "34.0522,-118.2437",
    };
    const coords = cityCoords[cityBias];
    if (coords) {
      params.append("location", coords);
      params.append("radius", "50000"); // 50km radius
    }
  }

  try {
    const response = await fetch(`${PLACES_AUTOCOMPLETE_URL}?${params.toString()}`);
    const data: AutocompleteResponse = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error(`Places API error: ${data.status} - ${data.error_message || ""}`);
      return [];
    }

    return data.predictions.map((p) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting.main_text,
      secondaryText: p.structured_formatting.secondary_text || "",
    }));
  } catch (error) {
    console.error("Failed to fetch place autocomplete:", error);
    return [];
  }
}

interface PlaceDetailsResponse {
  result: {
    formatted_address: string;
    geometry: {
      location: { lat: number; lng: number };
    };
    name: string;
  };
  status: string;
}

/**
 * Get place details by place ID
 */
export async function getPlaceDetails(placeId: string): Promise<{
  address: string;
  name: string;
  lat: number;
  lng: number;
} | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    return null;
  }

  const params = new URLSearchParams({
    place_id: placeId,
    key: GOOGLE_MAPS_API_KEY,
    fields: "formatted_address,geometry,name",
  });

  try {
    const response = await fetch(`${PLACES_DETAILS_URL}?${params.toString()}`);
    const data: PlaceDetailsResponse = await response.json();

    if (data.status !== "OK") {
      return null;
    }

    return {
      address: data.result.formatted_address,
      name: data.result.name,
      lat: data.result.geometry.location.lat,
      lng: data.result.geometry.location.lng,
    };
  } catch (error) {
    console.error("Failed to fetch place details:", error);
    return null;
  }
}

// ============================================
// PLACES TEXT SEARCH (v1 API)
// ============================================

export interface PlacesTextResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  rating: number | null;
  priceLevel: number | null;
}

/**
 * Search for places using the Google Places API v1 Text Search.
 * Used as a fallback when curated POI data doesn't match user preferences.
 */
export async function searchPlacesText(
  query: string,
  locationBias?: { lat: number; lng: number },
  maxResults: number = 3
): Promise<PlacesTextResult[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn("GOOGLE_MAPS_API_KEY not set, skipping Places text search");
    return [];
  }

  try {
    const body: Record<string, unknown> = {
      textQuery: query,
      maxResultCount: maxResults,
    };

    if (locationBias) {
      body.locationBias = {
        circle: {
          center: { latitude: locationBias.lat, longitude: locationBias.lng },
          radius: 5000,
        },
      };
    }

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.priceLevel",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!data.places || !Array.isArray(data.places)) {
      return [];
    }

    return data.places.map((place: any) => ({
      placeId: place.id || "",
      name: place.displayName?.text || "Unknown",
      lat: place.location?.latitude ?? 0,
      lng: place.location?.longitude ?? 0,
      address: place.formattedAddress || null,
      rating: place.rating ?? null,
      priceLevel: place.priceLevel ? parsePriceLevel(place.priceLevel) : null,
    }));
  } catch (error) {
    console.error("Failed to fetch Places text search:", error);
    return [];
  }
}

function parsePriceLevel(level: string | number): number | null {
  if (typeof level === "number") return level;
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[level] ?? null;
}
