import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  adminSiteConfigResponseSchema,
  memberOnboardingResponseSchema,
  onboardingChecklistItemSchema,
  onboardingConfigSchema,
  publicSiteConfigSchema,
  siteAbsencePolicySchema,
  siteAnalyticsSettingsSchema,
  siteConfigSchema,
  siteMediaPolicySchema,
  siteStoragePolicySchema,
  updateMemberOnboardingSchema,
  updateOnboardingConfigSchema,
  updateSiteConfigSchema,
  type OnboardingChecklistItem,
  type AdminSiteConfigResponse,
  type MemberOnboardingResponse,
  type PublicSiteConfig,
  type UpdateMemberOnboardingPayload,
  type UpdateOnboardingConfigPayload,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { featureFlagsSchema } from "@guild/shared/config/features";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { onboardingConfig, memberOnboardingState, siteConfig } from "../db/schema";
import type { WriteAuditLogInput } from "./audit";
import { captureUploadValidation } from "./media";
import { err, ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, unknown>>;

type SiteConfigDeps = {
  writeAuditLog: (input: WriteAuditLogInput) => Promise<void>;
  storeSiteLogo?: (file: File) => Promise<string>;
  deleteMediaObject?: (key: string) => Promise<void>;
  now?: () => Date;
  envSiteName: string;
  envSiteLogoUrl: string;
};

const DEFAULT_ID = "default";
const SITE_LOGO_ROUTE = "/api/site-config/logo";
type SiteConfigRow = typeof siteConfig.$inferSelect;
type OnboardingConfigRow = typeof onboardingConfig.$inferSelect;
type MemberOnboardingStateRow = typeof memberOnboardingState.$inferSelect;

function parseJsonOrDefault<T>(value: string | undefined | null, schema: { parse(input: unknown): T }, fallback: T): T {
  if (!value) return fallback;
  try {
    return schema.parse(JSON.parse(value) as unknown);
  } catch {
    return fallback;
  }
}

function parseChecklist(value: string): OnboardingChecklistItem[] {
  const parsed = JSON.parse(value) as unknown;
  return onboardingChecklistItemSchema.array().parse(parsed);
}

function mapSiteConfig(row: SiteConfigRow | null, deps: SiteConfigDeps) {
  return siteConfigSchema.parse({
    site_name: row?.siteName ?? deps.envSiteName,
    site_logo_url: row?.siteLogoUrl ?? deps.envSiteLogoUrl,
    features: parseJsonOrDefault(row?.featureFlagsJson, featureFlagsSchema, DEFAULT_FEATURE_FLAGS),
    media_policy: parseJsonOrDefault(row?.mediaPolicyJson, siteMediaPolicySchema, DEFAULT_SITE_MEDIA_POLICY),
    storage_policy: parseJsonOrDefault(row?.storagePolicyJson, siteStoragePolicySchema, DEFAULT_SITE_STORAGE_POLICY),
    absence_policy: parseJsonOrDefault(row?.absencePolicyJson, siteAbsencePolicySchema, DEFAULT_SITE_ABSENCE_POLICY),
    analytics_settings: parseJsonOrDefault(row?.analyticsSettingsJson, siteAnalyticsSettingsSchema, DEFAULT_SITE_ANALYTICS_SETTINGS),
    created_at: row?.createdAt ?? null,
    updated_at: row?.updatedAt ?? null,
  });
}

function normalizeAnalyticsWeights(settings: ReturnType<typeof siteAnalyticsSettingsSchema.parse>) {
  const weightSum = Object.values(settings.modifier_weights).reduce((sum, value) => sum + value, 0);
  if (weightSum <= 0) return settings;
  return {
    ...settings,
    modifier_weights: Object.fromEntries(
      Object.entries(settings.modifier_weights).map(([key, value]) => [key, Number((value / weightSum).toFixed(4))]),
    ),
  };
}

function mapOnboarding(row: OnboardingConfigRow) {
  return onboardingConfigSchema.parse({
    title: row.title,
    body_json: row.bodyJson,
    checklist: parseChecklist(row.checklistJson),
    enabled: row.publishedAt !== null,
    require_ack: row.requireAck,
    published_at: row.publishedAt,
    updated_by: row.updatedBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function missingOnboardingConfig() {
  return err("SERVER_ERROR", "Onboarding config is not initialized");
}

function disabledOnboardingConfig() {
  return err("NOT_FOUND", "Onboarding is disabled");
}

function mapState(row: MemberOnboardingStateRow | null, userId: string) {
  return {
    user_id: userId,
    completed_item_ids: row ? JSON.parse(row.completedItemIdsJson) as string[] : [],
    acknowledged_at: row?.acknowledgedAt ?? null,
    created_at: row?.createdAt ?? null,
    updated_at: row?.updatedAt ?? null,
  };
}

function isComplete(config: ReturnType<typeof mapOnboarding>, state: ReturnType<typeof mapState>): boolean {
  const requiredIds = config.checklist.filter((item) => item.required).map((item) => item.id);
  const completed = new Set(state.completed_item_ids);
  const checklistComplete = requiredIds.every((id) => completed.has(id));
  const ackComplete = !config.require_ack || state.acknowledged_at !== null;
  return checklistComplete && ackComplete;
}

function memberResponse(config: ReturnType<typeof mapOnboarding>, state: ReturnType<typeof mapState>) {
  return memberOnboardingResponseSchema.parse({
    config,
    state,
    is_complete: isComplete(config, state),
  });
}

function siteLogoUrlForKey(key: string): string {
  return `${SITE_LOGO_ROUTE}?key=${encodeURIComponent(key)}`;
}

function siteLogoKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://guild.local");
    if (parsed.pathname !== SITE_LOGO_ROUTE) return null;
    const key = parsed.searchParams.get("key");
    return key?.startsWith("site/logo/") ? key : null;
  } catch {
    return null;
  }
}

export class SiteConfigService {
  constructor(private readonly db: DrizzleDb, private readonly deps: SiteConfigDeps) {}

  async getPublicConfig(): Promise<ServiceResult<PublicSiteConfig>> {
    const row = await this.getSiteRow();
    return ok(publicSiteConfigSchema.parse(mapSiteConfig(row, this.deps)));
  }

  async getAdminConfig(): Promise<ServiceResult<AdminSiteConfigResponse>> {
    const [siteRow, onboardingRow] = await Promise.all([this.getSiteRow(), this.getOnboardingRow()]);
    if (!onboardingRow) return missingOnboardingConfig();
    return ok(adminSiteConfigResponseSchema.parse({
      site: mapSiteConfig(siteRow, this.deps),
      onboarding: mapOnboarding(onboardingRow),
    }));
  }

  async getAnalyticsSettings() {
    const row = await this.getSiteRow();
    return ok(mapSiteConfig(row, this.deps).analytics_settings);
  }

  async updateAnalyticsSettings(actorId: string, input: Record<string, unknown>) {
    const previous = await this.getAnalyticsSettings();
    const parsed = siteAnalyticsSettingsSchema.partial().safeParse(input);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid analytics settings payload", parsed.error.flatten());
    const defaults = previous.ok ? previous.data : DEFAULT_SITE_ANALYTICS_SETTINGS;
    const next = normalizeAnalyticsWeights(siteAnalyticsSettingsSchema.parse({
      reference_duration_minutes: parsed.data.reference_duration_minutes ?? defaults.reference_duration_minutes,
      modifier_weights: {
        ...defaults.modifier_weights,
        ...(parsed.data.modifier_weights ?? {}),
      },
    }));
    const nowIso = this.nowIso();
    await this.ensureSiteRow();
    await this.db.update(siteConfig).set({
      analyticsSettingsJson: JSON.stringify(next),
      updatedAt: nowIso,
    }).where(eq(siteConfig.id, DEFAULT_ID));

    const oldSettings = previous.ok ? previous.data : null;
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (oldSettings) {
      for (const key of Object.keys(next) as Array<keyof typeof next>) {
        if (JSON.stringify(oldSettings[key]) !== JSON.stringify(next[key])) {
          diff[key] = { from: oldSettings[key], to: next[key] };
        }
      }
    }
    await this.deps.writeAuditLog({
      entityType: "analytics_settings",
      action: "update",
      actorId,
      entityId: DEFAULT_ID,
      diffTitle: "Analytics",
      detailText: Object.keys(diff).length > 0 ? JSON.stringify(diff) : null,
    });
    return ok(next);
  }

  async updateAdminConfig(actorId: string, input: UpdateSiteConfigPayload): Promise<ServiceResult<AdminSiteConfigResponse>> {
    const siteInput = {
      ...(input.site_name !== undefined ? { site_name: input.site_name } : {}),
      ...(input.features !== undefined ? { features: input.features } : {}),
      ...(input.media_policy !== undefined ? { media_policy: input.media_policy } : {}),
      ...(input.storage_policy !== undefined ? { storage_policy: input.storage_policy } : {}),
      ...(input.absence_policy !== undefined ? { absence_policy: input.absence_policy } : {}),
    };
    const siteFieldCount = Object.keys(siteInput).length;
    if (siteFieldCount > 0) {
      const sitePatchInput = updateSiteConfigSchema.safeParse(siteInput);
      if (!sitePatchInput.success) return err("VALIDATION_ERROR", "Invalid site config payload", sitePatchInput.error.flatten());
    }
    const previous = await this.getSiteRow();
    const nowIso = this.nowIso();
    const sitePatch: Partial<typeof siteConfig.$inferInsert> = { updatedAt: nowIso };
    if (input.site_name !== undefined) sitePatch.siteName = input.site_name.trim();
    if (input.features !== undefined) {
      const current = mapSiteConfig(previous, this.deps);
      sitePatch.featureFlagsJson = JSON.stringify({ ...current.features, ...input.features });
    }
    if (input.media_policy !== undefined) {
      const current = mapSiteConfig(previous, this.deps);
      sitePatch.mediaPolicyJson = JSON.stringify({
        ...current.media_policy,
        ...input.media_policy,
        max_file_size_bytes: {
          ...current.media_policy.max_file_size_bytes,
          ...(input.media_policy.max_file_size_bytes ?? {}),
        },
        quotas: {
          ...current.media_policy.quotas,
          ...(input.media_policy.quotas ?? {}),
        },
      });
    }
    if (input.storage_policy !== undefined) {
      const current = mapSiteConfig(previous, this.deps);
      sitePatch.storagePolicyJson = JSON.stringify({ ...current.storage_policy, ...input.storage_policy });
    }
    if (input.absence_policy !== undefined) {
      const current = mapSiteConfig(previous, this.deps);
      sitePatch.absencePolicyJson = JSON.stringify({ ...current.absence_policy, ...input.absence_policy });
    }
    if (siteFieldCount > 0) {
      if (previous) {
        await this.db.update(siteConfig).set(sitePatch).where(eq(siteConfig.id, DEFAULT_ID));
      } else {
        await this.db.insert(siteConfig).values({
          id: DEFAULT_ID,
          siteName: sitePatch.siteName ?? this.deps.envSiteName,
          siteLogoUrl: sitePatch.siteLogoUrl ?? this.deps.envSiteLogoUrl,
          featureFlagsJson: sitePatch.featureFlagsJson ?? JSON.stringify(DEFAULT_FEATURE_FLAGS),
          mediaPolicyJson: sitePatch.mediaPolicyJson ?? JSON.stringify(DEFAULT_SITE_MEDIA_POLICY),
          storagePolicyJson: sitePatch.storagePolicyJson ?? JSON.stringify(DEFAULT_SITE_STORAGE_POLICY),
          absencePolicyJson: sitePatch.absencePolicyJson ?? JSON.stringify(DEFAULT_SITE_ABSENCE_POLICY),
          analyticsSettingsJson: sitePatch.analyticsSettingsJson ?? JSON.stringify(DEFAULT_SITE_ANALYTICS_SETTINGS),
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      await this.deps.writeAuditLog({
        entityType: "site_config",
        action: "update",
        actorId,
        entityId: DEFAULT_ID,
        diffTitle: "Site Config",
        detailText: JSON.stringify({ fields: Object.keys(sitePatch).filter((key) => key !== "updatedAt") }),
      });
    }

    return this.getAdminConfig();
  }

  async uploadSiteLogo(actorId: string, file: File): Promise<ServiceResult<AdminSiteConfigResponse>> {
    if (!this.deps.storeSiteLogo) return err("SERVER_ERROR", "Site logo storage is not configured");
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"];
    if (!allowedTypes.includes(file.type)) return err("VALIDATION_ERROR", `Invalid file type: ${file.name}`);
    const siteRow = await this.getSiteRow();
    const maxLogoBytes = mapSiteConfig(siteRow, this.deps).media_policy.max_file_size_bytes.site_logo;
    if (file.size > maxLogoBytes) return err("VALIDATION_ERROR", `Logo exceeds ${maxLogoBytes} bytes`);
    const stored = await captureUploadValidation(() => this.deps.storeSiteLogo!(file));
    if (!stored.ok) return stored;

    const previousKey = siteLogoKeyFromUrl(siteRow?.siteLogoUrl ?? this.deps.envSiteLogoUrl);
    const nextUrl = siteLogoUrlForKey(stored.data);
    const updated = await this.updateSiteLogoUrl(actorId, nextUrl);
    if (!updated.ok) {
      if (this.deps.deleteMediaObject) await this.deps.deleteMediaObject(stored.data);
      return updated;
    }

    if (previousKey && previousKey !== stored.data && this.deps.deleteMediaObject) {
      await this.deps.deleteMediaObject(previousKey);
    }
    return updated;
  }

  async updateOnboardingConfig(actorId: string, input: UpdateOnboardingConfigPayload): Promise<ServiceResult<AdminSiteConfigResponse>> {
    const parsed = updateOnboardingConfigSchema.safeParse(input);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid onboarding payload", parsed.error.flatten());
    const previous = await this.getOnboardingRow();
    if (!previous) return missingOnboardingConfig();
    const nowIso = this.nowIso();
    const patch: Partial<typeof onboardingConfig.$inferInsert> = { updatedAt: nowIso, updatedBy: actorId };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title.trim();
    if (parsed.data.body_json !== undefined) patch.bodyJson = parsed.data.body_json;
    if (parsed.data.checklist !== undefined) patch.checklistJson = JSON.stringify(parsed.data.checklist);
    if (parsed.data.enabled !== undefined) patch.publishedAt = parsed.data.enabled ? previous.publishedAt ?? nowIso : null;
    if (parsed.data.require_ack !== undefined) patch.requireAck = parsed.data.require_ack;

    await this.db.update(onboardingConfig).set(patch).where(eq(onboardingConfig.id, DEFAULT_ID));

    await this.deps.writeAuditLog({
      entityType: "onboarding",
      action: "update",
      actorId,
      entityId: DEFAULT_ID,
      diffTitle: "Onboarding",
      detailText: JSON.stringify({ fields: Object.keys(patch).filter((key) => key !== "updatedAt" && key !== "updatedBy") }),
    });
    return this.getAdminConfig();
  }

  async getMemberOnboarding(userId: string): Promise<ServiceResult<MemberOnboardingResponse>> {
    const configRow = await this.getOnboardingRow();
    if (!configRow) return missingOnboardingConfig();
    if (!configRow.publishedAt) return disabledOnboardingConfig();
    const config = mapOnboarding(configRow);
    const stateRow = await this.getMemberStateRow(userId);
    const state = mapState(stateRow, userId);
    return ok(memberResponse(config, state));
  }

  async updateMemberProgress(userId: string, input: UpdateMemberOnboardingPayload): Promise<ServiceResult<MemberOnboardingResponse>> {
    const parsed = updateMemberOnboardingSchema.safeParse(input);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid onboarding progress payload", parsed.error.flatten());
    const configRow = await this.getOnboardingRow();
    if (!configRow) return missingOnboardingConfig();
    if (!configRow.publishedAt) return disabledOnboardingConfig();
    const config = mapOnboarding(configRow);
    const allowed = new Set(config.checklist.map((item) => item.id));
    const completed = [...new Set(parsed.data.completed_item_ids.filter((id) => allowed.has(id)))];
    const current = await this.getMemberStateRow(userId);
    const nowIso = this.nowIso();
    const acknowledgedAt = current?.acknowledgedAt ?? null;
    await this.upsertMemberState(userId, completed, acknowledgedAt, nowIso, current);
    return ok(memberResponse(config, {
      user_id: userId,
      completed_item_ids: completed,
      acknowledged_at: acknowledgedAt,
      created_at: current?.createdAt ?? nowIso,
      updated_at: nowIso,
    }));
  }

  async acknowledgeOnboarding(userId: string): Promise<ServiceResult<MemberOnboardingResponse>> {
    const configRow = await this.getOnboardingRow();
    if (!configRow) return missingOnboardingConfig();
    if (!configRow.publishedAt) return disabledOnboardingConfig();
    const config = mapOnboarding(configRow);
    const current = await this.getMemberStateRow(userId);
    const nowIso = this.nowIso();
    const completed = current ? JSON.parse(current.completedItemIdsJson) as string[] : [];
    const completedSet = new Set(completed);
    const missingRequired = config.checklist.some((item) => item.required && !completedSet.has(item.id));
    if (missingRequired) return err("VALIDATION_ERROR", "Required onboarding checklist items must be completed before acknowledgement");
    await this.upsertMemberState(userId, completed, nowIso, nowIso, current);
    await this.deps.writeAuditLog({
      entityType: "onboarding_ack",
      action: "acknowledge",
      actorId: userId,
      entityId: userId,
      diffTitle: "Onboarding",
    });
    return ok(memberResponse(config, {
      user_id: userId,
      completed_item_ids: completed,
      acknowledged_at: nowIso,
      created_at: current?.createdAt ?? nowIso,
      updated_at: nowIso,
    }));
  }

  private async upsertMemberState(
    userId: string,
    completedItemIds: string[],
    acknowledgedAt: string | null,
    nowIso: string,
    existing: MemberOnboardingStateRow | null,
  ) {
    const payload = {
      userId,
      completedItemIdsJson: JSON.stringify(completedItemIds),
      acknowledgedAt,
      updatedAt: nowIso,
    };
    if (existing) {
      await this.db.update(memberOnboardingState).set(payload).where(eq(memberOnboardingState.userId, userId));
    } else {
      await this.db.insert(memberOnboardingState).values({ ...payload, createdAt: nowIso });
    }
  }

  private async getSiteRow(): Promise<SiteConfigRow | null> {
    const rows = await (this.db.select().from(siteConfig) as { where: (where: unknown) => { limit: (limit: number) => Promise<SiteConfigRow[]> } })
      .where(eq(siteConfig.id, DEFAULT_ID))
      .limit(1);
    return rows[0] ?? null;
  }

  private async ensureSiteRow(): Promise<SiteConfigRow | null> {
    const existing = await this.getSiteRow();
    if (existing) return existing;
    const nowIso = this.nowIso();
    await this.db.insert(siteConfig).values({
      id: DEFAULT_ID,
      siteName: this.deps.envSiteName,
      siteLogoUrl: this.deps.envSiteLogoUrl,
      featureFlagsJson: JSON.stringify(DEFAULT_FEATURE_FLAGS),
      mediaPolicyJson: JSON.stringify(DEFAULT_SITE_MEDIA_POLICY),
      storagePolicyJson: JSON.stringify(DEFAULT_SITE_STORAGE_POLICY),
      absencePolicyJson: JSON.stringify(DEFAULT_SITE_ABSENCE_POLICY),
      analyticsSettingsJson: JSON.stringify(DEFAULT_SITE_ANALYTICS_SETTINGS),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return this.getSiteRow();
  }

  private async updateSiteLogoUrl(actorId: string, siteLogoUrl: string): Promise<ServiceResult<AdminSiteConfigResponse>> {
    await this.ensureSiteRow();
    await this.db.update(siteConfig).set({
      siteLogoUrl,
      updatedAt: this.nowIso(),
    }).where(eq(siteConfig.id, DEFAULT_ID));
    await this.deps.writeAuditLog({
      entityType: "site_config",
      action: "update",
      actorId,
      entityId: DEFAULT_ID,
      diffTitle: "Site Config",
      detailText: JSON.stringify({ fields: ["siteLogoUrl"] }),
    });
    return this.getAdminConfig();
  }

  private async getOnboardingRow(): Promise<OnboardingConfigRow | null> {
    const rows = await (this.db.select().from(onboardingConfig) as { where: (where: unknown) => { limit: (limit: number) => Promise<OnboardingConfigRow[]> } })
      .where(eq(onboardingConfig.id, DEFAULT_ID))
      .limit(1);
    return rows[0] ?? null;
  }

  private async getMemberStateRow(userId: string): Promise<MemberOnboardingStateRow | null> {
    const rows = await (this.db.select().from(memberOnboardingState) as { where: (where: unknown) => { limit: (limit: number) => Promise<MemberOnboardingStateRow[]> } })
      .where(eq(memberOnboardingState.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  private nowIso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

}
