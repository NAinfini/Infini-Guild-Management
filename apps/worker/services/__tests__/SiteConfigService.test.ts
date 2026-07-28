import { describe, expect, it, vi } from "vitest";
import { SiteConfigService } from "../SiteConfigService";

const NOW = new Date("2026-06-12T12:00:00.000Z");

const SEEDED_SITE_ROW = {
  id: "default",
  siteName: "D1 Guild",
  siteLogoUrl: "/d1-logo.webp",
  featureFlagsJson: JSON.stringify({
    announcements: true,
    events: true,
    guildWar: true,
    gallery: true,
    wiki: true,
    tools: true,
    equipmentCalc: false,
    storage: true,
  }),
  mediaPolicyJson: JSON.stringify({
    max_file_size_bytes: {
      profile_image: 5242880,
      profile_audio: 20971520,
      announcement_image: 5242880,
      wiki_image: 5242880,
      event_image: 5242880,
      gallery_image: 10485760,
    },
    quotas: {
      profile: 10,
      announcement: 10,
      gallery: 20,
      wiki: 10,
    },
  }),
  storagePolicyJson: JSON.stringify({
    images_per_item: 5,
  }),
  absencePolicyJson: JSON.stringify({
    max_span_days: 366,
    max_entries_per_user: 20,
  }),
  analyticsSettingsJson: JSON.stringify({
    reference_duration_minutes: 45,
    modifier_weights: { kills: 0.7, basehp: 0.3 },
  }),
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

function queryFromRows(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return query;
}

function selectQueue(rows: unknown[][]) {
  return vi.fn(() => ({
    from: vi.fn(() => queryFromRows(rows.shift() ?? [])),
  }));
}

function createDb(selectRows: unknown[][] = []) {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const update = vi.fn(() => ({ set }));
  return {
    db: { select: selectQueue(selectRows), insert, update },
    calls: { values, set },
  };
}

function createService(selectRows: unknown[][] = []) {
  const { db, calls } = createDb(selectRows);
  const deps = {
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    storeSiteLogo: vi.fn(),
    deleteMediaObject: vi.fn(),
    generateId: vi.fn(() => "generated-id"),
    now: () => NOW,
    envSiteName: "Env Guild",
    envSiteLogoUrl: "/env-logo.webp",
  };
  return { service: new SiteConfigService(db as never, deps), deps, calls };
}

describe("SiteConfigService", () => {
  it("falls back to environment branding when no site config row exists", async () => {
    const { service } = createService([[]]);

    const result = await service.getPublicConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      site_name: "Env Guild",
      site_logo_url: "/env-logo.webp",
      features: expect.objectContaining({ storage: true }),
      storage_policy: { images_per_item: 5 },
    });
  });

  it("returns D1-managed feature flags and policies in public config", async () => {
    const { service } = createService([[SEEDED_SITE_ROW]]);

    const result = await service.getPublicConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      site_name: "D1 Guild",
      site_logo_url: "/d1-logo.webp",
      features: expect.objectContaining({ equipmentCalc: false, storage: true }),
      media_policy: expect.objectContaining({
        max_file_size_bytes: expect.objectContaining({ gallery_image: 10485760 }),
      }),
      storage_policy: { images_per_item: 5 },
      absence_policy: { max_span_days: 366, max_entries_per_user: 20 },
    });
  });

  it("logs an error instead of silently serving defaults over a corrupt feature flag blob", async () => {
    // A corrupt blob re-enables every feature flag, and the flags gate whole API
    // prefixes — so this must never happen quietly.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { service } = createService([[{ ...SEEDED_SITE_ROW, featureFlagsJson: "{not json" }]]);

    const result = await service.getPublicConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // equipmentCalc was false in the stored row; the default is true.
    expect(result.data.features.equipmentCalc).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toContain("feature_flags_json");
    consoleError.mockRestore();
  });

  it("keeps analytics settings out of general admin site config", async () => {
    const { service } = createService([[SEEDED_SITE_ROW]]);

    const result = await service.getAdminConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.site).not.toHaveProperty("analytics_settings");
  });

  it("returns analytics settings through the dedicated analytics API service", async () => {
    const { service } = createService([[SEEDED_SITE_ROW]]);

    const result = await service.getAnalyticsSettings();

    expect(result).toEqual({
      ok: true,
      data: {
        reference_duration_minutes: 45,
        modifier_weights: { kills: 0.7, basehp: 0.3 },
      },
    });
  });

  it("updates admin site config and writes an audit diff", async () => {
    const { service, deps, calls } = createService([
      [{ id: "default", siteName: "Old Guild", siteLogoUrl: "/old.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ id: "default", siteName: "New Guild", siteLogoUrl: "/new.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    ]);

    const result = await service.updateAdminConfig("admin-1", {
      site_name: "New Guild",
    });

    expect(result.ok).toBe(true);
    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({
      siteName: "New Guild",
    }));
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "site_config",
      action: "update",
      actorId: "admin-1",
      entityId: "default",
      diffTitle: "Site Config",
    }));
  });

  it("uploads a site logo, stores the internal logo URL, and removes the previous managed logo", async () => {
    const { service, deps, calls } = createService([
      [{ id: "default", siteName: "Guild", siteLogoUrl: "/api/site-config/logo?key=site%2Flogo%2Fold.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ id: "default", siteName: "Guild", siteLogoUrl: "/api/site-config/logo?key=site%2Flogo%2Fold.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ id: "default", siteName: "Guild", siteLogoUrl: "/api/site-config/logo?key=site%2Flogo%2Fnew.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    ]);
    deps.storeSiteLogo = vi.fn().mockResolvedValue("site/logo/new.webp");
    deps.deleteMediaObject = vi.fn().mockResolvedValue(undefined);
    const file = new File(["RIFF____WEBP"], "logo.webp", { type: "image/webp" });

    const result = await service.uploadSiteLogo("admin-1", file);

    expect(result.ok).toBe(true);
    expect(deps.storeSiteLogo).toHaveBeenCalledWith(file);
    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({
      siteLogoUrl: "/api/site-config/logo?key=site%2Flogo%2Fnew.webp",
    }));
    expect(deps.deleteMediaObject).toHaveBeenCalledWith("site/logo/old.webp");
  });

  it("rejects oversized site logos before writing to storage", async () => {
    const { service, deps } = createService([[SEEDED_SITE_ROW]]);
    deps.storeSiteLogo = vi.fn().mockResolvedValue("site/logo/new.webp");
    const file = new File([new Uint8Array(6 * 1024 * 1024)], "logo.webp", { type: "image/webp" });

    const result = await service.uploadSiteLogo("admin-1", file);

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(deps.storeSiteLogo).not.toHaveBeenCalled();
  });

});
