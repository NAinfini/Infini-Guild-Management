import { createAuthorizationContext, type RateLimitDecision } from "@guild/kernel";
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  memberProfileRevisionEtag,
  publicSiteConfigSchema,
  type MemberProfile,
} from "@guild/shared";
import { describe, expect, it, vi } from "vitest";
import { createPortalApiApp } from "./portal-api.js";
import type { ApplicationServices } from "./services.js";

const PUBLIC_ORIGIN = "https://guild.example";
const PUBLIC_SITE_CONFIG = publicSiteConfigSchema.parse({
  site_name: "Guild",
  site_description: "A focused home for our guild.",
  site_logo_media_id: null,
  default_site_logo_url: "/guild-logo.svg",
  features: DEFAULT_FEATURE_FLAGS,
  oauth: { google: false, discord: false, kook: false, wechat: false },
  media_policy: DEFAULT_SITE_MEDIA_POLICY,
  storage_policy: DEFAULT_SITE_STORAGE_POLICY,
  absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
});

describe("Portal API composition", () => {
  it("resolves the session once and mounts the public site-config contract", async () => {
    const fixture = createFixture();
    const response = await fixture.app.request("/api/site-config", {
      headers: { Cookie: "__Host-ig_session=session-token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PUBLIC_SITE_CONFIG);
    expect(fixture.resolveAuthorization).toHaveBeenCalledOnce();
    expect(fixture.resolveAuthorization).toHaveBeenCalledWith("session-token", expect.any(String));
    expect(response.headers.get("X-Request-Id")).toMatch(/\S/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the saved profile revision in JSON through the complete API middleware chain", async () => {
    const fixture = createFixture();
    const profile: MemberProfile = {
      user_id: "member-1",
      power: 0,
      classes: [],
      title_html: null,
      bio: "Saved",
      avatar_media_id: null,
      images: [],
      audio_media_id: null,
      audio_name: null,
      video_urls: [],
      availability: null,
      vacation_start: null,
      vacation_end: null,
      notes: null,
      created_at: "2026-08-30T00:00:00.000Z",
      updated_at: "2026-08-30T00:00:00.000Z",
    };
    fixture.resolveAuthorization.mockResolvedValue({
      authorization: createAuthorizationContext({
        userId: "member-1",
        sessionId: "session-1",
        roleId: "member",
        roleLevel: 10,
        permissions: [],
        sessionScope: "normal",
      }),
      session: null,
    });
    fixture.members.updateProfile.mockResolvedValue({ profile, revisionToken: "profile-v2" });

    const response = await fixture.app.request("/api/users/member-1/profile", {
      method: "PATCH",
      headers: {
        Cookie: "__Host-ig_session=session-token",
        "Content-Type": "application/json",
        "If-Match": memberProfileRevisionEtag("profile-v1"),
        Origin: PUBLIC_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ bio: "Saved" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(memberProfileRevisionEtag("profile-v2"));
    expect(await response.json()).toEqual({ ...profile, profile_revision_token: "profile-v2" });
    expect(fixture.members.updateProfile).toHaveBeenCalledWith(
      expect.anything(),
      "member-1",
      { bio: "Saved" },
      memberProfileRevisionEtag("profile-v1"),
    );
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

  it("uses a dedicated client budget for announcement and Wiki open counters", async () => {
    const fixture = createFixture();
    fixture.contentViewConsume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 7 });

    const response = await fixture.app.request("/api/announcements/announcement-1/view", {
      method: "POST",
      headers: {
        Origin: PUBLIC_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error_code: "RATE_LIMITED",
      details: { retry_after_seconds: 7 },
    });
    expect(fixture.contentViewConsume).toHaveBeenCalledWith("api:content-view:client:127.0.0.1");
    expect(fixture.mutationConsume).not.toHaveBeenCalled();
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("adds an account budget to signed-in content opens", async () => {
    const fixture = createFixture();
    fixture.resolveAuthorization.mockResolvedValue({
      authorization: createAuthorizationContext({
        userId: "member-1",
        sessionId: "session-1",
        roleId: "member",
        roleLevel: 10,
        permissions: [],
        sessionScope: "normal",
      }),
      session: null,
    });
    fixture.contentViewConsume
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 5 });

    const response = await fixture.app.request("/api/wiki/articles/getting-started/view", {
      method: "POST",
      headers: {
        Cookie: "__Host-ig_session=session-token",
        Origin: PUBLIC_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error_code: "RATE_LIMITED",
      details: { retry_after_seconds: 5 },
    });
    expect(fixture.contentViewConsume.mock.calls).toEqual([
      ["api:content-view:client:127.0.0.1"],
      ["api:content-view:account:member-1"],
    ]);
    expect(fixture.mutationConsume).not.toHaveBeenCalled();
    expect(fixture.resolveAuthorization).toHaveBeenCalledOnce();
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

  it("applies the additional expensive-read budget to public search", async () => {
    const fixture = createFixture();
    fixture.expensiveReadConsume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 12 });

    const response = await fixture.app.request("/api/search?q=member");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(fixture.readConsume).toHaveBeenCalledOnce();
    expect(fixture.expensiveReadConsume).toHaveBeenCalledWith("api:expensive-read:127.0.0.1");
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

  it("rate-limits health without resolving a session", async () => {
    const fixture = createFixture();
    fixture.readConsume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 6 });

    const response = await fixture.app.request("/api/health", {
      headers: { Cookie: "__Host-ig_session=session-token" },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("6");
    expect(fixture.clientIdentifier).toHaveBeenCalledOnce();
    expect(fixture.readConsume).toHaveBeenCalledOnce();
    expect(fixture.healthCheck).not.toHaveBeenCalled();
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("blocks every non-auth route during a password-change session", async () => {
    const fixture = createFixture();
    fixture.resolveAuthorization.mockResolvedValue({
      authorization: createAuthorizationContext({
        userId: "member-1",
        sessionId: "password-change-session",
        roleId: "member",
        roleLevel: 10,
        permissions: [],
        sessionScope: "password_change",
      }),
      session: null,
    });

    const active = await fixture.app.request("/api/important-notices/active", {
      headers: { Cookie: "__Host-ig_session=session-token" },
    });
    const markRead = await fixture.app.request("/api/important-notices/read", {
      method: "PATCH",
      headers: {
        Cookie: "__Host-ig_session=session-token",
        "Content-Type": "application/json",
        Origin: PUBLIC_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ all: true }),
    });
    const acknowledge = await fixture.app.request("/api/important-notices/notice-1/acknowledgement", {
      method: "PUT",
      headers: {
        Cookie: "__Host-ig_session=session-token",
        Origin: PUBLIC_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    expect([active.status, markRead.status, acknowledge.status]).toEqual([403, 403, 403]);
    expect(fixture.importantNotices.acknowledge).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const healthCheck = vi.fn().mockResolvedValue(undefined);
  const importantNotices = {
    listActive: vi.fn(async () => []),
    markRead: vi.fn(async () => ({ updated: 0 })),
    acknowledge: vi.fn(async () => ({ ok: true as const })),
  };
  const resolveAuthorization = vi.fn(async () => ({
    authorization: createAuthorizationContext(null),
    session: null,
  }));
  const members = { updateProfile: vi.fn() };
  const services = {
    adminOperations: {},
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
    importantNotices,
    media: {},
    memberCatalog: {},
    members,
    portalReadModels: {},
    siteConfig: { getPublic: vi.fn(async () => PUBLIC_SITE_CONFIG) },
    storage: {},
    systemTest: {},
    wiki: {},
  } as unknown as ApplicationServices;
  const mutationConsume = vi.fn(async (): Promise<RateLimitDecision> => ({ allowed: true }));
  const contentViewConsume = vi.fn(async (): Promise<RateLimitDecision> => ({ allowed: true }));
  const readConsume = vi.fn(async (): Promise<RateLimitDecision> => ({ allowed: true }));
  const expensiveReadConsume = vi.fn(async (): Promise<RateLimitDecision> => ({ allowed: true }));
  const clientIdentifier = vi.fn(() => "127.0.0.1");
  const app = createPortalApiApp(services, {
    authRateLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
    readRateLimiter: { consume: readConsume },
    expensiveReadRateLimiter: { consume: expensiveReadConsume },
    contentViewRateLimiter: { consume: contentViewConsume },
    mutationRateLimiter: { consume: mutationConsume },
    uploadRateLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
    deferred: { defer: vi.fn() },
    clientIdentifier,
  }, {
    publicUrl: PUBLIC_ORIGIN,
  });
  return {
    app,
    clientIdentifier,
    contentViewConsume,
    expensiveReadConsume,
    healthCheck,
    importantNotices,
    members,
    mutationConsume,
    readConsume,
    resolveAuthorization,
  };
}
