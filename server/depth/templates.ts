import type { TripIntent, RouteStep } from "@shared/schema";
import type { DepthLayerInput } from "./types";

// ============================================
// AGENT PRESENCE LINES
// ============================================

export function generateAgentPresenceLine(input: DepthLayerInput): string {
  const { intent, weather, isRushHour, isNightTime, userNote, recommendation } = input;

  // Check if user wants to walk
  const wantsToWalk = userNote && (
    userNote.toLowerCase().includes("walk") ||
    userNote.toLowerCase().includes("stroll") ||
    userNote.toLowerCase().includes("stretch") ||
    userNote.toLowerCase().includes("scenic")
  );

  // User note takes priority — acknowledge what they told us
  if (userNote) {
    const note = userNote.toLowerCase();
    
    // WALKING PREFERENCE - Handle first
    if (wantsToWalk) {
      // Check if we gave them a walking route
      const isWalkRoute = recommendation.mode === "walk";
      const walkSteps = recommendation.steps.filter((s) => s.type === "walk");
      const totalWalkMin = walkSteps.reduce((sum, s) => sum + s.duration, 0);
      
      if (isWalkRoute) {
        if (weather.temperature < 5) {
          return "Nice walk for you — bundle up, it's chilly!";
        }
        if (weather.condition === "rain") {
          return "Here's your stroll — might want an umbrella.";
        }
        return "Great day for a walk — enjoy!";
      }
      
      // Transit with some walking
      if (totalWalkMin >= 5) {
        if (weather.temperature < 5) {
          return `Route with a ${totalWalkMin}-min walk — dress warm!`;
        }
        return `Found a route with a nice ${totalWalkMin}-min walk.`;
      }
      
      // Couldn't add much walking - explain why
      if (weather.temperature < 0) {
        return "Too cold for a long walk — added what I could.";
      }
      if (weather.condition === "rain" || weather.condition === "storm") {
        return "Weather's rough — kept the walk minimal for now.";
      }
      return "Added some walking to your route.";
    }
    
    if (note.includes("tired") || note.includes("exhausted")) {
      return "Keeping it easy for you.";
    }
    if (note.includes("date") || note.includes("romantic")) {
      return "Found a relaxed way there.";
    }
    if (note.includes("hurry") || note.includes("rush") || note.includes("late")) {
      return "Getting you there fast.";
    }
    if (note.includes("luggage") || note.includes("bags")) {
      return "Easy route for your bags.";
    }
  }

  // Context-aware presence lines (local buddy tone)
  if (isNightTime) {
    return "Late night — here's what works.";
  }
  if (isRushHour) {
    return "Rush hour — picked the smoothest option.";
  }
  if (weather.condition === "rain" || weather.condition === "storm") {
    return "Rain's coming — kept you covered.";
  }
  if (weather.temperature > 30) {
    return "Hot out there — minimized outdoor time.";
  }
  if (weather.temperature < 5) {
    return "Cold outside — kept the walk short.";
  }

  // Intent-based presence lines
  const intentLines: Record<TripIntent, string> = {
    work: "Reliable route for your commute.",
    leisure: "Easy way to get there.",
    appointment: "You'll make it on time.",
    time_sensitive: "Fastest option available.",
    exploring: "Good route with some city views.",
  };

  return intentLines[intent] || "Here's how to get there.";
}

// ============================================
// TRIP FRAMING LINES
// ============================================

export function generateTripFramingLine(input: DepthLayerInput): string {
  const { recommendation } = input;
  const steps = recommendation.steps;

  if (steps.length === 0) {
    return "Couldn't map this route — try checking the addresses.";
  }

  // Count step types
  const walkSteps = steps.filter((s) => s.type === "walk");
  const transitSteps = steps.filter((s) => s.type === "transit");
  const rideshareSteps = steps.filter((s) => s.type === "rideshare");

  const totalWalkMinutes = walkSteps.reduce((sum, s) => sum + s.duration, 0);
  const transferCount = Math.max(0, transitSteps.length - 1);

  // Short trip — keep it punchy
  if (recommendation.estimatedDuration <= 10) {
    if (steps.length === 1 && steps[0]?.type === "walk") {
      return "Quick walk — you're basically there.";
    }
    return "Short hop, you'll be there in no time.";
  }

  // Rideshare-only
  if (rideshareSteps.length > 0 && transitSteps.length === 0) {
    return "Door to door — sit back and ride.";
  }

  // Walk-only
  if (transitSteps.length === 0 && walkSteps.length > 0) {
    if (totalWalkMinutes <= 15) {
      return "Nice walk, enjoy the stroll.";
    }
    return `${totalWalkMinutes} minute walk — good day for it.`;
  }

  // Transit routes — describe the structure
  if (transitSteps.length > 0) {
    const line = transitSteps[0].line;

    if (transferCount === 0) {
      if (totalWalkMinutes <= 5) {
        return line
          ? `Straight shot on the ${line}, minimal walking.`
          : "One ride, barely any walking.";
      }
      return line
        ? `One ${line} ride, bookended by short walks.`
        : "One train with walks on each end.";
    }

    if (transferCount === 1) {
      return `One transfer, straightforward route.`;
    }

    return `A few connections, but manageable.`;
  }

  return `About ${recommendation.estimatedDuration} minutes total.`;
}

// ============================================
// RESPONSIBILITY LINES
// ============================================

export function generateResponsibilityLine(input: DepthLayerInput): string {
  const { intent, isRushHour, weather, recommendation } = input;

  // Context-specific responsibility (conversational, not robotic)
  if (intent === "appointment" || intent === "time_sensitive") {
    return "I'll let you know if there are delays.";
  }

  if (isRushHour && recommendation.mode === "transit") {
    return "Watching for service changes.";
  }

  if (weather.condition === "rain" || weather.condition === "storm") {
    return "Will update if weather affects the plan.";
  }

  // Low confidence routes
  if (recommendation.confidence && recommendation.confidence < 0.7) {
    return "Double-check this one — data was limited.";
  }

  // Default — don't over-promise
  return "Check train times before you head out.";
}

// ============================================
// CONTEXTUAL INSIGHT TEMPLATES
// ============================================

export interface InsightTemplate {
  condition: (input: DepthLayerInput) => boolean;
  generate: (input: DepthLayerInput) => string;
  priority: number;
  category: string;
}

export const INSIGHT_TEMPLATES: InsightTemplate[] = [
  // Walking preference acknowledgment - high priority when user wants to walk
  {
    condition: (input) => {
      const note = input.userNote?.toLowerCase() || "";
      return note.includes("walk") || note.includes("stroll") || note.includes("stretch") || note.includes("scenic");
    },
    generate: (input) => {
      const walkSteps = input.recommendation.steps.filter((s) => s.type === "walk");
      const totalWalkMin = walkSteps.reduce((sum, s) => sum + s.duration, 0);
      const isWalkRoute = input.recommendation.mode === "walk";
      
      if (isWalkRoute) {
        if (input.weather.isOutdoorFriendly) {
          return "Perfect walking weather! Enjoy the scenery.";
        }
        return `${input.recommendation.estimatedDuration}-min walk — great for stretching your legs.`;
      }
      
      if (totalWalkMin >= 10) {
        return `This route includes a ${totalWalkMin}-min walk — a nice way to see the neighborhood.`;
      }
      
      if (totalWalkMin >= 5) {
        return `Included a ${totalWalkMin}-min walk. Get off a stop early for more walking!`;
      }
      
      // Couldn't add much walking
      if (input.weather.temperature < 0) {
        return "It's freezing out — walk more on the return when you're warmed up!";
      }
      if (!input.weather.isOutdoorFriendly) {
        return "Weather's not ideal for a long walk today. Try again when it clears!";
      }
      return "Tip: You can get off one stop early to add a pleasant walk.";
    },
    priority: 1,
    category: "walking_preference",
  },

  // Venue hours - highest priority
  {
    condition: (input) => input.venueInfo !== undefined && !input.venueInfo.isOpenNow,
    generate: (input) => {
      const venue = input.venueInfo!;
      if (venue.nextOpenTime) {
        return `${venue.name} is currently closed. ${venue.nextOpenTime}.`;
      }
      return `${venue.name} appears to be closed now.`;
    },
    priority: 1,
    category: "venue_hours",
  },
  {
    condition: (input) =>
      input.venueInfo !== undefined && input.venueInfo.isOpenNow && input.venueInfo.closingTime !== undefined,
    generate: (input) => {
      const venue = input.venueInfo!;
      return `${venue.name} ${venue.closingTime}.`;
    },
    priority: 2,
    category: "venue_hours",
  },

  // Reservation/ticket requirements
  {
    condition: (input) => input.venueInfo?.requiresReservation === true,
    generate: (input) => `${input.venueInfo!.name} typically requires a reservation.`,
    priority: 2,
    category: "venue_reservation",
  },
  {
    condition: (input) => input.venueInfo?.requiresTicket === true,
    generate: (input) => `You may need to purchase tickets for ${input.venueInfo!.name}.`,
    priority: 3,
    category: "venue_reservation",
  },

  // Weather impacts
  {
    condition: (input) => input.weather.condition === "rain" || input.weather.condition === "storm",
    generate: (input) => {
      const walkSteps = input.recommendation.steps.filter((s) => s.type === "walk");
      const totalWalkMin = walkSteps.reduce((sum, s) => sum + s.duration, 0);
      if (totalWalkMin > 5) {
        return `Rain expected. This route has ${totalWalkMin} minutes of outdoor walking.`;
      }
      return "Rain expected. This route minimizes outdoor exposure.";
    },
    priority: 3,
    category: "weather_impact",
  },
  {
    condition: (input) => input.weather.temperature > 30,
    generate: () => "High temperatures today. Route prioritizes shade and air-conditioned transit.",
    priority: 4,
    category: "weather_impact",
  },
  {
    condition: (input) => input.weather.temperature < 5,
    generate: () => "Cold weather. Route minimizes outdoor waiting time.",
    priority: 4,
    category: "weather_impact",
  },

  // Rush hour / crowding
  {
    condition: (input) => input.isRushHour && input.recommendation.mode === "transit",
    generate: (input) => {
      const crowding = input.cityProfile.cognitiveLoadIndex.crowding;
      if (crowding > 0.7) {
        return "Rush hour transit may be crowded. Consider standing room.";
      }
      return "Rush hour timing. Trains may be busier than usual.";
    },
    priority: 5,
    category: "crowding",
  },

  // Night service
  {
    condition: (input) => input.isNightTime && input.recommendation.mode === "transit",
    generate: (input) => {
      const reliability = input.cityProfile.nightReliability;
      if (reliability < 0.5) {
        return "Limited night service. Longer waits possible between trains.";
      }
      return "Night service is running. Check schedules for exact times.";
    },
    priority: 5,
    category: "service_frequency",
  },

  // City-specific tips for unfamiliar users
  {
    condition: (input) => {
      const familiarity = input.learnedPreferences.familiarityByCity[input.cityProfile.id] ?? 0;
      return familiarity < 0.3 && input.cityProfile.complexStations.length > 0;
    },
    generate: (input) => {
      const complexStation = input.cityProfile.complexStations[0];
      const usesComplexStation = input.recommendation.steps.some(
        (s) => s.transitDetails?.departureStop === complexStation || s.transitDetails?.arrivalStop === complexStation
      );
      if (usesComplexStation) {
        return `${complexStation} can be confusing. Follow signs carefully.`;
      }
      return null as unknown as string;
    },
    priority: 6,
    category: "city_tip",
  },
];

// ============================================
// MEMORY CALLBACK TEMPLATES
// ============================================

export interface MemoryCallbackTemplate {
  eventPattern: string; // Pattern to match in recent events
  contextMatch: (input: DepthLayerInput, events: any[]) => boolean;
  generate: (input: DepthLayerInput) => string;
  minConfidence: number;
}

export const MEMORY_CALLBACK_TEMPLATES: MemoryCallbackTemplate[] = [
  {
    eventPattern: "walked_less_than_suggested",
    contextMatch: (input, events) => {
      // Check if user has avoided walking in similar weather
      const weatherEvents = events.filter(
        (e) => e.eventType === "walked_less_than_suggested" && e.context?.weather === input.weather.condition
      );
      return weatherEvents.length >= 2;
    },
    generate: (input) => {
      if (input.weather.condition === "rain") {
        return "Last time you avoided walking in rain. I kept this mostly covered.";
      }
      if (input.weather.temperature < 10) {
        return "You've preferred less walking in cold weather. I minimized outdoor time.";
      }
      return "Based on your history, I reduced walking segments.";
    },
    minConfidence: 0.7,
  },
  {
    eventPattern: "chose_calmer_option",
    contextMatch: (input, events) => {
      const calmChoices = events.filter((e) => e.eventType === "chose_calmer_option");
      return calmChoices.length >= 3;
    },
    generate: () => "You usually prefer fewer transfers. I kept it simple.",
    minConfidence: 0.6,
  },
  {
    eventPattern: "override_route",
    contextMatch: (input, events) => {
      // Check for pattern of overriding to specific mode
      const overrides = events.filter((e) => e.eventType === "override_route");
      const transitOverrides = overrides.filter((e) => e.context?.newMode === "transit");
      return transitOverrides.length >= 2;
    },
    generate: () => "You've consistently chosen transit before. I prioritized that.",
    minConfidence: 0.65,
  },
];

// ============================================
// FALLBACK DEPTH OUTPUT
// ============================================

export function generateFallbackDepthOutput(input: DepthLayerInput): {
  agentPresenceLine: string;
  tripFramingLine: string;
  contextualInsights: string[];
  responsibilityLine: string;
} {
  return {
    agentPresenceLine: generateAgentPresenceLine(input),
    tripFramingLine: generateTripFramingLine(input),
    contextualInsights: [],
    responsibilityLine: generateResponsibilityLine(input),
  };
}
