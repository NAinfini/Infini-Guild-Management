import { describe, expect, it } from "vitest";
import {
  AppError,
  createAuthorizationContext,
  createRequestContext,
  normalizeBlobRange,
  secureRandom,
} from "./public.js";

describe("kernel invariants", () => {
  it("keeps authorization tied to an immutable snapshot of the real actor", () => {
    const sourcePermissions = new Set(["events.edit"]);
    const authorization = createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "role-1",
      roleLevel: 50,
      permissions: sourcePermissions,
    });

    sourcePermissions.add("admin.users.edit");
    expect(authorization.has("events.edit")).toBe(true);
    expect(authorization.has("admin.users.edit")).toBe(false);
    expect(authorization.require("events.edit").userId).toBe("user-1");
  });

  it("cannot mutate the actor or its permission snapshot at runtime", () => {
    const authorization = createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "role-1",
      roleLevel: 50,
      permissions: ["events.edit"],
    });

    expect(() => {
      (authorization as unknown as { actor: null }).actor = null;
    }).toThrow(TypeError);
    expect(() => {
      (authorization.actor!.permissions as Set<string>).add("admin.users.edit");
    }).toThrow(TypeError);
    expect(authorization.has("admin.users.edit")).toBe(false);
    expect([...authorization.actor!.permissions]).toEqual(["events.edit"]);
  });

  it("distinguishes unauthenticated and unauthorized requests", () => {
    const anonymous = createAuthorizationContext(null);
    expect(() => anonymous.require("events.edit")).toThrowError(
      expect.objectContaining({ code: "UNAUTHORIZED", status: 401 }),
    );

    const member = createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "role-1",
      roleLevel: 10,
      permissions: [],
    });
    expect(() => member.require("events.edit")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
    );
  });

  it("normalizes request time once and emits the Portal error envelope", () => {
    const context = createRequestContext({
      requestId: "request-1",
      authorization: createAuthorizationContext(null),
      now: "2026-08-09T12:34:56-04:00",
    });
    const error = new AppError({
      code: "CONFLICT",
      status: 409,
      message: "Already changed",
      details: { version: 2 },
    });

    expect(context.now).toBe("2026-08-09T16:34:56.000Z");
    expect(error.toResponseBody(context.requestId)).toEqual({
      error_code: "CONFLICT",
      message: "Already changed",
      request_id: "request-1",
      details: { version: 2 },
    });
  });

  it("rejects contradictory error codes and HTTP statuses", () => {
    expect(() => new AppError({
      code: "UNAUTHORIZED",
      status: 500,
      message: "Contradictory",
    })).toThrow("UNAUTHORIZED errors must use HTTP 401");
  });

  it("clamps valid byte ranges and rejects ranges outside the object", () => {
    expect(normalizeBlobRange({ offset: 8, length: 10 }, 12)).toEqual({ offset: 8, length: 4 });
    expect(() => normalizeBlobRange({ offset: 12, length: 1 }, 12)).toThrow(RangeError);
  });

  it("keeps secureRandom inside the Math.random contract without being constant", () => {
    const draws = Array.from({ length: 1000 }, () => secureRandom());
    for (const value of draws) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});
