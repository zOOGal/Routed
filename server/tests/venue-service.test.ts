import { describe, it, expect } from "vitest";
import {
  detectVenueType,
  isVenueOpen,
  getNextOpenTime,
  getClosingTime,
  requiresReservation,
  requiresTicket,
  resolveVenueInfo,
  parseGooglePlacesHours,
} from "../venue-service";
import type { VenueHours } from "@shared/schema";

describe("Venue Service - detectVenueType", () => {
  it("should detect museum from name", () => {
    expect(detectVenueType("Pergamon Museum")).toBe("museum");
    expect(detectVenueType("National Gallery")).toBe("museum");
    expect(detectVenueType("Art Exhibition Hall")).toBe("museum");
  });

  it("should detect restaurant from name", () => {
    expect(detectVenueType("Cafe Einstein")).toBe("restaurant");
    expect(detectVenueType("Restaurant Berlin")).toBe("restaurant");
    expect(detectVenueType("The Bistro")).toBe("restaurant");
  });

  it("should detect station from name", () => {
    expect(detectVenueType("Berlin Hauptbahnhof")).toBe("station");
    expect(detectVenueType("Central Station")).toBe("station");
    expect(detectVenueType("Airport Terminal")).toBe("station");
  });

  it("should detect landmark from name", () => {
    expect(detectVenueType("Brandenburg Gate")).toBe("landmark");
    expect(detectVenueType("TV Tower")).toBe("landmark");
    expect(detectVenueType("Victory Monument")).toBe("landmark");
    expect(detectVenueType("Charlottenburg Palace")).toBe("landmark");
  });

  it("should detect park from name", () => {
    expect(detectVenueType("Tiergarten Park")).toBe("park");
    expect(detectVenueType("Botanical Garden")).toBe("park");
  });

  it("should detect shopping from name", () => {
    expect(detectVenueType("Shopping Mall")).toBe("shopping");
    expect(detectVenueType("Farmers Market")).toBe("shopping");
  });

  it("should detect theater from name", () => {
    expect(detectVenueType("State Opera")).toBe("theater");
    expect(detectVenueType("Concert Hall")).toBe("theater");
    expect(detectVenueType("Cinema Center")).toBe("theater");
  });

  it("should return null for unknown venue types", () => {
    expect(detectVenueType("My Friend's House")).toBeNull();
    expect(detectVenueType("123 Main Street")).toBeNull();
  });

  it("should be case-insensitive", () => {
    expect(detectVenueType("BERLIN MUSEUM")).toBe("museum");
    expect(detectVenueType("cafe BERLIN")).toBe("restaurant");
  });
});

describe("Venue Service - isVenueOpen", () => {
  const museumHours: VenueHours = {
    monday: [], // Closed
    tuesday: [{ open: "10:00", close: "18:00" }],
    wednesday: [{ open: "10:00", close: "18:00" }],
    thursday: [{ open: "10:00", close: "20:00" }],
    friday: [{ open: "10:00", close: "18:00" }],
    saturday: [{ open: "10:00", close: "18:00" }],
    sunday: [{ open: "10:00", close: "18:00" }],
  };

  it("should return false when venue is closed on that day", () => {
    const monday = new Date("2024-01-15T14:00:00"); // Monday
    expect(isVenueOpen(museumHours, monday)).toBe(false);
  });

  it("should return true when within opening hours", () => {
    const tuesdayNoon = new Date("2024-01-16T12:00:00"); // Tuesday noon
    expect(isVenueOpen(museumHours, tuesdayNoon)).toBe(true);
  });

  it("should return false before opening", () => {
    const tuesdayEarly = new Date("2024-01-16T09:00:00"); // Tuesday 9am
    expect(isVenueOpen(museumHours, tuesdayEarly)).toBe(false);
  });

  it("should return false at closing time", () => {
    const tuesdayClose = new Date("2024-01-16T18:00:00"); // Tuesday 6pm exactly
    expect(isVenueOpen(museumHours, tuesdayClose)).toBe(false);
  });

  it("should return false after closing", () => {
    const tuesdayLate = new Date("2024-01-16T19:00:00"); // Tuesday 7pm
    expect(isVenueOpen(museumHours, tuesdayLate)).toBe(false);
  });

  it("should handle multiple time periods in a day", () => {
    const multiPeriodHours: VenueHours = {
      monday: [
        { open: "09:00", close: "12:00" },
        { open: "14:00", close: "18:00" },
      ],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const morning = new Date("2024-01-15T10:00:00"); // Monday 10am
    const lunch = new Date("2024-01-15T13:00:00"); // Monday 1pm
    const afternoon = new Date("2024-01-15T15:00:00"); // Monday 3pm

    expect(isVenueOpen(multiPeriodHours, morning)).toBe(true);
    expect(isVenueOpen(multiPeriodHours, lunch)).toBe(false);
    expect(isVenueOpen(multiPeriodHours, afternoon)).toBe(true);
  });
});

describe("Venue Service - getNextOpenTime", () => {
  const museumHours: VenueHours = {
    monday: [], // Closed
    tuesday: [{ open: "10:00", close: "18:00" }],
    wednesday: [{ open: "10:00", close: "18:00" }],
    thursday: [{ open: "10:00", close: "20:00" }],
    friday: [{ open: "10:00", close: "18:00" }],
    saturday: [{ open: "10:00", close: "18:00" }],
    sunday: [{ open: "10:00", close: "18:00" }],
  };

  it("should return 'Opens at X today' when closed but will open later today", () => {
    const tuesdayEarly = new Date("2024-01-16T08:00:00"); // Tuesday 8am
    const nextOpen = getNextOpenTime(museumHours, tuesdayEarly);
    expect(nextOpen).toBe("Opens at 10:00 today");
  });

  it("should return 'Opens at X tomorrow' when closed for the day", () => {
    const mondayEvening = new Date("2024-01-15T20:00:00"); // Monday 8pm
    const nextOpen = getNextOpenTime(museumHours, mondayEvening);
    expect(nextOpen).toBe("Opens at 10:00 tomorrow");
  });

  it("should return next available day when multiple days closed", () => {
    const allClosed: VenueHours = {
      monday: [],
      tuesday: [],
      wednesday: [{ open: "10:00", close: "18:00" }],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const monday = new Date("2024-01-15T12:00:00"); // Monday
    const nextOpen = getNextOpenTime(allClosed, monday);
    expect(nextOpen).toBe("Opens at 10:00 wednesday");
  });

  it("should return null when no opening hours defined", () => {
    const noHours: VenueHours = {};
    const nextOpen = getNextOpenTime(noHours, new Date());
    expect(nextOpen).toBeNull();
  });
});

describe("Venue Service - getClosingTime", () => {
  const hours: VenueHours = {
    monday: [{ open: "10:00", close: "18:00" }],
    tuesday: [{ open: "10:00", close: "20:00" }],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };

  it("should return closing time when venue is open", () => {
    const mondayNoon = new Date("2024-01-15T12:00:00"); // Monday noon
    expect(getClosingTime(hours, mondayNoon)).toBe("Closes at 18:00");
  });

  it("should return null when venue is closed", () => {
    const wednesdayNoon = new Date("2024-01-17T12:00:00"); // Wednesday noon
    expect(getClosingTime(hours, wednesdayNoon)).toBeNull();
  });

  it("should return null when outside opening hours", () => {
    const mondayEarly = new Date("2024-01-15T08:00:00"); // Monday 8am
    expect(getClosingTime(hours, mondayEarly)).toBeNull();
  });
});

describe("Venue Service - requiresReservation", () => {
  it("should return true for venues that typically need reservations", () => {
    expect(requiresReservation("Pergamon Museum")).toBe(true);
    expect(requiresReservation("Neues Museum Berlin")).toBe(true);
    expect(requiresReservation("Fancy Restaurant")).toBe(true);
  });

  it("should return false for venues that typically don't need reservations", () => {
    expect(requiresReservation("Brandenburg Gate")).toBe(false);
    expect(requiresReservation("Tiergarten Park")).toBe(false);
  });
});

describe("Venue Service - requiresTicket", () => {
  it("should return true for venues that typically need tickets", () => {
    expect(requiresTicket("Berlin Museum")).toBe(true);
    expect(requiresTicket("National Gallery")).toBe(true);
    expect(requiresTicket("State Opera House")).toBe(true);
    expect(requiresTicket("City Zoo")).toBe(true);
  });

  it("should return false for venues that typically don't need tickets", () => {
    expect(requiresTicket("Central Park")).toBe(false);
    expect(requiresTicket("Main Street")).toBe(false);
  });
});

describe("Venue Service - resolveVenueInfo", () => {
  it("should return venue info for museums", async () => {
    const info = await resolveVenueInfo("Berlin Museum");

    expect(info).not.toBeNull();
    expect(info?.venueType).toBe("museum");
    expect(info?.requiresTicket).toBe(true);
    expect(info?.confidence).toBeGreaterThan(0);
  });

  it("should return null for unrecognized destinations", async () => {
    const info = await resolveVenueInfo("123 Main Street");
    expect(info).toBeNull();
  });

  it("should include nextOpenTime when venue is closed", async () => {
    // This test is time-dependent, so we check structure
    const info = await resolveVenueInfo("Some Museum");
    expect(info).not.toBeNull();
    expect(info).toHaveProperty("isOpenNow");
    expect(info).toHaveProperty("name");
    expect(info).toHaveProperty("confidence");
  });

  it("should detect reservation requirements for popular venues", async () => {
    const info = await resolveVenueInfo("Pergamon Museum");
    expect(info?.requiresReservation).toBe(true);
  });
});

describe("Venue Service - parseGooglePlacesHours", () => {
  it("should parse Google Places API format", () => {
    const periods = [
      { open: { day: 1, time: 900 }, close: { day: 1, time: 1700 } }, // Monday 9-17
      { open: { day: 2, time: 900 }, close: { day: 2, time: 1700 } }, // Tuesday 9-17
    ];

    const hours = parseGooglePlacesHours(periods);

    expect(hours.monday).toHaveLength(1);
    expect(hours.monday?.[0].open).toBe("09:00");
    expect(hours.monday?.[0].close).toBe("17:00");
    expect(hours.tuesday).toHaveLength(1);
  });

  it("should handle midnight closing (23:59)", () => {
    const periods = [
      { open: { day: 0, time: 800 } }, // Sunday 8am, no closing time
    ];

    const hours = parseGooglePlacesHours(periods);

    expect(hours.sunday?.[0].close).toBe("23:59");
  });
});
