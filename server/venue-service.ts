import type { VenueInfo, VenueHours } from "@shared/schema";

/**
 * Venue type keywords for classification
 */
const VENUE_KEYWORDS: Record<string, string[]> = {
  museum: ["museum", "gallery", "exhibition", "kunst", "musee", "museo"],
  restaurant: ["restaurant", "cafe", "bistro", "eatery", "dining"],
  station: ["station", "bahnhof", "gare", "terminal", "airport", "flughafen"],
  landmark: ["gate", "tower", "monument", "memorial", "palace", "castle", "schloss"],
  park: ["park", "garden", "garten", "jardin"],
  shopping: ["mall", "market", "store", "shop", "centrum"],
  theater: ["theater", "theatre", "opera", "concert", "kino", "cinema"],
};

/**
 * Typical hours templates by venue type
 */
const TYPICAL_HOURS: Record<string, VenueHours> = {
  museum: {
    monday: [], // Often closed
    tuesday: [{ open: "10:00", close: "18:00" }],
    wednesday: [{ open: "10:00", close: "18:00" }],
    thursday: [{ open: "10:00", close: "20:00" }], // Often late opening
    friday: [{ open: "10:00", close: "18:00" }],
    saturday: [{ open: "10:00", close: "18:00" }],
    sunday: [{ open: "10:00", close: "18:00" }],
  },
  restaurant: {
    monday: [{ open: "11:00", close: "22:00" }],
    tuesday: [{ open: "11:00", close: "22:00" }],
    wednesday: [{ open: "11:00", close: "22:00" }],
    thursday: [{ open: "11:00", close: "22:00" }],
    friday: [{ open: "11:00", close: "23:00" }],
    saturday: [{ open: "11:00", close: "23:00" }],
    sunday: [{ open: "11:00", close: "21:00" }],
  },
  station: {
    monday: [{ open: "04:00", close: "01:00" }],
    tuesday: [{ open: "04:00", close: "01:00" }],
    wednesday: [{ open: "04:00", close: "01:00" }],
    thursday: [{ open: "04:00", close: "01:00" }],
    friday: [{ open: "04:00", close: "02:00" }],
    saturday: [{ open: "04:00", close: "02:00" }],
    sunday: [{ open: "04:00", close: "01:00" }],
  },
  landmark: {
    // Outdoor landmarks typically always accessible
    monday: [{ open: "00:00", close: "23:59" }],
    tuesday: [{ open: "00:00", close: "23:59" }],
    wednesday: [{ open: "00:00", close: "23:59" }],
    thursday: [{ open: "00:00", close: "23:59" }],
    friday: [{ open: "00:00", close: "23:59" }],
    saturday: [{ open: "00:00", close: "23:59" }],
    sunday: [{ open: "00:00", close: "23:59" }],
  },
  park: {
    monday: [{ open: "06:00", close: "22:00" }],
    tuesday: [{ open: "06:00", close: "22:00" }],
    wednesday: [{ open: "06:00", close: "22:00" }],
    thursday: [{ open: "06:00", close: "22:00" }],
    friday: [{ open: "06:00", close: "22:00" }],
    saturday: [{ open: "06:00", close: "22:00" }],
    sunday: [{ open: "06:00", close: "22:00" }],
  },
  shopping: {
    monday: [{ open: "10:00", close: "20:00" }],
    tuesday: [{ open: "10:00", close: "20:00" }],
    wednesday: [{ open: "10:00", close: "20:00" }],
    thursday: [{ open: "10:00", close: "20:00" }],
    friday: [{ open: "10:00", close: "20:00" }],
    saturday: [{ open: "10:00", close: "20:00" }],
    sunday: [], // Often closed
  },
  theater: {
    monday: [], // Often dark
    tuesday: [{ open: "17:00", close: "23:00" }],
    wednesday: [{ open: "17:00", close: "23:00" }],
    thursday: [{ open: "17:00", close: "23:00" }],
    friday: [{ open: "17:00", close: "23:00" }],
    saturday: [{ open: "14:00", close: "23:00" }],
    sunday: [{ open: "14:00", close: "21:00" }],
  },
};

/**
 * Venues that typically require reservations
 */
const RESERVATION_KEYWORDS = ["pergamon", "neues museum", "louvre", "uffizi", "restaurant"];

/**
 * Venues that typically require tickets
 */
const TICKET_KEYWORDS = ["museum", "gallery", "theater", "theatre", "concert", "opera", "zoo"];

/**
 * Detect venue type from destination name
 */
export function detectVenueType(destinationName: string): string | null {
  const lowerName = destinationName.toLowerCase();

  for (const [type, keywords] of Object.entries(VENUE_KEYWORDS)) {
    if (keywords.some((keyword) => lowerName.includes(keyword))) {
      return type;
    }
  }

  return null;
}

/**
 * Check if venue is currently open based on hours
 */
export function isVenueOpen(hours: VenueHours, currentTime: Date = new Date()): boolean {
  const dayNames: (keyof VenueHours)[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const dayName = dayNames[currentTime.getDay()];
  const dayHours = hours[dayName];

  if (!dayHours || dayHours.length === 0) {
    return false;
  }

  const currentTimeStr = currentTime.toTimeString().slice(0, 5); // HH:MM format

  for (const period of dayHours) {
    if (currentTimeStr >= period.open && currentTimeStr < period.close) {
      return true;
    }
  }

  return false;
}

/**
 * Get next open time for venue
 */
export function getNextOpenTime(hours: VenueHours, currentTime: Date = new Date()): string | null {
  const dayNames: (keyof VenueHours)[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const currentDay = currentTime.getDay();
  const currentTimeStr = currentTime.toTimeString().slice(0, 5);

  // Check today first
  const todayHours = hours[dayNames[currentDay]];
  if (todayHours && todayHours.length > 0) {
    for (const period of todayHours) {
      if (period.open > currentTimeStr) {
        return `Opens at ${period.open} today`;
      }
    }
  }

  // Check next 7 days
  for (let i = 1; i <= 7; i++) {
    const checkDay = (currentDay + i) % 7;
    const dayHours = hours[dayNames[checkDay]];

    if (dayHours && dayHours.length > 0) {
      const dayLabel = i === 1 ? "tomorrow" : dayNames[checkDay];
      return `Opens at ${dayHours[0].open} ${dayLabel}`;
    }
  }

  return null;
}

/**
 * Get closing time for today
 */
export function getClosingTime(hours: VenueHours, currentTime: Date = new Date()): string | null {
  const dayNames: (keyof VenueHours)[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const todayHours = hours[dayNames[currentTime.getDay()]];

  if (!todayHours || todayHours.length === 0) {
    return null;
  }

  const currentTimeStr = currentTime.toTimeString().slice(0, 5);

  for (const period of todayHours) {
    if (currentTimeStr >= period.open && currentTimeStr < period.close) {
      return `Closes at ${period.close}`;
    }
  }

  return null;
}

/**
 * Check if destination likely requires reservation
 */
export function requiresReservation(destinationName: string): boolean {
  const lowerName = destinationName.toLowerCase();
  return RESERVATION_KEYWORDS.some((keyword) => lowerName.includes(keyword));
}

/**
 * Check if destination likely requires ticket
 */
export function requiresTicket(destinationName: string): boolean {
  const lowerName = destinationName.toLowerCase();
  return TICKET_KEYWORDS.some((keyword) => lowerName.includes(keyword));
}

/**
 * Resolve venue information for a destination
 * Uses mock data for now, can be extended to use Google Places API
 */
export async function resolveVenueInfo(
  destinationName: string,
  _cityId?: string,
  currentTime?: Date
): Promise<VenueInfo | null> {
  const venueType = detectVenueType(destinationName);

  // If we can't detect venue type, skip venue info
  if (!venueType) {
    return null;
  }

  const hours = TYPICAL_HOURS[venueType];
  if (!hours) {
    return null;
  }

  const now = currentTime || new Date();
  const isOpen = isVenueOpen(hours, now);
  const nextOpen = isOpen ? null : getNextOpenTime(hours, now);
  const closing = isOpen ? getClosingTime(hours, now) : null;

  return {
    name: destinationName,
    venueType,
    isOpenNow: isOpen,
    nextOpenTime: nextOpen || undefined,
    closingTime: closing || undefined,
    requiresReservation: requiresReservation(destinationName),
    requiresTicket: requiresTicket(destinationName),
    typicalWaitMinutes: venueType === "museum" ? 15 : undefined,
    confidence: 0.7, // Mock data has moderate confidence
  };
}

/**
 * Parse Google Places hours format (if we integrate with API later)
 */
export function parseGooglePlacesHours(periods: any[]): VenueHours {
  const hours: VenueHours = {};
  const dayNames: (keyof VenueHours)[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  for (const period of periods) {
    const dayName = dayNames[period.open.day];
    if (!hours[dayName]) {
      hours[dayName] = [];
    }

    const openTime = `${String(Math.floor(period.open.time / 100)).padStart(2, "0")}:${String(period.open.time % 100).padStart(2, "0")}`;
    const closeTime = period.close
      ? `${String(Math.floor(period.close.time / 100)).padStart(2, "0")}:${String(period.close.time % 100).padStart(2, "0")}`
      : "23:59";

    hours[dayName]!.push({ open: openTime, close: closeTime });
  }

  return hours;
}
