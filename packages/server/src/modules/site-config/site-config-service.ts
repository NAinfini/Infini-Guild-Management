import {
  analyticsSettingsSchema,
  siteConfigSchema,
  type AdminSiteConfigResponse,
  type PublicSiteConfig,
  type SiteAnalyticsSettings,
  type SiteConfig,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { DeferredTasks, NotificationPublisher, RequestContext } from "@guild/kernel";
import { AppError } from "@guild/kernel";
import { createAuditMutation, type AuditMutation } from "../audit/public.js";
import type { ImageUpload, MediaService } from "../media/public.js";

export type SiteConfigRecord = SiteConfig & Readonly<{ revisionToken: string }>;

export interface SiteConfigStore {
  get(): Promise<SiteConfigRecord>;
  update(input: Readonly<{
    record: SiteConfigRecord;
    expectedRevisionToken: string;
    audit: AuditMutation;
  }>): Promise<boolean>;
  setLogo(input: Readonly<{
    record: SiteConfigRecord;
    expectedRevisionToken: string;
    mediaId: string;
    ownerUserId: string;
    audit: AuditMutation;
  }>): Promise<boolean>;
}

export class SiteConfigService {
  constructor(
    private readonly store: SiteConfigStore,
    private readonly media: MediaService,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
  ) {}

  async getPublic(): Promise<PublicSiteConfig> {
    return publicProjection(await this.store.get());
  }

  async getRuntimePolicy(): Promise<Pick<SiteConfig, "media_policy" | "storage_policy" | "absence_policy">> {
    const current = await this.store.get();
    return {
      media_policy: current.media_policy,
      storage_policy: current.storage_policy,
      absence_policy: current.absence_policy,
    };
  }

  async getAdmin(context: RequestContext): Promise<AdminSiteConfigResponse> {
    context.authorization.require(PERMISSION_ID.ADMIN_SITE_CONFIG_MANAGE);
    return adminProjection(await this.store.get());
  }

  async getAnalyticsSettings(context: RequestContext): Promise<SiteAnalyticsSettings> {
    context.authorization.require(PERMISSION_ID.ADMIN_ANALYTICS_VIEW);
    return (await this.store.get()).analytics_settings;
  }

  async updateAnalyticsSettings(
    context: RequestContext,
    patch: Parameters<typeof analyticsSettingsSchema.parse>[0],
  ): Promise<SiteAnalyticsSettings> {
    context.authorization.require(PERMISSION_ID.ADMIN_ANALYTICS_MANAGE);
    const existing = await this.store.get();
    const analyticsSettings = analyticsSettingsSchema.parse(patch);
    const merged = siteConfigSchema.shape.analytics_settings.parse({
      ...existing.analytics_settings,
      ...analyticsSettings,
      modifier_weights: {
        ...existing.analytics_settings.modifier_weights,
        ...analyticsSettings.modifier_weights,
      },
    });
    if (JSON.stringify(existing.analytics_settings) === JSON.stringify(merged)) return merged;
    const record: SiteConfigRecord = {
      ...existing,
      analytics_settings: merged,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
      revisionToken: crypto.randomUUID(),
    };
    const audit = createAuditMutation(context, {
      entityType: "analytics_settings",
      entityId: "site",
      action: "update",
      details: { before: existing.analytics_settings, after: merged },
    });
    if (!await this.store.update({ record, expectedRevisionToken: existing.revisionToken, audit })) {
      throw conflict();
    }
    this.publish(record.updated_at);
    return merged;
  }

  async update(context: RequestContext, patch: UpdateSiteConfigPayload): Promise<AdminSiteConfigResponse> {
    context.authorization.require(PERMISSION_ID.ADMIN_SITE_CONFIG_MANAGE);
    const existing = await this.store.get();
    const merged = siteConfigSchema.parse({
      ...existing,
      ...patch,
      features: { ...existing.features, ...patch.features },
      media_policy: {
        max_file_size_bytes: {
          ...existing.media_policy.max_file_size_bytes,
          ...patch.media_policy?.max_file_size_bytes,
        },
        quotas: { ...existing.media_policy.quotas, ...patch.media_policy?.quotas },
      },
      storage_policy: { ...existing.storage_policy, ...patch.storage_policy },
      absence_policy: { ...existing.absence_policy, ...patch.absence_policy },
      created_at: existing.created_at,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
    });
    const record: SiteConfigRecord = { ...merged, revisionToken: crypto.randomUUID() };
    if (sameConfig(existing, record)) return adminProjection(existing);
    const audit = createAuditMutation(context, {
      entityType: "site_config",
      entityId: "site",
      action: "update",
      summary: record.site_name,
      details: { changed_sections: changedSections(existing, record) },
    });
    if (!await this.store.update({ record, expectedRevisionToken: existing.revisionToken, audit })) {
      throw conflict();
    }
    this.publish(record.updated_at);
    return adminProjection(record);
  }

  async uploadLogo(
    context: RequestContext,
    upload: ImageUpload,
  ): Promise<AdminSiteConfigResponse> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_SITE_CONFIG_MANAGE);
    const existing = await this.store.get();
    const [mediaId] = await this.media.uploadImages(
      context,
      "site_logo",
      [upload],
      existing.media_policy.max_file_size_bytes.site_logo,
    );
    if (!mediaId) throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Logo upload returned no media" });
    const record: SiteConfigRecord = {
      ...existing,
      site_logo_media_id: mediaId,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
      revisionToken: crypto.randomUUID(),
    };
    const audit = createAuditMutation(context, {
      entityType: "site_config",
      entityId: "site",
      action: "upload",
      summary: record.site_name,
      details: { media_id: mediaId },
    });
    if (!await this.store.setLogo({
      record,
      expectedRevisionToken: existing.revisionToken,
      mediaId,
      ownerUserId: actor.userId,
      audit,
    })) throw conflict();
    this.publish(record.updated_at);
    return adminProjection(record);
  }

  private publish(updatedAt: string): void {
    this.deferred.defer(() => this.notifications.publish({
      type: "entity_changed",
      entity_type: "site_config",
      entity_id: "site",
      updated_at: updatedAt,
      hint: "site_config_updated",
    }));
  }
}

function publicProjection(record: SiteConfigRecord): PublicSiteConfig {
  return {
    site_name: record.site_name,
    site_logo_media_id: record.site_logo_media_id,
    default_site_logo_url: record.default_site_logo_url,
    features: record.features,
    media_policy: record.media_policy,
    storage_policy: record.storage_policy,
    absence_policy: record.absence_policy,
  };
}

function adminProjection(record: SiteConfigRecord): AdminSiteConfigResponse {
  const { revisionToken: _revisionToken, analytics_settings: _analytics, ...site } = record;
  return { site };
}

function sameConfig(before: SiteConfigRecord, after: SiteConfigRecord): boolean {
  const normalize = ({ revisionToken: _token, updated_at: _updatedAt, ...value }: SiteConfigRecord) => value;
  return JSON.stringify(normalize(before)) === JSON.stringify(normalize(after));
}

function changedSections(before: SiteConfigRecord, after: SiteConfigRecord): string[] {
  const sections: string[] = [];
  if (before.site_name !== after.site_name) sections.push("branding");
  for (const key of ["features", "media_policy", "storage_policy", "absence_policy"] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) sections.push(key);
  }
  return sections;
}

function monotonicTimestamp(now: string, previous: string): string {
  if (Date.parse(now) > Date.parse(previous)) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function conflict(): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message: "Site configuration changed" });
}
