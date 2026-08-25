import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { DEFAULT_SITE_OAUTH_SETTINGS } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createRequestBodyLimitMiddleware } from "../../core/body-limit.js";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createMutationSecurityMiddleware } from "../../core/mutation-security.js";
import {
  createAdminAnalyticsSettingsRoutes,
  createAdminSiteConfigRoutes,
  createPublicSiteConfigRoutes,
} from "./site-config-routes.js";

const site = {
  site_name: "Infini Guild",
  site_description: "A focused home for our guild.",
  site_logo_media_id: null,
  default_site_logo_url: "/guild-logo.svg",
  features: {
    announcements: true,
    events: true,
    guildWar: true,
    gallery: true,
    wiki: true,
    tools: true,
    storage: true,
  },
  oauth: DEFAULT_SITE_OAUTH_SETTINGS,
  media_policy: {
    max_file_size_bytes: {
      site_logo: 1_000_000,
      class_icon: 1_000_000,
      profile_image: 1_000_000,
      profile_audio: 1_000_000,
      announcement_image: 1_000_000,
      announcement_attachment: 1_000_000,
      wiki_image: 1_000_000,
      event_image: 1_000_000,
      gallery_image: 1_000_000,
      storage_image: 1_000_000,
    },
    quotas: { profile: 5, announcement: 5, announcement_attachments: 5, gallery: 5, wiki: 5 },
  },
  storage_policy: { images_per_item: 5 },
  absence_policy: { max_span_days: 30, max_entries_per_user: 10 },
  created_at: "2026-08-09T00:00:00.000Z",
  updated_at: "2026-08-09T00:00:00.000Z",
} as const;

const { created_at: _createdAt, updated_at: _updatedAt, ...publicSite } = site;

const adminSiteConfig = {
  site,
  oauth_provider_status: {
    google: "missing_credentials",
    discord: "available",
    kook: "missing_credentials",
    wechat: "unsupported",
  },
} as const;

function appWithContext(permissions: readonly string[]) {
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      now: "2026-08-09T00:00:00.000Z",
      authorization: createAuthorizationContext({
        userId: "user-1",
        sessionId: "session-1",
        roleId: "admin",
        roleLevel: 999,
        permissions: new Set(permissions),
      }),
    }));
    await next();
  });
  return app;
}

describe("site config HTTP routes", () => {
  it("keeps the public Portal response at /api/site-config", async () => {
    const getPublic = vi.fn().mockResolvedValue(publicSite);
    const app = appWithContext([]);
    app.route("/api/site-config", createPublicSiteConfigRoutes({ service: { getPublic } }));

    const response = await app.request("/api/site-config");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(publicSite);
    expect(getPublic).toHaveBeenCalledOnce();
  });

  it("rejects an invalid service projection at the HTTP response boundary", async () => {
    const app = appWithContext([]);
    app.route("/api/site-config", createPublicSiteConfigRoutes({
      service: { getPublic: vi.fn().mockResolvedValue({ ...publicSite, site_name: "" }) },
    }));

    const response = await app.request("/api/site-config");

    expect(response.status).toBe(500);
  });

  it("returns non-secret OAuth status only from the admin configuration route", async () => {
    const getAdmin = vi.fn().mockResolvedValue(adminSiteConfig);
    const app = appWithContext(["admin.siteConfig.manage"]);
    app.route("/api/admin/site-config", createAdminSiteConfigRoutes({
      service: { getAdmin, update: vi.fn(), uploadLogo: vi.fn() },
    }));

    const response = await app.request("/api/admin/site-config");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(adminSiteConfig);
    expect(getAdmin).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-1" }));
  });

  it("validates admin updates before calling the service", async () => {
    const update = vi.fn().mockResolvedValue(adminSiteConfig);
    const app = appWithContext(["admin.siteConfig.manage"]);
    app.route("/api/admin/site-config", createAdminSiteConfigRoutes({
      service: { getAdmin: vi.fn(), update, uploadLogo: vi.fn() },
    }));

    const invalid = await app.request("/api/admin/site-config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unknown: true }),
    });
    expect(invalid.status).toBe(400);
    expect(update).not.toHaveBeenCalled();

    const secretInPayload = await app.request("/api/admin/site-config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oauth: { google: true, client_secret: "must-not-cross-the-api" } }),
    });
    expect(secretInPayload.status).toBe(400);
    expect(update).not.toHaveBeenCalled();

    const valid = await app.request("/api/admin/site-config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_name: "New Guild" }),
    });
    expect(valid.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-1" }), {
      site_name: "New Guild",
    });

    const description = await app.request("/api/admin/site-config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_description: "  A new public preview.  " }),
    });
    expect(description.status).toBe(200);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: "request-1" }), {
      site_description: "A new public preview.",
    });
  });

  it("can be composition-gated by the shared mutation and body middleware", async () => {
    const update = vi.fn();
    const app = appWithContext(["admin.siteConfig.manage"]);
    app.use("*", createMutationSecurityMiddleware({ expectedOrigin: "https://guild.example" }));
    app.use("*", createRequestBodyLimitMiddleware());
    app.route("/api/admin/site-config", createAdminSiteConfigRoutes({
      service: { getAdmin: vi.fn(), update, uploadLogo: vi.fn() },
    }));

    expect((await app.request("/api/admin/site-config", { method: "PATCH", body: "{}" })).status).toBe(403);
    const oversized = await app.request("/api/admin/site-config", {
      method: "PATCH",
      headers: {
        "Content-Length": String(1024 * 1024 + 1),
        "Content-Type": "application/json",
        Origin: "https://guild.example",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: "{}",
    });
    expect(oversized.status).toBe(413);
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the dedicated analytics settings wire contract", async () => {
    const settings = {
      reference_duration_minutes: 30,
      modifier_weights: { kills: 0.3, towers: 0.1, base_hp: 0.15, credits: 0.3, distance: 0.15 },
    };
    const getAnalyticsSettings = vi.fn().mockResolvedValue(settings);
    const updateAnalyticsSettings = vi.fn().mockResolvedValue({
      ...settings,
      modifier_weights: { ...settings.modifier_weights, kills: 0.5 },
    });
    const app = appWithContext(["admin.analytics.view", "admin.analytics.manage"]);
    app.route("/api/admin/analytics-settings", createAdminAnalyticsSettingsRoutes({
      service: { getAnalyticsSettings, updateAnalyticsSettings },
    }));

    expect(await (await app.request("/api/admin/analytics-settings")).json()).toEqual(settings);
    const response = await app.request("/api/admin/analytics-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modifier_weights: { kills: 0.5 } }),
    });
    expect(response.status).toBe(200);
    expect(updateAnalyticsSettings).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "request-1" }),
      { modifier_weights: { kills: 0.5 } },
    );
  });
});
