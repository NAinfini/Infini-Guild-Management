import { describe, expect, it, vi } from "vitest";
import { SiteConfigService } from "../SiteConfigService";

const NOW = new Date("2026-06-12T12:00:00.000Z");

const DEFAULT_BODY = JSON.stringify({ type: "doc", content: [] });
const CHECKLIST = [
  { id: "rules", label: "Read rules", description: "Review guild rules", required: true },
  { id: "profile", label: "Finish profile", description: null, required: true },
];
const SEEDED_ONBOARDING_ROW = {
  id: "default",
  title: "成员入门须知",
  bodyJson: DEFAULT_BODY,
  checklistJson: JSON.stringify(CHECKLIST),
  requireAck: true,
  publishedAt: NOW.toISOString(),
  updatedBy: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};
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
  paginationPolicyJson: JSON.stringify({
    admin: 50,
    announcements: 50,
    events: 100,
    gallery: 24,
    guild_war: 20,
    users: 500,
    wiki: 50,
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
      pagination_policy: expect.objectContaining({ guild_war: 20 }),
      storage_policy: { images_per_item: 5 },
      absence_policy: { max_span_days: 366, max_entries_per_user: 20 },
    });
  });

  it("returns analytics settings from D1 site config for admin config", async () => {
    const { service } = createService([[SEEDED_SITE_ROW], [SEEDED_ONBOARDING_ROW]]);

    const result = await service.getAdminConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.site.analytics_settings).toEqual({
      reference_duration_minutes: 45,
      modifier_weights: { kills: 0.7, basehp: 0.3 },
    });
  });

  it("marks onboarding disabled when the seeded config is unpublished", async () => {
    const { service } = createService([[SEEDED_SITE_ROW], [{ ...SEEDED_ONBOARDING_ROW, publishedAt: null }]]);

    const result = await service.getAdminConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.onboarding.enabled).toBe(false);
    expect(result.data.onboarding.published_at).toBeNull();
  });

  it("does not create runtime default onboarding content when the database row is missing", async () => {
    const { service } = createService([[], []]);

    const result = await service.getAdminConfig();

    expect(result).toEqual({
      ok: false,
      code: "SERVER_ERROR",
      message: "Onboarding config is not initialized",
    });
  });

  it("updates admin site config and writes an audit diff", async () => {
    const { service, deps, calls } = createService([
      [{ id: "default", siteName: "Old Guild", siteLogoUrl: "/old.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ id: "default", siteName: "New Guild", siteLogoUrl: "/new.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [SEEDED_ONBOARDING_ROW],
    ]);

    const result = await service.updateAdminConfig("admin-1", {
      site_name: "New Guild",
      site_logo_url: "/new.webp",
    });

    expect(result.ok).toBe(true);
    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({
      siteName: "New Guild",
      siteLogoUrl: "/new.webp",
    }));
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "site_config",
      action: "update",
      actorId: "admin-1",
      entityId: "default",
      diffTitle: "Site Config",
    }));
  });

  it("enables onboarding by publishing the existing config", async () => {
    const { service, calls } = createService([
      [{ ...SEEDED_ONBOARDING_ROW, publishedAt: null }],
      [SEEDED_SITE_ROW],
      [SEEDED_ONBOARDING_ROW],
    ]);

    const result = await service.updateOnboardingConfig("admin-1", { enabled: true });

    expect(result.ok).toBe(true);
    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({
      publishedAt: NOW.toISOString(),
      updatedBy: "admin-1",
    }));
  });

  it("disables onboarding by clearing the published timestamp", async () => {
    const { service, calls } = createService([
      [SEEDED_ONBOARDING_ROW],
      [SEEDED_SITE_ROW],
      [{ ...SEEDED_ONBOARDING_ROW, publishedAt: null }],
    ]);

    const result = await service.updateOnboardingConfig("admin-1", { enabled: false });

    expect(result.ok).toBe(true);
    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({
      publishedAt: null,
      updatedBy: "admin-1",
    }));
  });

  it("uploads a site logo, stores the internal logo URL, and removes the previous managed logo", async () => {
    const { service, deps, calls } = createService([
      [{ id: "default", siteName: "Guild", siteLogoUrl: "/api/site-config/logo?key=site%2Flogo%2Fold.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ id: "default", siteName: "Guild", siteLogoUrl: "/api/site-config/logo?key=site%2Flogo%2Fold.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ id: "default", siteName: "Guild", siteLogoUrl: "/api/site-config/logo?key=site%2Flogo%2Fnew.webp", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [SEEDED_ONBOARDING_ROW],
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

  it("cleans up a newly uploaded logo when the admin config response cannot be rebuilt", async () => {
    const { service, deps } = createService([]);
    deps.storeSiteLogo = vi.fn().mockResolvedValue("site/logo/new.webp");
    deps.deleteMediaObject = vi.fn().mockResolvedValue(undefined);
    const file = new File(["logo"], "logo.webp", { type: "image/webp" });

    const result = await service.uploadSiteLogo("admin-1", file);

    expect(result.ok).toBe(false);
    expect(deps.storeSiteLogo).toHaveBeenCalledWith(file);
    expect(deps.deleteMediaObject).toHaveBeenCalledWith("site/logo/new.webp");
  });

  it("returns member onboarding completion status after a member confirms once", async () => {
    const { service } = createService([
      [{ id: "default", title: "Rules", bodyJson: DEFAULT_BODY, checklistJson: JSON.stringify(CHECKLIST), requireAck: true, publishedAt: NOW.toISOString(), updatedBy: "admin-1", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ userId: "member-1", completedItemIdsJson: JSON.stringify(["rules", "profile"]), acknowledgedAt: NOW.toISOString(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    ]);

    const result = await service.getMemberOnboarding("member-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { is_complete: boolean; state: { acknowledged_at: string | null } };
      expect(data.is_complete).toBe(true);
      expect(data.state.acknowledged_at).toBe(NOW.toISOString());
    }
  });

  it("does not expose disabled onboarding to members", async () => {
    const { service } = createService([
      [{ ...SEEDED_ONBOARDING_ROW, publishedAt: null }],
    ]);

    const result = await service.getMemberOnboarding("member-1");

    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Onboarding is disabled",
    });
  });

  it("keeps member onboarding complete after onboarding content changes", async () => {
    const { service } = createService([
      [{ id: "default", title: "Updated rules", bodyJson: DEFAULT_BODY, checklistJson: JSON.stringify(CHECKLIST), requireAck: true, publishedAt: NOW.toISOString(), updatedBy: "admin-1", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ userId: "member-1", completedItemIdsJson: JSON.stringify(["rules", "profile"]), acknowledgedAt: "2026-06-01T00:00:00.000Z", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    ]);

    const result = await service.getMemberOnboarding("member-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.is_complete).toBe(true);
      expect(result.data.state.acknowledged_at).toBe("2026-06-01T00:00:00.000Z");
    }
  });

  it("saves checklist progress without acknowledging rules", async () => {
    const { service, calls } = createService([
      [{ id: "default", title: "Rules", bodyJson: DEFAULT_BODY, checklistJson: JSON.stringify(CHECKLIST), requireAck: true, publishedAt: NOW.toISOString(), updatedBy: "admin-1", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [],
      [{ userId: "member-1", completedItemIdsJson: JSON.stringify(["rules"]), acknowledgedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    ]);

    const result = await service.updateMemberProgress("member-1", { completed_item_ids: ["rules", "not-real"] });

    expect(result.ok).toBe(true);
    expect(calls.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: "member-1",
      completedItemIdsJson: JSON.stringify(["rules"]),
      acknowledgedAt: null,
    }));
  });

  it("does not save member progress while onboarding is disabled", async () => {
    const { service, calls } = createService([
      [{ ...SEEDED_ONBOARDING_ROW, publishedAt: null }],
    ]);

    const result = await service.updateMemberProgress("member-1", { completed_item_ids: ["rules"] });

    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Onboarding is disabled",
    });
    expect(calls.values).not.toHaveBeenCalled();
    expect(calls.set).not.toHaveBeenCalled();
  });

  it("acknowledges onboarding once and writes audit", async () => {
    const { service, deps, calls } = createService([
      [{ id: "default", title: "Rules", bodyJson: DEFAULT_BODY, checklistJson: JSON.stringify(CHECKLIST), requireAck: true, publishedAt: NOW.toISOString(), updatedBy: "admin-1", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ userId: "member-1", completedItemIdsJson: JSON.stringify(["rules", "profile"]), acknowledgedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ userId: "member-1", completedItemIdsJson: JSON.stringify(["rules", "profile"]), acknowledgedAt: NOW.toISOString(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    ]);

    const result = await service.acknowledgeOnboarding("member-1");

    expect(result.ok).toBe(true);
    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({
      acknowledgedAt: NOW.toISOString(),
    }));
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "onboarding_ack",
      action: "acknowledge",
      actorId: "member-1",
      entityId: "member-1",
      diffTitle: "Onboarding",
    }));
  });

  it("does not acknowledge onboarding while it is disabled", async () => {
    const { service, deps, calls } = createService([
      [{ ...SEEDED_ONBOARDING_ROW, publishedAt: null }],
    ]);

    const result = await service.acknowledgeOnboarding("member-1");

    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Onboarding is disabled",
    });
    expect(calls.values).not.toHaveBeenCalled();
    expect(calls.set).not.toHaveBeenCalled();
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
  });

  it("requires current checklist completion before acknowledging onboarding", async () => {
    const { service, deps } = createService([
      [{ id: "default", title: "Rules", bodyJson: DEFAULT_BODY, checklistJson: JSON.stringify(CHECKLIST), requireAck: true, publishedAt: NOW.toISOString(), updatedBy: "admin-1", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
      [{ userId: "member-1", completedItemIdsJson: JSON.stringify(["rules"]), acknowledgedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    ]);

    const result = await service.acknowledgeOnboarding("member-1");

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Required onboarding checklist items must be completed before acknowledgement",
    });
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
  });
});
