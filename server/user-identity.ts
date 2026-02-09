/**
 * ANONYMOUS USER IDENTITY
 *
 * Hackathon-grade user identity without login.
 * Uses HttpOnly cookie to persist userId across sessions.
 */

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

// Cookie configuration
const COOKIE_NAME = "routed_uid";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year in ms

/**
 * Get user ID from request cookies.
 * Returns undefined if cookie doesn't exist.
 */
export function getUserIdFromRequest(req: Request): string | undefined {
  return req.cookies?.[COOKIE_NAME];
}

/**
 * Set user ID cookie on response.
 */
export function setUserIdCookie(res: Response, userId: string): void {
  res.cookie(COOKIE_NAME, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

/**
 * Generate a new anonymous user ID.
 */
export function generateUserId(): string {
  return randomUUID();
}

/**
 * Express middleware that ensures a user ID cookie exists.
 * Creates one if missing and attaches userId to request.
 */
export function ensureUserId(req: Request, res: Response, next: NextFunction): void {
  let userId = getUserIdFromRequest(req);

  if (!userId) {
    userId = generateUserId();
    setUserIdCookie(res, userId);
    console.log(`[user-identity] Created new anonymous user: ${userId.slice(0, 8)}...`);
  }

  // Attach to request for easy access
  (req as any).userId = userId;

  next();
}

/**
 * Get user ID from request (after middleware has run).
 * Throws if middleware hasn't run.
 */
export function getUserId(req: Request): string {
  const userId = (req as any).userId || getUserIdFromRequest(req);
  if (!userId) {
    throw new Error("User ID not found. Ensure ensureUserId middleware is applied.");
  }
  return userId;
}

/**
 * Express middleware to log user activity (optional).
 */
export function logUserActivity(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as any).userId;
  if (userId && process.env.NODE_ENV === "development") {
    const path = req.path;
    if (!path.includes("/assets") && !path.includes("/@")) {
      console.log(`[user] ${userId.slice(0, 8)}... ${req.method} ${path}`);
    }
  }
  next();
}
