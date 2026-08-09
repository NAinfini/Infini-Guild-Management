import {
  adminSiteConfigResponseSchema,
  analyticsSettingsSchema,
  publicSiteConfigSchema,
  siteAnalyticsSettingsSchema,
  siteConfigSchema,
  updateSiteConfigSchema,
  type AdminSiteConfigResponse,
  type FeatureFlags,
  type JsonValue,
  type PublicSiteConfig,
  type SiteAbsencePolicy,
  type SiteAnalyticsSettings,
  type SiteMediaPolicy,
  type SiteStoragePolicy,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { siteConfig } from "../db/schema";
import type { WriteAuditLogInput } from "./audit";
import type { MediaService, ParsedImageMediaUpload } from "./MediaService";
import { MediaValidationError } from "./MediaService";
import { err, ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, unknown>>;
type SiteConfigRow = typeof siteConfig.$inferSelect;

type SiteConfigDeps = {
  mediaService: MediaService;
  writeAuditLog: (input: WriteAuditLogInput) => Promise<void>;
  now?: () => Date;
  envSiteLogoUrl: string;
};

const DEFAULT_ID = "default";

function mapFeatureFlags(row: SiteConfigRow): FeatureFlags {
  return {
    announcements: row.featureAnnouncementsEnabled,
    events: row.featureEventsEnabled,
    guildWar: row.featureGuildWarEnabled,
    gallery: row.featureGalleryEnabled,
    wiki: row.featureWikiEnabled,
    tools: row.featureToolsEnabled,
    storage: row.featureStorageEnabled,
  };
}

function mapMediaPolicy(row: SiteConfigRow): SiteMediaPolicy {
  return {
    max_file_size_bytes: {
      site_logo: row.mediaSiteLogoMaxBytes,
      class_icon: row.mediaClassIconMaxBytes,
      profile_image: row.mediaProfileImageMaxBytes,
      profile_audio: row.mediaProfileAudioMaxBytes,
      announcement_image: row.mediaAnnouncementImageMaxBytes,
      wiki_image: row.mediaWikiImageMaxBytes,
      event_image: row.mediaEventImageMaxBytes,
      gallery_image: row.mediaGalleryImageMaxBytes,
      storage_image: row.mediaStorageImageMaxBytes,
    },
    quotas: {
      profile: row.mediaProfileQuota,
      announcement: row.mediaAnnouncementQuota,
      gallery: row.mediaGalleryQuota,
      wiki: row.mediaWikiQuota,
    },
  };
}

function mapStoragePolicy(row: SiteConfigRow): SiteStoragePolicy {
  return { images_per_item: row.storageImagesPerItem };
}

function mapAbsencePolicy(row: SiteConfigRow): SiteAbsencePolicy {
  return {
    max_span_days: row.absenceMaxSpanDays,
    max_entries_per_user: row.absenceMaxEntriesPerUser,
  };
}

function mapAnalyticsSettings(row: SiteConfigRow): SiteAnalyticsSettings {
  return siteAnalyticsSettingsSchema.parse({
    reference_duration_minutes: row.analyticsReferenceDurationMinutes,
    modifier_weights: {
      kills: row.analyticsKillsWeight,
      towers: row.analyticsTowersWeight,
      base_hp: row.analyticsBaseHpWeight,
      credits: row.analyticsCreditsWeight,
      distance: row.analyticsDistanceWeight,
    },
  });
}

function mapSiteConfig(row: SiteConfigRow, deps: SiteConfigDeps, logoMediaId: string | null) {
  return siteConfigSchema.parse({
    site_name: row.siteName,
    site_logo_media_id: logoMediaId,
    default_site_logo_url: deps.envSiteLogoUrl,
    features: mapFeatureFlags(row),
    media_policy: mapMediaPolicy(row),
    storage_policy: mapStoragePolicy(row),
    absence_policy: mapAbsencePolicy(row),
    analytics_settings: mapAnalyticsSettings(row),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function normalizeAnalyticsWeights(settings: SiteAnalyticsSettings): SiteAnalyticsSettings {
  const weights = settings.modifier_weights;
  const total = weights.kills + weights.towers + weights.base_hp + weights.credits + weights.distance;
  const normalized = (weight: number) => Number((weight / total).toFixed(4));
  return {
    ...settings,
    modifier_weights: {
      kills: normalized(weights.kills),
      towers: normalized(weights.towers),
      base_hp: normalized(weights.base_hp),
      credits: normalized(weights.credits),
      distance: normalized(weights.distance),
    },
  };
}

export class SiteConfigService {
  constructor(private readonly db: DrizzleDb, private readonly deps: SiteConfigDeps) {}

  async getPublicConfig(): Promise<ServiceResult<PublicSiteConfig>> {
    const row = await this.getSiteRow();
    const logoMediaId = (await this.deps.mediaService.listLinkedMediaIds("site_config", DEFAULT_ID, "logo"))[0] ?? null;
    return ok(publicSiteConfigSchema.parse(mapSiteConfig(row, this.deps, logoMediaId)));
  }

  async getAdminConfig(): Promise<ServiceResult<AdminSiteConfigResponse>> {
    const row = await this.getSiteRow();
    const logoMediaId = (await this.deps.mediaService.listLinkedMediaIds("site_config", DEFAULT_ID, "logo"))[0] ?? null;
    return ok(adminSiteConfigResponseSchema.parse({
      site: mapSiteConfig(row, this.deps, logoMediaId),
    }));
  }

  async getAnalyticsSettings(): Promise<ServiceResult<SiteAnalyticsSettings>> {
    return ok(mapAnalyticsSettings(await this.getSiteRow()));
  }

  async updateAnalyticsSettings(
    actorId: string,
    input: Record<string, unknown>,
  ): Promise<ServiceResult<SiteAnalyticsSettings>> {
    const previous = mapAnalyticsSettings(await this.getSiteRow());
    const parsed = analyticsSettingsSchema.safeParse(input);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid analytics settings payload", parsed.error.flatten());

    const merged = siteAnalyticsSettingsSchema.safeParse({
      reference_duration_minutes: parsed.data.reference_duration_minutes ?? previous.reference_duration_minutes,
      modifier_weights: {
        ...previous.modifier_weights,
        ...(parsed.data.modifier_weights ?? {}),
      },
    });
    if (!merged.success) return err("VALIDATION_ERROR", "Invalid analytics settings payload", merged.error.flatten());
    const next = normalizeAnalyticsWeights(merged.data);

    await this.db.update(siteConfig).set({
      analyticsReferenceDurationMinutes: next.reference_duration_minutes,
      analyticsKillsWeight: next.modifier_weights.kills,
      analyticsTowersWeight: next.modifier_weights.towers,
      analyticsBaseHpWeight: next.modifier_weights.base_hp,
      analyticsCreditsWeight: next.modifier_weights.credits,
      analyticsDistanceWeight: next.modifier_weights.distance,
      updatedAt: this.nowIso(),
    }).where(eq(siteConfig.id, DEFAULT_ID));

    const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
    if (previous.reference_duration_minutes !== next.reference_duration_minutes) {
      diff.reference_duration_minutes = {
        from: previous.reference_duration_minutes,
        to: next.reference_duration_minutes,
      };
    }
    if (JSON.stringify(previous.modifier_weights) !== JSON.stringify(next.modifier_weights)) {
      diff.modifier_weights = { from: previous.modifier_weights, to: next.modifier_weights };
    }
    await this.deps.writeAuditLog({
      entityType: "analytics_settings",
      action: "update",
      actorId,
      entityId: DEFAULT_ID,
      diffTitle: "Analytics",
      detail: Object.keys(diff).length > 0 ? diff : null,
    });
    return ok(next);
  }

  async updateAdminConfig(
    actorId: string,
    input: UpdateSiteConfigPayload,
  ): Promise<ServiceResult<AdminSiteConfigResponse>> {
    const parsed = updateSiteConfigSchema.safeParse(input);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid site config payload", parsed.error.flatten());

    const previous = await this.getSiteRow();
    const logoMediaId = (await this.deps.mediaService.listLinkedMediaIds("site_config", DEFAULT_ID, "logo"))[0] ?? null;
    const current = mapSiteConfig(previous, this.deps, logoMediaId);
    const sitePatch: Partial<typeof siteConfig.$inferInsert> = { updatedAt: this.nowIso() };

    if (parsed.data.site_name !== undefined) sitePatch.siteName = parsed.data.site_name;
    if (parsed.data.features !== undefined) {
      const features = { ...current.features, ...parsed.data.features };
      Object.assign(sitePatch, {
        featureAnnouncementsEnabled: features.announcements,
        featureEventsEnabled: features.events,
        featureGuildWarEnabled: features.guildWar,
        featureGalleryEnabled: features.gallery,
        featureWikiEnabled: features.wiki,
        featureToolsEnabled: features.tools,
        featureStorageEnabled: features.storage,
      });
    }
    if (parsed.data.media_policy !== undefined) {
      const mediaPolicy = {
        max_file_size_bytes: {
          ...current.media_policy.max_file_size_bytes,
          ...(parsed.data.media_policy.max_file_size_bytes ?? {}),
        },
        quotas: {
          ...current.media_policy.quotas,
          ...(parsed.data.media_policy.quotas ?? {}),
        },
      };
      Object.assign(sitePatch, {
        mediaSiteLogoMaxBytes: mediaPolicy.max_file_size_bytes.site_logo,
        mediaClassIconMaxBytes: mediaPolicy.max_file_size_bytes.class_icon,
        mediaProfileImageMaxBytes: mediaPolicy.max_file_size_bytes.profile_image,
        mediaProfileAudioMaxBytes: mediaPolicy.max_file_size_bytes.profile_audio,
        mediaAnnouncementImageMaxBytes: mediaPolicy.max_file_size_bytes.announcement_image,
        mediaWikiImageMaxBytes: mediaPolicy.max_file_size_bytes.wiki_image,
        mediaEventImageMaxBytes: mediaPolicy.max_file_size_bytes.event_image,
        mediaGalleryImageMaxBytes: mediaPolicy.max_file_size_bytes.gallery_image,
        mediaStorageImageMaxBytes: mediaPolicy.max_file_size_bytes.storage_image,
        mediaProfileQuota: mediaPolicy.quotas.profile,
        mediaAnnouncementQuota: mediaPolicy.quotas.announcement,
        mediaGalleryQuota: mediaPolicy.quotas.gallery,
        mediaWikiQuota: mediaPolicy.quotas.wiki,
      });
    }
    if (parsed.data.storage_policy !== undefined) {
      sitePatch.storageImagesPerItem = parsed.data.storage_policy.images_per_item
        ?? current.storage_policy.images_per_item;
    }
    if (parsed.data.absence_policy !== undefined) {
      sitePatch.absenceMaxSpanDays = parsed.data.absence_policy.max_span_days
        ?? current.absence_policy.max_span_days;
      sitePatch.absenceMaxEntriesPerUser = parsed.data.absence_policy.max_entries_per_user
        ?? current.absence_policy.max_entries_per_user;
    }

    await this.db.update(siteConfig).set(sitePatch).where(eq(siteConfig.id, DEFAULT_ID));
    await this.deps.writeAuditLog({
      entityType: "site_config",
      action: "update",
      actorId,
      entityId: DEFAULT_ID,
      diffTitle: "Site Config",
      detail: { fields: Object.keys(sitePatch).filter((key) => key !== "updatedAt") },
    });
    return this.getAdminConfig();
  }

  async uploadSiteLogo(
    actorId: string,
    upload: ParsedImageMediaUpload,
  ): Promise<ServiceResult<AdminSiteConfigResponse>> {
    const now = this.nowIso();
    try {
      const row = await this.getSiteRow();
      const created = await this.deps.mediaService.createImages({
        ownerUserId: actorId,
        purpose: "site_logo",
        uploads: [upload],
        now,
        maxBytes: row.mediaSiteLogoMaxBytes,
      });
      await this.deps.mediaService.replace({
        entityType: "site_config",
        entityId: DEFAULT_ID,
        slot: "logo",
        media: [{ mediaId: created.mediaIds[0]!, sortOrder: 0 }],
        ownerUserId: actorId,
        now,
      });
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
    await this.deps.writeAuditLog({
      entityType: "site_config",
      action: "update",
      actorId,
      entityId: DEFAULT_ID,
      diffTitle: "Site Config",
      detail: { fields: ["siteLogoMediaId"] },
    });
    return this.getAdminConfig();
  }

  private async getSiteRow(): Promise<SiteConfigRow> {
    const rows = await (this.db.select().from(siteConfig) as {
      where: (where: unknown) => { limit: (limit: number) => Promise<SiteConfigRow[]> };
    })
      .where(eq(siteConfig.id, DEFAULT_ID))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Required site_config singleton "${DEFAULT_ID}" is missing`);
    return row;
  }

  private nowIso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}
