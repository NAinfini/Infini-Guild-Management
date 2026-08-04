import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_GAME_RULES,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  adminSiteConfigResponseSchema,
  publicSiteConfigSchema,
  siteAbsencePolicySchema,
  siteAnalyticsSettingsSchema,
  siteConfigSchema,
  siteMediaPolicySchema,
  siteStoragePolicySchema,
  updateSiteConfigSchema,
  type AdminSiteConfigResponse,
  type PublicSiteConfig,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { featureFlagsSchema } from "@guild/shared/config/features";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { siteConfig } from "../db/schema";
import { logger } from "../utils/logger";
import type { WriteAuditLogInput } from "./audit";
import { captureUploadValidation } from "./media";
import { rethrowAfterUploadFailure } from "./media-upload-compensation";
import { buildReplaceMediaRefsStatements } from "./media-references";
import { err, ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, unknown>>;

type SiteConfigDeps = {
  rawDb: D1Database;
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

function parseJsonOrDefault<T>(
  value: string | undefined | null,
  schema: { parse(input: unknown): T },
  fallback: T,
  field: string,
): T {
  // Missing value is the legitimate pre-seed default, not an error.
  if (!value) return fallback;
  try {
    return schema.parse(JSON.parse(value) as unknown);
  } catch (error) {
    // Logged rather than swallowed: without this, the admin console silently
    // renders defaults over a corrupt row, and the next save writes those
    // defaults back — destroying whatever the real values were.
    logger.error("site_config column is corrupt; serving defaults", {
      field,
      reason: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function mapSiteConfig(row: SiteConfigRow | null, deps: SiteConfigDeps) {
  return siteConfigSchema.parse({
    site_name: row?.siteName ?? deps.envSiteName,
    site_logo_url: row?.siteLogoUrl ?? deps.envSiteLogoUrl,
    features: parseJsonOrDefault(row?.featureFlagsJson, featureFlagsSchema, DEFAULT_FEATURE_FLAGS, "feature_flags_json"),
    media_policy: parseJsonOrDefault(row?.mediaPolicyJson, siteMediaPolicySchema, DEFAULT_SITE_MEDIA_POLICY, "media_policy_json"),
    storage_policy: parseJsonOrDefault(row?.storagePolicyJson, siteStoragePolicySchema, DEFAULT_SITE_STORAGE_POLICY, "storage_policy_json"),
    absence_policy: parseJsonOrDefault(row?.absencePolicyJson, siteAbsencePolicySchema, DEFAULT_SITE_ABSENCE_POLICY, "absence_policy_json"),
    analytics_settings: parseJsonOrDefault(row?.analyticsSettingsJson, siteAnalyticsSettingsSchema, DEFAULT_SITE_ANALYTICS_SETTINGS, "analytics_settings_json"),
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

function siteLogoUrlForKey(key: string): string {
  return `${SITE_LOGO_ROUTE}?key=${encodeURIComponent(key)}`;
}

export function siteLogoKeyFromUrl(url: string | null | undefined): string | null {
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
    const siteRow = await this.getSiteRow();
    return ok(adminSiteConfigResponseSchema.parse({
      site: mapSiteConfig(siteRow, this.deps),
    }));
  }

  async getAnalyticsSettings() {
    const row = await this.getSiteRow();
    return ok(parseJsonOrDefault(row?.analyticsSettingsJson, siteAnalyticsSettingsSchema, DEFAULT_SITE_ANALYTICS_SETTINGS, "analytics_settings_json"));
  }

  async updateAnalyticsSettings(actorId: string, input: Record<string, unknown>) {
    const previous = await this.getAnalyticsSettings();
    const parsed = siteAnalyticsSettingsSchema.partial().safeParse(input);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid analytics settings payload", parsed.error.flatten());
    const teamStatKeys = new Set(DEFAULT_GAME_RULES.guild_war.team_stats.map((stat) => stat.key));
    const unknownKeys = Object.keys(parsed.data.modifier_weights ?? {}).filter((key) => !teamStatKeys.has(key));
    if (unknownKeys.length > 0) {
      return err("VALIDATION_ERROR", `Unknown analytics team stat keys: ${unknownKeys.join(", ")}`);
    }
    const defaults = previous.ok ? previous.data : DEFAULT_SITE_ANALYTICS_SETTINGS;
    const currentWeights = Object.fromEntries(
      Object.entries(defaults.modifier_weights).filter(([key]) => teamStatKeys.has(key)),
    );
    const next = normalizeAnalyticsWeights(siteAnalyticsSettingsSchema.parse({
      reference_duration_minutes: parsed.data.reference_duration_minutes ?? defaults.reference_duration_minutes,
      modifier_weights: {
        ...currentWeights,
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
    const current = mapSiteConfig(previous, this.deps);
    const nowIso = this.nowIso();
    const sitePatch: Partial<typeof siteConfig.$inferInsert> = { updatedAt: nowIso };
    if (input.site_name !== undefined) sitePatch.siteName = input.site_name.trim();
    if (input.features !== undefined) {
      sitePatch.featureFlagsJson = JSON.stringify({ ...current.features, ...input.features });
    }
    if (input.media_policy !== undefined) {
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
      sitePatch.storagePolicyJson = JSON.stringify({ ...current.storage_policy, ...input.storage_policy });
    }
    if (input.absence_policy !== undefined) {
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
    try {
      await this.commitSiteLogoUrl(nextUrl, stored.data);
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (key) => this.deps.deleteMediaObject?.(key) ?? Promise.resolve(),
        [stored.data],
      );
    }
    await this.deps.writeAuditLog({
      entityType: "site_config",
      action: "update",
      actorId,
      entityId: DEFAULT_ID,
      diffTitle: "Site Config",
      detailText: JSON.stringify({ fields: ["siteLogoUrl"] }),
    });
    const updated = await this.getAdminConfig();
    if (previousKey && previousKey !== stored.data && this.deps.deleteMediaObject) {
      await Promise.allSettled([this.deps.deleteMediaObject(previousKey)]);
    }
    return updated;
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

  private async commitSiteLogoUrl(siteLogoUrl: string, mediaKey: string): Promise<void> {
    await this.ensureSiteRow();
    await this.deps.rawDb.batch([
      this.deps.rawDb
        .prepare("UPDATE site_config SET site_logo_url = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(siteLogoUrl, this.nowIso(), DEFAULT_ID),
      ...buildReplaceMediaRefsStatements(this.deps.rawDb, "site_config", DEFAULT_ID, [mediaKey]),
    ]);
  }

  private nowIso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

}
