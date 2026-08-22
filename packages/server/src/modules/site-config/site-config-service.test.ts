import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
} from "@guild/shared";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { SiteConfigService, type SiteConfigRecord, type SiteConfigStore } from "./site-config-service";
import type { MediaService } from "../media/public.js";

const record: SiteConfigRecord = {
  site_name: "Guild",
  site_description: DEFAULT_SITE_DESCRIPTION,
  site_logo_media_id: null,
  default_site_logo_url: "/logo.svg",
  features: DEFAULT_FEATURE_FLAGS,
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

function service(value: SiteConfigStore, media: Partial<MediaService> = {}) {
  return new SiteConfigService(value, media as MediaService, { publish: vi.fn() }, { defer: vi.fn() });
}

describe("SiteConfigService", () => {
  it("keeps analytics private in both public and admin projections", async () => {
    const value = service(store());
    expect(await value.getPublic()).not.toHaveProperty("analytics_settings");
    expect((await value.getAdmin(context(["admin.siteConfig.manage"]))).site).not.toHaveProperty("analytics_settings");
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
    );

    expect(result.site.site_logo_media_id).toBe("123456789012345678901");
    expect(setLogo.mock.calls[0]![0]).toMatchObject({
      mediaId: "123456789012345678901",
      ownerUserId: "user-1",
      expectedRevisionToken: record.revisionToken,
    });
  });
});
