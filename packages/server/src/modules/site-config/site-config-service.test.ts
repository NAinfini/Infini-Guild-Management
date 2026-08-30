import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_OAUTH_SETTINGS,
  DEFAULT_SITE_STORAGE_POLICY,
} from "@guild/shared";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import {
  SiteConfigService,
  type OAuthProviderAvailability,
  type SiteConfigRecord,
  type SiteConfigStore,
} from "./site-config-service";
import type { MediaService } from "../media/public.js";

const record: SiteConfigRecord = {
  site_name: "Guild",
  site_description: DEFAULT_SITE_DESCRIPTION,
  site_logo_media_id: null,
  default_site_logo_url: "/logo.svg",
  features: DEFAULT_FEATURE_FLAGS,
  oauth: DEFAULT_SITE_OAUTH_SETTINGS,
  media_policy: DEFAULT_SITE_MEDIA_POLICY,
  storage_policy: DEFAULT_SITE_STORAGE_POLICY,
  absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
  analytics_settings: DEFAULT_SITE_ANALYTICS_SETTINGS,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  revisionToken: "site-config-revision-123456",
};

function context(permissions: readonly string[]) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 999,
      permissions,
    }),
    now: "2026-08-09T00:00:00.000Z",
  });
}

function store(overrides: Partial<SiteConfigStore> = {}): SiteConfigStore {
  return {
    get: vi.fn().mockResolvedValue(record),
    update: vi.fn(),
    setLogo: vi.fn(),
    ...overrides,
  };
}

function service(
  value: SiteConfigStore,
  media: Partial<MediaService> = {},
  oauthAvailability?: OAuthProviderAvailability,
) {
  return new SiteConfigService(
    value,
    media as MediaService,
    { publish: vi.fn() },
    { defer: vi.fn() },
    oauthAvailability,
  );
}

describe("SiteConfigService", () => {
  it("keeps analytics private in both public and admin projections", async () => {
    const value = service(store());
    expect(await value.getPublic()).not.toHaveProperty("analytics_settings");
    expect((await value.getAdmin(context(["admin.siteConfig.manage"]))).site).not.toHaveProperty("analytics_settings");
  });

  it("exposes only non-secret OAuth runtime statuses to administrators", async () => {
    const availability: OAuthProviderAvailability = {
      google: true,
      discord: false,
      kook: true,
      wechat: false,
    };
    const value = service(store({
      get: vi.fn().mockResolvedValue({
        ...record,
        oauth: { google: true, discord: true, kook: false, wechat: true },
      }),
    }), {}, availability);

    const admin = await value.getAdmin(context(["admin.siteConfig.manage"]));
    const publicConfig = await value.getPublic();

    expect(admin.oauth_provider_status).toEqual({
      google: "available",
      discord: "missing_credentials",
      kook: "available",
      wechat: "unsupported",
    });
    expect(admin).not.toHaveProperty("client_secret");
    expect(admin).not.toHaveProperty("client_id");
    expect(publicConfig).not.toHaveProperty("oauth_provider_status");
    expect(publicConfig.oauth).toEqual({ google: true, discord: false, kook: false, wechat: false });
  });

  it("rejects enabling a provider without runtime credentials before writing configuration", async () => {
    const update = vi.fn();
    const value = service(store({ update }), {}, {
      google: false,
      discord: false,
      kook: false,
      wechat: false,
    });

    await expect(value.update(context(["admin.siteConfig.manage"]), {
      oauth: { google: true },
      expected_revision_token: record.revisionToken,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    expect(update).not.toHaveBeenCalled();
  });

  it("reads and atomically updates analytics through its dedicated permissions", async () => {
    const update = vi.fn().mockResolvedValue(true);
    const value = service(store({ update }));

    expect(await value.getAnalyticsSettings(context(["admin.analytics.view"])))
      .toEqual(DEFAULT_SITE_ANALYTICS_SETTINGS);
    const result = await value.updateAnalyticsSettings(context(["admin.analytics.manage"]), {
      modifier_weights: { kills: 0.5 },
    });

    expect(result).toEqual({
      ...DEFAULT_SITE_ANALYTICS_SETTINGS,
      modifier_weights: { ...DEFAULT_SITE_ANALYTICS_SETTINGS.modifier_weights, kills: 0.5 },
    });
    expect(update.mock.calls[0]![0]).toMatchObject({
      expectedRevisionToken: record.revisionToken,
      audit: {
        actorKind: "user",
        actorId: "user-1",
        requestId: "request-1",
        subjectType: "analytics_settings",
        subjectId: "site",
        subjectLabel: record.site_name,
        action: "update",
        payload: {
          schema_version: 2,
          changes: [{
            field: "kills_weight",
            before: { type: "number", value: DEFAULT_SITE_ANALYTICS_SETTINGS.modifier_weights.kills },
            after: { type: "number", value: result.modifier_weights.kills },
          }],
          context: [],
        },
      },
    });
  });

  it("deep-merges scalar D1-backed policy sections and uses CAS", async () => {
    const update = vi.fn().mockResolvedValue(true);
    await service(store({ update })).update(context(["admin.siteConfig.manage"]), {
      features: { wiki: false },
      media_policy: { quotas: { wiki: 7 } },
      expected_revision_token: record.revisionToken,
    });

    expect(update).toHaveBeenCalledOnce();
    const mutation = update.mock.calls[0]![0];
    expect(mutation.record.features).toEqual({ ...DEFAULT_FEATURE_FLAGS, wiki: false });
    expect(mutation.record.media_policy.quotas).toEqual({ ...DEFAULT_SITE_MEDIA_POLICY.quotas, wiki: 7 });
    expect(mutation.expectedRevisionToken).toBe(record.revisionToken);
    expect(mutation.audit.requestId).toBe("request-1");
  });

  it("projects and audits a public branding description update", async () => {
    const update = vi.fn().mockResolvedValue(true);
    const value = service(store({ update }));

    expect((await value.getPublic()).site_description).toBe(DEFAULT_SITE_DESCRIPTION);
    await value.update(context(["admin.siteConfig.manage"]), {
      site_description: "A focused home for our guild.",
      expected_revision_token: record.revisionToken,
    });

    expect(update.mock.calls[0]![0]).toMatchObject({
      record: { site_description: "A focused home for our guild." },
      audit: {
        actorKind: "user",
        actorId: "user-1",
        requestId: "request-1",
        subjectType: "site_config",
        subjectId: "site",
        subjectLabel: record.site_name,
        action: "update",
        payload: {
          schema_version: 2,
          changes: [{
            field: "description",
            before: { type: "text", value: DEFAULT_SITE_DESCRIPTION },
            after: { type: "text", value: "A focused home for our guild." },
          }],
          context: [],
        },
      },
    });
  });

  it("uploads one staged logo and attaches it through the atomic config store mutation", async () => {
    const setLogo = vi.fn().mockResolvedValue(true);
    const uploadImages = vi.fn().mockResolvedValue(["123456789012345678901"]);

    const result = await service(store({ setLogo }), { uploadImages }).uploadLogo(
      context(["admin.siteConfig.manage"]),
      { full: new Uint8Array([1]), view: new Uint8Array([2]) },
      record.revisionToken,
    );

    expect(result.site.site_logo_media_id).toBe("123456789012345678901");
    expect(setLogo.mock.calls[0]![0]).toMatchObject({
      mediaId: "123456789012345678901",
      ownerUserId: "user-1",
      expectedRevisionToken: record.revisionToken,
    });
  });

  it("rejects an A/B stale full-config save before writing B's latest record", async () => {
    const update = vi.fn();
    const value = service(store({
      get: vi.fn().mockResolvedValue({ ...record, revisionToken: "site-config-revision-b" }),
      update,
    }));

    await expect(value.update(context(["admin.siteConfig.manage"]), {
      site_description: "A's stale draft",
      expected_revision_token: record.revisionToken,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an A/B stale logo mutation before staging a replacement logo", async () => {
    const setLogo = vi.fn();
    const uploadImages = vi.fn();
    const value = service(store({
      get: vi.fn().mockResolvedValue({ ...record, revisionToken: "site-config-revision-b" }),
      setLogo,
    }), { uploadImages });

    await expect(value.uploadLogo(
      context(["admin.siteConfig.manage"]),
      { full: new Uint8Array([1]), view: new Uint8Array([2]) },
      record.revisionToken,
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(uploadImages).not.toHaveBeenCalled();
    expect(setLogo).not.toHaveBeenCalled();
  });
});
