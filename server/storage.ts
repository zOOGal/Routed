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
  type RouteStep
} from "@shared/schema";
import { randomUUID } from "crypto";

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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private cityFamiliarity: Map<string, UserCityFamiliarity>;
  private behavioralSignals: Map<string, BehavioralSignal>;
  private trips: Map<string, Trip>;
  private defaultUserId: string;

  constructor() {
    this.users = new Map();
    this.cityFamiliarity = new Map();
    this.behavioralSignals = new Map();
    this.trips = new Map();
    
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
      status: insertTrip.status || "planned",
      recommendation: insertTrip.recommendation || null,
      reasoning: insertTrip.reasoning || null,
      steps: insertTrip.steps || null,
      currentStepIndex: insertTrip.currentStepIndex || 0,
      estimatedDuration: insertTrip.estimatedDuration || null,
      stressScore: insertTrip.stressScore || null,
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
}

export const storage = new MemStorage();
