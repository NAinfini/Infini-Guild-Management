import {
  analyticsSettingsSchema,
  siteConfigSchema,
  type AuditChange,
  type AdminSiteConfigResponse,
  type OAuthProviderStatus,
  type OAuthProviderStatuses,
  type PublicSiteConfig,
  type SiteAnalyticsSettings,
  type SiteConfig,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { DeferredTasks, NotificationPublisher, RequestContext } from "@guild/kernel";
import { AppError } from "@guild/kernel";
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";
import type { ImageUpload, MediaService } from "../media/public.js";

export type SiteConfigRecord = SiteConfig & Readonly<{ revisionToken: string }>;

type OAuthProvider = keyof SiteConfig["oauth"];

export type OAuthProviderAvailability = Readonly<Record<OAuthProvider, boolean>>;

const NO_OAUTH_PROVIDER_IS_AVAILABLE: OAuthProviderAvailability = Object.freeze({
  google: false,
  discord: false,
  kook: false,
  wechat: false,
});

export interface SiteConfigStore {
  get(): Promise<SiteConfigRecord>;
  update(input: Readonly<{
    record: SiteConfigRecord;
    expectedRevisionToken: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  setLogo(input: Readonly<{
    record: SiteConfigRecord;
    expectedRevisionToken: string;
    mediaId: string;
    ownerUserId: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
}

export class SiteConfigService {
  constructor(
    private readonly store: SiteConfigStore,
    private readonly media: MediaService,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
    private readonly oauthProviderAvailability: OAuthProviderAvailability = NO_OAUTH_PROVIDER_IS_AVAILABLE,
  ) {}

  async getPublic(): Promise<PublicSiteConfig> {
    return publicProjection(await this.store.get(), this.oauthProviderAvailability);
  }

  async oauthEnabled(provider: keyof SiteConfig["oauth"]): Promise<boolean> {
    const current = await this.store.get();
    return current.oauth[provider] && this.oauthProviderAvailability[provider];
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
    return adminProjection(await this.store.get(), this.oauthStatuses());
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
    const audit = createAuditEvent(context, {
      subjectType: "analytics_settings",
      subjectId: "site",
      subjectLabel: existing.site_name,
      action: "update",
      changes: analyticsChanges(existing.analytics_settings, merged),
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
    const { expected_revision_token: expectedRevisionToken, ...changes } = patch;
    if (existing.revisionToken !== expectedRevisionToken) throw conflict();
    const merged = siteConfigSchema.parse({
      ...existing,
      ...changes,
      features: { ...existing.features, ...changes.features },
      oauth: { ...existing.oauth, ...changes.oauth },
      media_policy: {
        max_file_size_bytes: {
          ...existing.media_policy.max_file_size_bytes,
          ...changes.media_policy?.max_file_size_bytes,
        },
        quotas: { ...existing.media_policy.quotas, ...changes.media_policy?.quotas },
      },
      storage_policy: { ...existing.storage_policy, ...changes.storage_policy },
      absence_policy: { ...existing.absence_policy, ...changes.absence_policy },
      created_at: existing.created_at,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
    });
    const statuses = this.oauthStatuses();
    const unavailable = (Object.keys(changes.oauth ?? {}) as OAuthProvider[])
      .filter((provider) => changes.oauth?.[provider] && !existing.oauth[provider] && statuses[provider] !== "available");
    if (unavailable.length > 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `OAuth provider configuration is unavailable: ${unavailable.join(", ")}`,
      });
    }
    const record: SiteConfigRecord = { ...merged, revisionToken: crypto.randomUUID() };
    if (sameConfig(existing, record)) return adminProjection(existing, statuses);
    const sections = changedSections(existing, record).filter((section) => section !== "branding");
    const audit = createAuditEvent(context, {
      subjectType: "site_config",
      subjectId: "site",
      subjectLabel: record.site_name,
      action: "update",
      changes: brandingChanges(existing, record),
      context: sections.length === 0 ? [] : [{
        field: "changed_sections",
        value: {
          type: "list",
          value: sections.map((value) => ({ type: "code" as const, value })),
        },
      }],
    });
    if (!await this.store.update({ record, expectedRevisionToken, audit })) {
      throw conflict();
    }
    this.publish(record.updated_at);
    return adminProjection(record, statuses);
  }

  async uploadLogo(
    context: RequestContext,
    upload: ImageUpload,
    expectedRevisionToken: string,
  ): Promise<AdminSiteConfigResponse> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_SITE_CONFIG_MANAGE);
    const existing = await this.store.get();
    if (existing.revisionToken !== expectedRevisionToken) throw conflict();
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
    const audit = createAuditEvent(context, {
      subjectType: "site_config",
      subjectId: "site",
      subjectLabel: record.site_name,
      action: "upload",
      context: [{
        field: "media_count",
        value: { type: "number", value: 1 },
      }],
    });
    if (!await this.store.setLogo({
      record,
      expectedRevisionToken,
      mediaId,
      ownerUserId: actor.userId,
      audit,
    })) throw conflict();
    this.publish(record.updated_at);
    return adminProjection(record, this.oauthStatuses());
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

  private oauthStatuses(): OAuthProviderStatuses {
    return {
      google: oauthStatus("google", this.oauthProviderAvailability),
      discord: oauthStatus("discord", this.oauthProviderAvailability),
      kook: oauthStatus("kook", this.oauthProviderAvailability),
      // A runtime credential cannot make WeChat available until an adapter is
      // implemented and verified. Keep this explicit rather than treating it
      // as a missing secret.
      wechat: "unsupported",
    };
  }
}

function publicProjection(record: SiteConfigRecord, availability: OAuthProviderAvailability): PublicSiteConfig {
  return {
    site_name: record.site_name,
    site_description: record.site_description,
    site_logo_media_id: record.site_logo_media_id,
    default_site_logo_url: record.default_site_logo_url,
    features: record.features,
    oauth: {
      google: record.oauth.google && availability.google,
      discord: record.oauth.discord && availability.discord,
      kook: record.oauth.kook && availability.kook,
      wechat: false,
    },
    media_policy: record.media_policy,
    storage_policy: record.storage_policy,
    absence_policy: record.absence_policy,
  };
}

function adminProjection(
  record: SiteConfigRecord,
  oauthProviderStatus: OAuthProviderStatuses,
): AdminSiteConfigResponse {
  const { revisionToken, analytics_settings: _analytics, ...site } = record;
  return { site, revision_token: revisionToken, oauth_provider_status: oauthProviderStatus };
}

function oauthStatus(
  provider: Exclude<OAuthProvider, "wechat">,
  availability: OAuthProviderAvailability,
): OAuthProviderStatus {
  return availability[provider] ? "available" : "missing_credentials";
}

function sameConfig(before: SiteConfigRecord, after: SiteConfigRecord): boolean {
  const normalize = ({ revisionToken: _token, updated_at: _updatedAt, ...value }: SiteConfigRecord) => value;
  return JSON.stringify(normalize(before)) === JSON.stringify(normalize(after));
}

function changedSections(before: SiteConfigRecord, after: SiteConfigRecord): string[] {
  const sections: string[] = [];
  if (before.site_name !== after.site_name || before.site_description !== after.site_description) sections.push("branding");
  for (const key of ["features", "oauth", "media_policy", "storage_policy", "absence_policy"] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) sections.push(key);
  }
  return sections;
}

function brandingChanges(before: SiteConfigRecord, after: SiteConfigRecord): AuditChange[] {
  const changes: AuditChange[] = [];
  if (before.site_name !== after.site_name) changes.push({
    field: "name",
    before: { type: "text", value: before.site_name },
    after: { type: "text", value: after.site_name },
  });
  if (before.site_description !== after.site_description) changes.push({
    field: "description",
    before: { type: "text", value: before.site_description },
    after: { type: "text", value: after.site_description },
  });
  return changes;
}

const ANALYTICS_WEIGHT_FIELDS = {
  kills: "kills_weight",
  towers: "towers_weight",
  base_hp: "base_hp_weight",
  credits: "credits_weight",
  distance: "distance_weight",
} as const;

function analyticsChanges(before: SiteAnalyticsSettings, after: SiteAnalyticsSettings): AuditChange[] {
  const changes: AuditChange[] = [];
  if (before.reference_duration_minutes !== after.reference_duration_minutes) changes.push({
    field: "reference_duration_minutes",
    before: { type: "number", value: before.reference_duration_minutes },
    after: { type: "number", value: after.reference_duration_minutes },
  });
  for (const key of Object.keys(ANALYTICS_WEIGHT_FIELDS) as (keyof typeof ANALYTICS_WEIGHT_FIELDS)[]) {
    if (before.modifier_weights[key] === after.modifier_weights[key]) continue;
    changes.push({
      field: ANALYTICS_WEIGHT_FIELDS[key],
      before: { type: "number", value: before.modifier_weights[key] },
      after: { type: "number", value: after.modifier_weights[key] },
    });
  }
  return changes;
}

function monotonicTimestamp(now: string, previous: string): string {
  if (Date.parse(now) > Date.parse(previous)) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function conflict(): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message: "Site configuration changed" });
}
