import type { RouteStep } from "@shared/schema";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DIRECTIONS_API_URL = "https://maps.googleapis.com/maps/api/directions/json";

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
 * Convert Google Maps steps to Nomadi RouteStep format
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
 * Map Nomadi mode to Google Maps travel mode
 */
export function nomadiModeToGoogleMode(mode: string): TravelMode {
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
