/**
 * AUTH SERVICE
 *
 * Simple authentication for Routed.
 * Supports registration, login, logout.
 * Links anonymous profiles to authenticated accounts.
 */

import { randomUUID } from "crypto";
import * as bcrypt from "bcryptjs";

// In-memory user store (hackathon-grade)
interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  anonymousId?: string; // Link to anonymous profile
  createdAt: Date;
}

const users = new Map<string, AuthUser>();
const emailIndex = new Map<string, string>(); // email -> userId

const SALT_ROUNDS = 10;

/**
 * Register a new user
 */
export async function registerUser(
  email: string,
  password: string,
  displayName: string,
  anonymousId?: string
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  // Validate email format
  if (!email || !email.includes("@")) {
    return { success: false, error: "Invalid email address" };
  }

  // Validate password
  if (!password || password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" };
  }

  // Check if email already exists
  if (emailIndex.has(email.toLowerCase())) {
    return { success: false, error: "Email already registered" };
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Create user
  const user: AuthUser = {
    id: randomUUID(),
    email: email.toLowerCase(),
    passwordHash,
    displayName: displayName || email.split("@")[0],
    anonymousId,
    createdAt: new Date(),
  };

  users.set(user.id, user);
  emailIndex.set(user.email, user.id);

  console.log(`[auth] Registered user: ${user.email} (id: ${user.id.slice(0, 8)}...)`);

  return { success: true, user };
}

/**
 * Login user
 */
export async function loginUser(
  email: string,
  password: string
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  // Find user by email
  const userId = emailIndex.get(email.toLowerCase());
  if (!userId) {
    return { success: false, error: "Invalid email or password" };
  }

  const user = users.get(userId);
  if (!user) {
    return { success: false, error: "Invalid email or password" };
  }

  // Verify password
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return { success: false, error: "Invalid email or password" };
  }

  console.log(`[auth] User logged in: ${user.email}`);

  return { success: true, user };
}

/**
 * Get user by ID
 */
export function getUserById(userId: string): AuthUser | undefined {
  return users.get(userId);
}

/**
 * Get user by email
 */
export function getUserByEmail(email: string): AuthUser | undefined {
  const userId = emailIndex.get(email.toLowerCase());
  return userId ? users.get(userId) : undefined;
}

/**
 * Link anonymous profile to authenticated user
 */
export function linkAnonymousProfile(userId: string, anonymousId: string): boolean {
  const user = users.get(userId);
  if (!user) return false;

  user.anonymousId = anonymousId;
  users.set(userId, user);

  console.log(`[auth] Linked anonymous profile ${anonymousId.slice(0, 8)}... to user ${user.email}`);

  return true;
}

/**
 * Get safe user data (without password hash)
 */
export function getSafeUserData(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}
