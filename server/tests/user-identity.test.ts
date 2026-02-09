/**
 * USER IDENTITY TESTS
 *
 * Tests for cookie-based anonymous user identity.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  generateUserId,
  getUserIdFromRequest,
  setUserIdCookie,
  ensureUserId,
  getUserId,
} from "../user-identity";

describe("User Identity", () => {
  describe("generateUserId", () => {
    it("should generate a UUID", () => {
      const userId = generateUserId();
      expect(userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("should generate unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateUserId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("getUserIdFromRequest", () => {
    it("should return userId from cookies", () => {
      const req = {
        cookies: { routed_uid: "test-user-123" },
      } as unknown as Request;

      const userId = getUserIdFromRequest(req);
      expect(userId).toBe("test-user-123");
    });

    it("should return undefined if cookie not present", () => {
      const req = {
        cookies: {},
      } as unknown as Request;

      const userId = getUserIdFromRequest(req);
      expect(userId).toBeUndefined();
    });

    it("should return undefined if cookies is undefined", () => {
      const req = {} as unknown as Request;

      const userId = getUserIdFromRequest(req);
      expect(userId).toBeUndefined();
    });
  });

  describe("setUserIdCookie", () => {
    it("should set cookie with correct options", () => {
      const cookieFn = vi.fn();
      const res = { cookie: cookieFn } as unknown as Response;

      setUserIdCookie(res, "new-user-456");

      expect(cookieFn).toHaveBeenCalledWith(
        "routed_uid",
        "new-user-456",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        })
      );

      // Should have max age of 1 year
      const options = cookieFn.mock.calls[0][2];
      expect(options.maxAge).toBe(365 * 24 * 60 * 60 * 1000);
    });
  });

  describe("ensureUserId middleware", () => {
    it("should use existing userId from cookie", () => {
      const req = {
        cookies: { routed_uid: "existing-user" },
      } as unknown as Request;
      const res = {
        cookie: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      ensureUserId(req, res, next);

      // Should not set new cookie
      expect(res.cookie).not.toHaveBeenCalled();
      // Should attach userId to request
      expect((req as any).userId).toBe("existing-user");
      // Should call next
      expect(next).toHaveBeenCalled();
    });

    it("should create new userId if cookie missing", () => {
      const req = {
        cookies: {},
      } as unknown as Request;
      const res = {
        cookie: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      ensureUserId(req, res, next);

      // Should set new cookie
      expect(res.cookie).toHaveBeenCalled();
      const cookieArgs = (res.cookie as any).mock.calls[0];
      expect(cookieArgs[0]).toBe("routed_uid");
      expect(cookieArgs[1]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Should attach new userId to request
      expect((req as any).userId).toBeDefined();
      expect((req as any).userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Should call next
      expect(next).toHaveBeenCalled();
    });
  });

  describe("getUserId", () => {
    it("should return userId from request", () => {
      const req = {
        userId: "attached-user-id",
        cookies: { routed_uid: "cookie-user-id" },
      } as unknown as Request;

      const userId = getUserId(req);
      expect(userId).toBe("attached-user-id");
    });

    it("should fall back to cookie if userId not attached", () => {
      const req = {
        cookies: { routed_uid: "cookie-user-id" },
      } as unknown as Request;

      const userId = getUserId(req);
      expect(userId).toBe("cookie-user-id");
    });

    it("should throw if no userId available", () => {
      const req = {
        cookies: {},
      } as unknown as Request;

      expect(() => getUserId(req)).toThrow(
        "User ID not found. Ensure ensureUserId middleware is applied."
      );
    });
  });
});
