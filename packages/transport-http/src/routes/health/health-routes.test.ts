import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { HttpEnv } from "../../core/http-env.js";
import { createHealthRoutes } from "./health-routes.js";

function app(check: () => Promise<void>) {
  const value = new Hono<HttpEnv>();
  value.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "health-request",
      now: "2026-08-09T00:00:00.000Z",
      authorization: createAuthorizationContext(null),
    }));
    await next();
  });
  value.route("/api/health", createHealthRoutes({ service: { check } }));
  return value;
}

describe("health HTTP route", () => {
  it("returns the stable public liveness contract", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const response = await app(check).request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=30, must-revalidate, no-transform",
    );
    expect(await response.json()).toEqual({ ok: true, request_id: "health-request" });
    expect(check).toHaveBeenCalledOnce();
  });

  it("fails closed without exposing the database error", async () => {
    const response = await app(vi.fn().mockRejectedValue(new Error("secret database path")))
      .request("/api/health");
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, request_id: "health-request" });
  });
});
