import { createAuthorizationContext, type RateLimitDecision } from "@guild/kernel";
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  publicSiteConfigSchema,
} from "@guild/shared";
import { describe, expect, it, vi } from "vitest";
import { createPortalApiApp } from "./portal-api.js";
import type { ApplicationServices } from "./services.js";

const PUBLIC_ORIGIN = "https://guild.example";
const TOKEN_SECRET = new Uint8Array(32).fill(7);
const PUBLIC_SITE_CONFIG = publicSiteConfigSchema.parse({
  site_name: "Guild",
  site_logo_media_id: null,
  default_site_logo_url: "/guild-logo.svg",
  features: DEFAULT_FEATURE_FLAGS,
  media_policy: DEFAULT_SITE_MEDIA_POLICY,
  storage_policy: DEFAULT_SITE_STORAGE_POLICY,
  absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
});

describe("Portal API composition", () => {
  it("resolves the session once and mounts the public site-config contract", async () => {
    const fixture = createFixture();
    const response = await fixture.app.request("/api/site-config", {
      headers: { Cookie: "ig_session=session-token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PUBLIC_SITE_CONFIG);
    expect(fixture.resolveAuthorization).toHaveBeenCalledOnce();
    expect(fixture.resolveAuthorization).toHaveBeenCalledWith("session-token", expect.any(String));
    expect(response.headers.get("X-Request-Id")).toMatch(/\S/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects cross-origin mutations before session or body work", async () => {
    const fixture = createFixture();
    const response = await fixture.app.request("/api/not-a-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error_code: "FORBIDDEN" });
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("enforces the ordinary body limit before session resolution", async () => {
    const fixture = createFixture();
    const response = await fixture.app.request("/api/not-a-route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "1048577",
        Origin: PUBLIC_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: "{}",
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("rate-limits accepted mutations before reading their body or session", async () => {
    const fixture = createFixture();
    fixture.mutationConsume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 9 });
    const response = await fixture.app.request("/api/not-a-route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: PUBLIC_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: "{}",
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error_code: "RATE_LIMITED",
      details: { retry_after_seconds: 9 },
    });
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("returns the canonical error envelope for unknown API routes", async () => {
    const fixture = createFixture();
    const response = await fixture.app.request("/api/not-a-route");
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error_code: "NOT_FOUND", message: "API route not found" });
    expect(body.request_id).toBe(response.headers.get("X-Request-Id"));
  });

  it("rate-limits reads before resolving a session", async () => {
    const fixture = createFixture();
    fixture.readConsume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 4 });

    const response = await fixture.app.request("/api/site-config");

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error_code: "RATE_LIMITED",
      details: { retry_after_seconds: 4 },
    });
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("rejects unsupported methods before body or session work", async () => {
    const fixture = createFixture();

    const response = await fixture.app.request("/api/site-config", { method: "OPTIONS" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(fixture.readConsume).not.toHaveBeenCalled();
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("keeps health independent from session resolution when the database is unavailable", async () => {
    const fixture = createFixture();
    fixture.healthCheck.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await fixture.app.request("/api/health", {
      headers: { Cookie: "ig_session=session-token" },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, request_id: expect.any(String) });
    expect(fixture.clientIdentifier).not.toHaveBeenCalled();
    expect(fixture.readConsume).not.toHaveBeenCalled();
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const healthCheck = vi.fn().mockResolvedValue(undefined);
  const resolveAuthorization = vi.fn(async () => ({
    authorization: createAuthorizationContext(null),
    session: null,
  }));
  const services = {
    adminStatus: {},
    announcements: {},
    audit: {},
    auditArchive: {},
    auth: { resolveAuthorization },
    events: {},
    gallery: {},
    guildWar: {},
    health: { check: healthCheck },
    identityAdmin: {},
    media: {},
    memberCatalog: {},
    members: {},
    portalReadModels: {},
    siteConfig: { getPublic: vi.fn(async () => PUBLIC_SITE_CONFIG) },
    storage: {},
    systemTest: {},
    wiki: {},
  } as unknown as ApplicationServices;
  const mutationConsume = vi.fn(async (): Promise<RateLimitDecision> => ({ allowed: true }));
  const readConsume = vi.fn(async (): Promise<RateLimitDecision> => ({ allowed: true }));
  const clientIdentifier = vi.fn(() => "127.0.0.1");
  const app = createPortalApiApp(services, {
    authRateLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
    readRateLimiter: { consume: readConsume },
    mutationRateLimiter: { consume: mutationConsume },
    uploadRateLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
    deferred: { defer: vi.fn() },
    clientIdentifier,
  }, {
    publicUrl: PUBLIC_ORIGIN,
    auditDownloadSecret: TOKEN_SECRET,
  });
  return { app, clientIdentifier, healthCheck, mutationConsume, readConsume, resolveAuthorization };
}
