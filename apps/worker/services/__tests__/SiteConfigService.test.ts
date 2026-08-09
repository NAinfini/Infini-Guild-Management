import { describe, expect, it, vi } from "vitest";
import { SiteConfigService } from "../SiteConfigService";

const NOW = new Date("2026-06-12T12:00:00.000Z");

const SITE_ROW = {
  id: "default",
  siteName: "D1 Guild",
  featureAnnouncementsEnabled: true,
  featureEventsEnabled: true,
  featureGuildWarEnabled: true,
  featureGalleryEnabled: false,
  featureWikiEnabled: true,
  featureToolsEnabled: true,
  featureStorageEnabled: true,
  mediaSiteLogoMaxBytes: 2 * 1024 * 1024,
  mediaClassIconMaxBytes: 512 * 1024,
  mediaProfileImageMaxBytes: 5 * 1024 * 1024,
  mediaProfileAudioMaxBytes: 20 * 1024 * 1024,
  mediaAnnouncementImageMaxBytes: 5 * 1024 * 1024,
  mediaWikiImageMaxBytes: 5 * 1024 * 1024,
  mediaEventImageMaxBytes: 5 * 1024 * 1024,
  mediaGalleryImageMaxBytes: 10 * 1024 * 1024,
  mediaStorageImageMaxBytes: 5 * 1024 * 1024,
  mediaProfileQuota: 10,
  mediaAnnouncementQuota: 10,
  mediaGalleryQuota: 20,
  mediaWikiQuota: 10,
  storageImagesPerItem: 5,
  absenceMaxSpanDays: 366,
  absenceMaxEntriesPerUser: 20,
  analyticsReferenceDurationMinutes: 45,
  analyticsKillsWeight: 0.4,
  analyticsTowersWeight: 0.1,
  analyticsBaseHpWeight: 0.2,
  analyticsCreditsWeight: 0.2,
  analyticsDistanceWeight: 0.1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

function queryFromRows(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const query = {
    where: vi.fn(() => query),
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

function createService(selectRows: unknown[][] = []) {
  const set = vi.fn((_values: unknown) => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const mediaService = {
    listLinkedMediaIds: vi.fn().mockResolvedValue([]),
    createImages: vi.fn().mockResolvedValue({ mediaIds: ["media1234567890abcdef"] }),
    replace: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    mediaService: mediaService as never,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    envSiteLogoUrl: "/default-logo.webp",
  };
  const db = {
    select: selectQueue(selectRows),
    update: vi.fn(() => ({ set })),
  };
  return {
    service: new SiteConfigService(db as never, deps),
    deps,
    mediaService,
    set,
  };
}

describe("SiteConfigService", () => {
  it("assembles the public API shape directly from relational D1 columns", async () => {
    const { service, mediaService } = createService([[SITE_ROW]]);
    mediaService.listLinkedMediaIds.mockResolvedValueOnce(["logo1234567890abcdefg"]);

    const result = await service.getPublicConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      site_name: "D1 Guild",
      site_logo_media_id: "logo1234567890abcdefg",
      default_site_logo_url: "/default-logo.webp",
      features: { announcements: true, events: true, guildWar: true, gallery: false, wiki: true, tools: true, storage: true },
      media_policy: {
        max_file_size_bytes: expect.objectContaining({ class_icon: 512 * 1024, gallery_image: 10 * 1024 * 1024 }),
        quotas: { profile: 10, announcement: 10, gallery: 20, wiki: 10 },
      },
      storage_policy: { images_per_item: 5 },
      absence_policy: { max_span_days: 366, max_entries_per_user: 20 },
    });
  });

  it("hard-fails when the authoritative singleton is missing", async () => {
    const { service, mediaService } = createService([[]]);

    await expect(service.getPublicConfig()).rejects.toThrow(/site_config singleton.*missing/i);
    expect(mediaService.listLinkedMediaIds).not.toHaveBeenCalled();
  });

  it("hard-fails instead of serving defaults over invalid D1 policy data", async () => {
    const { service } = createService([[{ ...SITE_ROW, mediaGalleryQuota: 0 }]]);

    await expect(service.getPublicConfig()).rejects.toThrow();
  });

  it("keeps analytics settings out of general admin site config", async () => {
    const { service } = createService([[SITE_ROW]]);

    const result = await service.getAdminConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.site).not.toHaveProperty("analytics_settings");
  });

  it("returns all five fixed analytics weights from explicit columns", async () => {
    const { service } = createService([[SITE_ROW]]);

    await expect(service.getAnalyticsSettings()).resolves.toEqual({
      ok: true,
      data: {
        reference_duration_minutes: 45,
        modifier_weights: { kills: 0.4, towers: 0.1, base_hp: 0.2, credits: 0.2, distance: 0.1 },
      },
    });
  });

  it("normalizes and writes analytics updates to the six relational columns", async () => {
    const { service, deps, set } = createService([[SITE_ROW]]);

    const result = await service.updateAnalyticsSettings("admin-1", {
      reference_duration_minutes: 60,
      modifier_weights: { kills: 2, towers: 1, base_hp: 1, credits: 0, distance: 0 },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        reference_duration_minutes: 60,
        modifier_weights: { kills: 0.5, towers: 0.25, base_hp: 0.25, credits: 0, distance: 0 },
      },
    });
    expect(set).toHaveBeenCalledWith({
      analyticsReferenceDurationMinutes: 60,
      analyticsKillsWeight: 0.5,
      analyticsTowersWeight: 0.25,
      analyticsBaseHpWeight: 0.25,
      analyticsCreditsWeight: 0,
      analyticsDistanceWeight: 0,
      updatedAt: NOW.toISOString(),
    });
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "analytics_settings",
      actorId: "admin-1",
    }));
  });

  it("rejects dynamic analytics keys", async () => {
    const { service, set } = createService([[SITE_ROW]]);

    const result = await service.updateAnalyticsSettings("admin-1", {
      modifier_weights: { assists: 1 },
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(set).not.toHaveBeenCalled();
  });

  it("updates site policies through relational columns and audits the write", async () => {
    const nextRow = { ...SITE_ROW, siteName: "New Guild", featureGalleryEnabled: true };
    const { service, deps, set } = createService([[SITE_ROW], [nextRow]]);

    const result = await service.updateAdminConfig("admin-1", {
      site_name: "New Guild",
      features: { gallery: true },
      media_policy: { max_file_size_bytes: { class_icon: 256 * 1024 } },
    });

    expect(result.ok).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      siteName: "New Guild",
      featureGalleryEnabled: true,
      mediaClassIconMaxBytes: 256 * 1024,
    }));
    expect(set.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({
      featureFlagsJson: expect.anything(),
    }));
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "site_config",
      action: "update",
      actorId: "admin-1",
    }));
  });

  it("uses the D1 logo limit when replacing the linked site logo", async () => {
    const { service, mediaService } = createService([[SITE_ROW], [SITE_ROW]]);
    const upload = { full: new Uint8Array([1]).buffer, view: new Uint8Array([2]).buffer };

    const result = await service.uploadSiteLogo("admin-1", upload);

    expect(result.ok).toBe(true);
    expect(mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "site_logo",
      uploads: [upload],
      maxBytes: 2 * 1024 * 1024,
    }));
    expect(mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "site_config",
      entityId: "default",
      slot: "logo",
    }));
  });
});
