import {
  type User,
  type InsertUser,
  type Trip,
  type InsertTrip,
  type BehavioralSignal,
  type InsertBehavioralSignal,
  type UserCityFamiliarity,
  type InsertUserCityFamiliarity,
  type RouteRecommendation,
  type RouteStep,
  type Package,
  type InsertPackage,
  type UserPackage,
  type InsertUserPackage,
  type Provider,
  type InsertProvider,
  type Entitlement,
  type BenefitRule,
  type UserEvent,
  type InsertUserEvent,
  type UserMemorySnapshot,
  type InsertUserMemorySnapshot,
  type Venue,
  type InsertVenue,
  type LearnedPreferences,
  type DepthLayerOutput,
  type RideBookingRecord,
  type InsertRideBooking,
  type RideEventRecord,
  type InsertRideEvent,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { DEFAULT_LEARNED_PREFERENCES } from "./depth/types";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPreferences(id: string, preferences: Partial<InsertUser>): Promise<User | undefined>;

  // City Familiarity
  getUserCityFamiliarity(userId: string, cityId: string): Promise<UserCityFamiliarity | undefined>;
  updateUserCityFamiliarity(userId: string, cityId: string, score: number): Promise<UserCityFamiliarity>;

  // Behavioral Signals
  recordBehavioralSignal(signal: InsertBehavioralSignal): Promise<BehavioralSignal>;
  getUserBehavioralSignals(userId: string, limit?: number): Promise<BehavioralSignal[]>;

  // Trips
  getTrip(id: string): Promise<Trip | undefined>;
  getTripsByUser(userId: string): Promise<Trip[]>;
  getAllTrips(): Promise<Trip[]>;
  createTrip(trip: InsertTrip): Promise<Trip>;
  updateTripStatus(id: string, status: string): Promise<Trip | undefined>;
  updateTripStep(id: string, stepIndex: number): Promise<Trip | undefined>;
  updateTripRecommendation(id: string, recommendation: RouteRecommendation): Promise<Trip | undefined>;
  updateTripDepthLayer(id: string, depthLayer: DepthLayerOutput): Promise<Trip | undefined>;
  getUserTripCount(userId: string): Promise<number>;

  // Packages
  getPackages(cityId?: string): Promise<Package[]>;
  getPackage(id: string): Promise<Package | undefined>;

  // User Packages
  getUserActivePackage(userId: string, cityId: string): Promise<UserPackage | undefined>;
  getUserPackages(userId: string): Promise<UserPackage[]>;
  activatePackage(userId: string, packageId: string): Promise<UserPackage>;

  // Providers
  getProviders(cityId: string): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | undefined>;

  // Entitlements
  getUserEntitlements(userId: string, cityId: string): Promise<Entitlement[]>;

  // User Events (for learning)
  recordUserEvent(event: InsertUserEvent): Promise<UserEvent>;
  getUserEvents(userId: string, limit?: number): Promise<UserEvent[]>;
  getUserEventsByType(userId: string, eventType: string, limit?: number): Promise<UserEvent[]>;

  // Memory Snapshots
  saveMemorySnapshot(userId: string, snapshot: LearnedPreferences, triggerEvent?: string): Promise<UserMemorySnapshot>;
  getLatestMemorySnapshot(userId: string): Promise<UserMemorySnapshot | undefined>;

  // Learned Preferences
  getLearnedPreferences(userId: string): Promise<LearnedPreferences>;
  updateLearnedPreferences(userId: string, prefs: LearnedPreferences): Promise<void>;

  // Venues
  getVenue(placeId: string): Promise<Venue | undefined>;
  saveVenue(venue: InsertVenue): Promise<Venue>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private cityFamiliarity: Map<string, UserCityFamiliarity>;
  private behavioralSignals: Map<string, BehavioralSignal>;
  private trips: Map<string, Trip>;
  private packages: Map<string, Package>;
  private userPackages: Map<string, UserPackage>;
  private providers: Map<string, Provider>;
  private userEvents: Map<string, UserEvent>;
  private memorySnapshots: Map<string, UserMemorySnapshot>;
  private learnedPreferences: Map<string, LearnedPreferences>;
  private venues: Map<string, Venue>;
  private defaultUserId: string;

  constructor() {
    this.users = new Map();
    this.cityFamiliarity = new Map();
    this.behavioralSignals = new Map();
    this.trips = new Map();
    this.packages = new Map();
    this.userPackages = new Map();
    this.providers = new Map();
    this.userEvents = new Map();
    this.memorySnapshots = new Map();
    this.learnedPreferences = new Map();
    this.venues = new Map();

    this.defaultUserId = randomUUID();
    const defaultUser: User = {
      id: this.defaultUserId,
      username: "guest",
      password: "",
      walkingTolerance: 3,
      transferTolerance: 3,
      stressVsSpeedBias: 0.7,
      costSensitivity: 3,
    };
    this.users.set(this.defaultUserId, defaultUser);

    // Initialize default learned preferences
    this.learnedPreferences.set(this.defaultUserId, { ...DEFAULT_LEARNED_PREFERENCES });

    // Seed packages and providers
    this.seedPackagesAndProviders();
  }

  private seedPackagesAndProviders() {
    // ============ PROVIDERS ============

    // Berlin providers
    const berlinProviders: Provider[] = [
      {
        id: "bvg",
        cityId: "berlin",
        type: "transit",
        name: "BVG",
        logoEmoji: "🚇",
        baseFareCents: 320,
        perKmCents: 0,
        perMinCents: 0,
        deepLinkTemplate: "https://www.bvg.de",
      },
      {
        id: "bolt-berlin",
        cityId: "berlin",
        type: "ridehail",
        name: "Bolt",
        logoEmoji: "🚗",
        baseFareCents: 350,
        perKmCents: 120,
        perMinCents: 30,
        deepLinkTemplate: "bolt://ride",
      },
      {
        id: "lime-berlin",
        cityId: "berlin",
        type: "bike",
        name: "Lime",
        logoEmoji: "🛴",
        baseFareCents: 100,
        perKmCents: 0,
        perMinCents: 25,
        deepLinkTemplate: "https://li.me",
      },
    ];

    // Tokyo providers
    const tokyoProviders: Provider[] = [
      {
        id: "suica",
        cityId: "tokyo",
        type: "transit",
        name: "Suica/JR",
        logoEmoji: "🚃",
        baseFareCents: 14000,
        perKmCents: 2000,
        perMinCents: 0,
        deepLinkTemplate: "https://www.jreast.co.jp",
      },
      {
        id: "go-taxi",
        cityId: "tokyo",
        type: "ridehail",
        name: "GO Taxi",
        logoEmoji: "🚕",
        baseFareCents: 50000,
        perKmCents: 30000,
        perMinCents: 0,
        deepLinkTemplate: "https://go.mo-t.com",
      },
      {
        id: "docomo-bike",
        cityId: "tokyo",
        type: "bike",
        name: "Docomo Bike",
        logoEmoji: "🚲",
        baseFareCents: 16500,
        perKmCents: 0,
        perMinCents: 550,
        deepLinkTemplate: "https://docomo-cycle.jp",
      },
    ];

    // NYC providers
    const nycProviders: Provider[] = [
      {
        id: "mta",
        cityId: "nyc",
        type: "transit",
        name: "MTA",
        logoEmoji: "🚇",
        baseFareCents: 290,
        perKmCents: 0,
        perMinCents: 0,
        deepLinkTemplate: "https://new.mta.info",
      },
      {
        id: "uber-nyc",
        cityId: "nyc",
        type: "ridehail",
        name: "Uber",
        logoEmoji: "🚙",
        baseFareCents: 300,
        perKmCents: 180,
        perMinCents: 45,
        deepLinkTemplate: "uber://",
      },
      {
        id: "citibike",
        cityId: "nyc",
        type: "bike",
        name: "Citi Bike",
        logoEmoji: "🚴",
        baseFareCents: 499,
        perKmCents: 0,
        perMinCents: 26,
        deepLinkTemplate: "https://citibikenyc.com",
      },
    ];

    [...berlinProviders, ...tokyoProviders, ...nycProviders].forEach((p) =>
      this.providers.set(p.id, p)
    );

    // ============ PACKAGES ============
    // Routed Pass: access to AI routing, food recs, and trip adjustments
    // Universal pricing (USD), not city-specific

    const packagesData: Package[] = [
      {
        id: "pass-3day",
        cityId: "global",
        name: "3-Day Pass",
        durationDays: 3,
        priceCents: 499, // $4.99
        currency: "USD",
        description: "Weekend or short trip",
        includedProviders: [],
        benefitRules: [],
        createdAt: new Date(),
      },
      {
        id: "pass-weekly",
        cityId: "global",
        name: "Weekly Pass",
        durationDays: 7,
        priceCents: 999, // $9.99
        currency: "USD",
        description: "Most visits",
        includedProviders: [],
        benefitRules: [],
        createdAt: new Date(),
      },
      {
        id: "pass-monthly",
        cityId: "global",
        name: "Monthly Pass",
        durationDays: 30,
        priceCents: 1999, // $19.99
        currency: "USD",
        description: "Extended stay",
        includedProviders: [],
        benefitRules: [],
        createdAt: new Date(),
      },
    ];

    packagesData.forEach((p) => this.packages.set(p.id, p));
  }

  getDefaultUserId(): string {
    return this.defaultUserId;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      id,
      username: insertUser.username,
      password: insertUser.password,
      walkingTolerance: insertUser.walkingTolerance ?? 3,
      transferTolerance: insertUser.transferTolerance ?? 3,
      stressVsSpeedBias: insertUser.stressVsSpeedBias ?? 0.7,
      costSensitivity: insertUser.costSensitivity ?? 3,
    };
    this.users.set(id, user);
    return user;
  }

  async updateUserPreferences(id: string, preferences: Partial<InsertUser>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updated: User = {
      ...user,
      walkingTolerance: preferences.walkingTolerance ?? user.walkingTolerance,
      transferTolerance: preferences.transferTolerance ?? user.transferTolerance,
      stressVsSpeedBias: preferences.stressVsSpeedBias ?? user.stressVsSpeedBias,
      costSensitivity: preferences.costSensitivity ?? user.costSensitivity,
    };
    this.users.set(id, updated);
    return updated;
  }

  async getUserCityFamiliarity(userId: string, cityId: string): Promise<UserCityFamiliarity | undefined> {
    const key = `${userId}:${cityId}`;
    return this.cityFamiliarity.get(key);
  }

  async updateUserCityFamiliarity(userId: string, cityId: string, score: number): Promise<UserCityFamiliarity> {
    const key = `${userId}:${cityId}`;
    const existing = this.cityFamiliarity.get(key);
    
    const familiarity: UserCityFamiliarity = {
      id: existing?.id || randomUUID(),
      userId,
      cityId,
      familiarityScore: Math.min(1, Math.max(0, score)),
      visitCount: (existing?.visitCount || 0) + 1,
      lastVisit: new Date(),
    };
    
    this.cityFamiliarity.set(key, familiarity);
    return familiarity;
  }

  async recordBehavioralSignal(signal: InsertBehavioralSignal): Promise<BehavioralSignal> {
    const id = randomUUID();
    const behavioralSignal: BehavioralSignal = {
      id,
      userId: signal.userId,
      signalType: signal.signalType,
      routeType: signal.routeType || null,
      cityId: signal.cityId || null,
      context: signal.context || null,
      createdAt: new Date(),
    };
    this.behavioralSignals.set(id, behavioralSignal);
    return behavioralSignal;
  }

  async getUserBehavioralSignals(userId: string, limit: number = 50): Promise<BehavioralSignal[]> {
    return Array.from(this.behavioralSignals.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getTrip(id: string): Promise<Trip | undefined> {
    return this.trips.get(id);
  }

  async getTripsByUser(userId: string): Promise<Trip[]> {
    return Array.from(this.trips.values())
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getAllTrips(): Promise<Trip[]> {
    return Array.from(this.trips.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createTrip(insertTrip: InsertTrip): Promise<Trip> {
    const id = randomUUID();
    const trip: Trip = {
      id,
      userId: insertTrip.userId || null,
      cityId: insertTrip.cityId,
      originName: insertTrip.originName,
      originLat: insertTrip.originLat || null,
      originLng: insertTrip.originLng || null,
      destinationName: insertTrip.destinationName,
      destinationLat: insertTrip.destinationLat || null,
      destinationLng: insertTrip.destinationLng || null,
      intent: insertTrip.intent || "leisure",
      userNote: insertTrip.userNote || null,
      status: insertTrip.status || "planned",
      recommendation: insertTrip.recommendation || null,
      reasoning: insertTrip.reasoning || null,
      steps: insertTrip.steps || null,
      currentStepIndex: insertTrip.currentStepIndex || 0,
      estimatedDuration: insertTrip.estimatedDuration || null,
      stressScore: insertTrip.stressScore || null,
      depthLayer: insertTrip.depthLayer || null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    this.trips.set(id, trip);
    return trip;
  }

  async updateTripStatus(id: string, status: string): Promise<Trip | undefined> {
    const trip = this.trips.get(id);
    if (!trip) return undefined;

    const updated: Trip = {
      ...trip,
      status,
      startedAt: status === "in_progress" ? new Date() : trip.startedAt,
      completedAt: status === "completed" ? new Date() : trip.completedAt,
    };
    this.trips.set(id, updated);
    return updated;
  }

  async updateTripStep(id: string, stepIndex: number): Promise<Trip | undefined> {
    const trip = this.trips.get(id);
    if (!trip) return undefined;

    const steps = trip.steps as RouteStep[] || [];
    const isComplete = stepIndex >= steps.length;

    const updated: Trip = {
      ...trip,
      currentStepIndex: stepIndex,
      status: isComplete ? "completed" : trip.status,
      completedAt: isComplete ? new Date() : trip.completedAt,
    };
    this.trips.set(id, updated);
    return updated;
  }

  async updateTripRecommendation(id: string, recommendation: RouteRecommendation): Promise<Trip | undefined> {
    const trip = this.trips.get(id);
    if (!trip) return undefined;

    const updated: Trip = {
      ...trip,
      recommendation,
      reasoning: recommendation.reasoning,
      steps: recommendation.steps,
      estimatedDuration: recommendation.estimatedDuration,
      stressScore: recommendation.stressScore,
      currentStepIndex: 0,
    };
    this.trips.set(id, updated);
    return updated;
  }

  // ============ PACKAGES ============

  async getPackages(cityId?: string): Promise<Package[]> {
    const allPackages = Array.from(this.packages.values());
    if (cityId) {
      return allPackages.filter((p) => p.cityId === cityId || p.cityId === "global");
    }
    return allPackages;
  }

  async getPackage(id: string): Promise<Package | undefined> {
    return this.packages.get(id);
  }

  // ============ USER PACKAGES ============

  async getUserActivePackage(userId: string, cityId: string): Promise<UserPackage | undefined> {
    const now = new Date();
    return Array.from(this.userPackages.values()).find(
      (up) => {
        if (up.userId !== userId || up.status !== "active") return false;
        if (new Date(up.startAt) > now || new Date(up.endAt) < now) return false;
        const pkg = this.packages.get(up.packageId);
        return pkg && (pkg.cityId === cityId || pkg.cityId === "global");
      }
    );
  }

  async getUserPackages(userId: string): Promise<UserPackage[]> {
    return Array.from(this.userPackages.values())
      .filter((up) => up.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async activatePackage(userId: string, packageId: string): Promise<UserPackage> {
    const pkg = this.packages.get(packageId);
    if (!pkg) {
      throw new Error("Package not found");
    }

    const id = randomUUID();
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + pkg.durationDays * 24 * 60 * 60 * 1000);

    // Generate entitlements from benefit rules
    const entitlements: Entitlement[] = [];
    const cityProviders = Array.from(this.providers.values()).filter(
      (p) => p.cityId === pkg.cityId
    );

    for (const rule of pkg.benefitRules as BenefitRule[]) {
      const matchingProvider = cityProviders.find((p) => p.type === rule.providerType);
      if (matchingProvider) {
        entitlements.push({
          providerId: matchingProvider.id,
          providerName: matchingProvider.name,
          providerType: rule.providerType,
          benefitType: rule.benefitType,
          value: rule.value,
          remainingUses: rule.benefitType === "free_unlocks" ? rule.value : undefined,
          activatedAt: startAt.toISOString(),
        });
      }
    }

    const userPackage: UserPackage = {
      id,
      userId,
      packageId,
      startAt,
      endAt,
      status: "active",
      entitlements,
      createdAt: new Date(),
    };

    this.userPackages.set(id, userPackage);
    return userPackage;
  }

  // ============ PROVIDERS ============

  async getProviders(cityId: string): Promise<Provider[]> {
    return Array.from(this.providers.values()).filter((p) => p.cityId === cityId);
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    return this.providers.get(id);
  }

  // ============ ENTITLEMENTS ============

  async getUserEntitlements(userId: string, cityId: string): Promise<Entitlement[]> {
    const activePackage = await this.getUserActivePackage(userId, cityId);
    if (!activePackage) {
      return [];
    }
    return activePackage.entitlements;
  }

  // ============ TRIP DEPTH LAYER ============

  async updateTripDepthLayer(id: string, depthLayer: DepthLayerOutput): Promise<Trip | undefined> {
    const trip = this.trips.get(id);
    if (!trip) return undefined;

    const updated: Trip = {
      ...trip,
      depthLayer,
    };
    this.trips.set(id, updated);
    return updated;
  }

  async getUserTripCount(userId: string): Promise<number> {
    return Array.from(this.trips.values()).filter((t) => t.userId === userId).length;
  }

  // ============ USER EVENTS ============

  async recordUserEvent(event: InsertUserEvent): Promise<UserEvent> {
    const id = randomUUID();
    const userEvent: UserEvent = {
      id,
      userId: event.userId,
      tripId: event.tripId || null,
      eventType: event.eventType,
      cityId: event.cityId || null,
      context: event.context || null,
      createdAt: new Date(),
    };
    this.userEvents.set(id, userEvent);
    return userEvent;
  }

  async getUserEvents(userId: string, limit: number = 100): Promise<UserEvent[]> {
    return Array.from(this.userEvents.values())
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getUserEventsByType(userId: string, eventType: string, limit: number = 50): Promise<UserEvent[]> {
    return Array.from(this.userEvents.values())
      .filter((e) => e.userId === userId && e.eventType === eventType)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // ============ MEMORY SNAPSHOTS ============

  async saveMemorySnapshot(
    userId: string,
    snapshot: LearnedPreferences,
    triggerEvent?: string
  ): Promise<UserMemorySnapshot> {
    const id = randomUUID();
    const memSnapshot: UserMemorySnapshot = {
      id,
      userId,
      snapshotJson: snapshot,
      triggerEvent: triggerEvent || null,
      createdAt: new Date(),
    };
    this.memorySnapshots.set(id, memSnapshot);
    return memSnapshot;
  }

  async getLatestMemorySnapshot(userId: string): Promise<UserMemorySnapshot | undefined> {
    const snapshots = Array.from(this.memorySnapshots.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return snapshots[0];
  }

  // ============ LEARNED PREFERENCES ============

  async getLearnedPreferences(userId: string): Promise<LearnedPreferences> {
    const prefs = this.learnedPreferences.get(userId);
    if (prefs) return prefs;

    // Return default preferences for new users
    const defaultPrefs = { ...DEFAULT_LEARNED_PREFERENCES };
    this.learnedPreferences.set(userId, defaultPrefs);
    return defaultPrefs;
  }

  async updateLearnedPreferences(userId: string, prefs: LearnedPreferences): Promise<void> {
    this.learnedPreferences.set(userId, prefs);
  }

  // ============ VENUES ============

  async getVenue(placeId: string): Promise<Venue | undefined> {
    return Array.from(this.venues.values()).find((v) => v.placeId === placeId);
  }

  async saveVenue(venue: InsertVenue): Promise<Venue> {
    const id = randomUUID();
    const newVenue: Venue = {
      id,
      placeId: venue.placeId || null,
      cityId: venue.cityId,
      name: venue.name,
      venueType: venue.venueType || null,
      hoursJson: venue.hoursJson || null,
      requiresReservation: venue.requiresReservation || false,
      requiresTicket: venue.requiresTicket || false,
      typicalWaitMinutes: venue.typicalWaitMinutes || null,
      updatedAt: new Date(),
    };
    this.venues.set(id, newVenue);
    return newVenue;
  }

  // ============ RIDE BOOKINGS ============

  private rideBookings = new Map<string, RideBookingRecord>();
  private rideEvents = new Map<string, RideEventRecord>();

  async createRideBooking(booking: InsertRideBooking & { id?: string }): Promise<RideBookingRecord> {
    const id = booking.id || randomUUID();
    const now = new Date();
    const record: RideBookingRecord = {
      id,
      userId: booking.userId || null,
      providerId: booking.providerId,
      providerName: booking.providerName,
      cityCode: booking.cityCode,
      status: booking.status || "requesting",
      originJson: booking.originJson,
      destinationJson: booking.destinationJson,
      priceRangeJson: booking.priceRangeJson,
      driverJson: booking.driverJson || null,
      pickupEtaMin: booking.pickupEtaMin || null,
      isDemo: booking.isDemo ?? true,
      cancellationReason: booking.cancellationReason || null,
      createdAt: now,
      updatedAt: now,
      completedAt: booking.completedAt || null,
      cancelledAt: booking.cancelledAt || null,
    };
    this.rideBookings.set(id, record);

    // Log creation event
    await this.createRideEvent(id, "created", { status: record.status });

    return record;
  }

  async getRideBooking(id: string): Promise<RideBookingRecord | undefined> {
    return this.rideBookings.get(id);
  }

  async updateRideBooking(
    id: string,
    updates: Partial<RideBookingRecord>
  ): Promise<RideBookingRecord | undefined> {
    const existing = this.rideBookings.get(id);
    if (!existing) return undefined;

    const updated: RideBookingRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.rideBookings.set(id, updated);

    // Log status change event
    if (updates.status && updates.status !== existing.status) {
      await this.createRideEvent(id, "status_change", {
        from: existing.status,
        to: updates.status,
      });
    }

    return updated;
  }

  async getUserRideBookings(userId: string): Promise<RideBookingRecord[]> {
    return Array.from(this.rideBookings.values())
      .filter((b) => b.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getActiveRideBooking(userId: string): Promise<RideBookingRecord | undefined> {
    const activeStatuses = ["requesting", "matched", "arriving", "in_trip"];
    return Array.from(this.rideBookings.values())
      .find((b) => b.userId === userId && activeStatuses.includes(b.status));
  }

  // ============ RIDE EVENTS ============

  async createRideEvent(
    bookingId: string,
    eventType: string,
    payload?: any
  ): Promise<RideEventRecord> {
    const id = randomUUID();
    const record: RideEventRecord = {
      id,
      bookingId,
      eventType,
      payloadJson: payload || null,
      createdAt: new Date(),
    };
    this.rideEvents.set(id, record);
    return record;
  }

  async getRideEvents(bookingId: string): Promise<RideEventRecord[]> {
    return Array.from(this.rideEvents.values())
      .filter((e) => e.bookingId === bookingId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async updateRideBookingStatus(
    id: string,
    status: string,
    extras?: {
      driver?: any;
      driverLat?: number;
      driverLng?: number;
      etaMinutes?: number;
      cancellationReason?: string;
    }
  ): Promise<RideBookingRecord | undefined> {
    const existing = this.rideBookings.get(id);
    if (!existing) return undefined;

    const now = new Date();
    const updates: Partial<RideBookingRecord> = {
      status,
      updatedAt: now,
    };

    if (extras?.driver) {
      updates.driverJson = extras.driver;
    }
    if (extras?.etaMinutes !== undefined) {
      updates.pickupEtaMin = extras.etaMinutes;
    }
    if (extras?.cancellationReason) {
      updates.cancellationReason = extras.cancellationReason;
      updates.cancelledAt = now;
    }
    if (status === "completed") {
      updates.completedAt = now;
    }

    return this.updateRideBooking(id, updates);
  }
}

export const storage = new MemStorage();
