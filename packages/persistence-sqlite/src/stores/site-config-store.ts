import { AppError } from "@guild/kernel";
import { siteConfigSchema } from "@guild/shared";
import type { SiteConfigRecord, SiteConfigStore } from "@guild/server/modules/site-config";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { assertMediaAttachments } from "./media-link-statements.js";
import { returnedRowCount } from "./sql-result.js";

export class SqliteSiteConfigStore implements SiteConfigStore {
  constructor(private readonly sql: SqlExecutor) {}

  async get(): Promise<SiteConfigRecord> {
    const row = oneRow(await this.sql.read({ method: "get", sql: selectSiteConfig() }));
    if (!row) throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Site configuration is missing" });
    return mapSiteConfig(row);
  }

  async update(input: Parameters<SiteConfigStore["update"]>[0]): Promise<boolean> {
    const guard = configGuard(input.record.revisionToken);
    const results = await this.sql.batch([
      updateSiteConfig(input.record, input.expectedRevisionToken),
      auditInsertStatement(input.audit, guard),
    ]);
    return returnedRowCount(results[0]) === 1;
  }

  async setLogo(input: Parameters<SiteConfigStore["setLogo"]>[0]): Promise<boolean> {
    await assertMediaAttachments(this.sql, {
      actorUserId: input.ownerUserId,
      entityType: "site_config",
      entityId: "site",
      slot: "logo",
      purpose: "site_logo",
      audience: "public",
      mediaIds: [input.mediaId],
      maxItems: 1,
    });
    const guard = configGuard(input.record.revisionToken);
    const results = await this.sql.batch([
      updateSiteConfig(input.record, input.expectedRevisionToken),
      {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'site_config' AND entity_id = 'site' AND slot = 'logo'
            AND media_id <> ? AND EXISTS (${guard.sql})`,
        params: [input.mediaId, ...guard.params],
      },
      {
        method: "run",
        sql: `INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
          SELECT ?, 'site_config', 'site', 'logo', 'public', 0 WHERE EXISTS (${guard.sql})
          ON CONFLICT(entity_type, entity_id, slot, media_id) DO UPDATE SET
            audience = excluded.audience,
            sort_order = excluded.sort_order`,
        params: [input.mediaId, ...guard.params],
      },
      auditInsertStatement(input.audit, guard),
    ]);
    return returnedRowCount(results[0]) === 1;
  }
}

function selectSiteConfig(): string {
  return `SELECT
    site_name, site_description, site_logo_media_id, default_site_logo_url,
    feature_announcements, feature_events, feature_guild_war, feature_gallery, feature_wiki, feature_tools, feature_storage,
    oauth_google_enabled, oauth_discord_enabled, oauth_kook_enabled, oauth_wechat_enabled,
    max_site_logo_bytes, max_class_icon_bytes, max_profile_image_bytes, max_profile_audio_bytes,
    max_announcement_image_bytes, max_wiki_image_bytes, max_event_image_bytes, max_gallery_image_bytes, max_storage_image_bytes,
    quota_profile, quota_announcement, quota_gallery, quota_wiki,
    storage_images_per_item, absence_max_span_days, absence_max_entries_per_user,
    analytics_reference_duration_minutes, analytics_weight_kills, analytics_weight_towers,
    analytics_weight_base_hp, analytics_weight_credits, analytics_weight_distance,
    revision_token, created_at, updated_at,
    max_announcement_attachment_bytes, quota_announcement_attachments
    FROM site_config WHERE singleton = 1 LIMIT 1`;
}

function updateSiteConfig(record: SiteConfigRecord, expectedRevisionToken: string): SqlBatchStatement {
  return {
    method: "all",
    columns: ["affected"],
    sql: `UPDATE site_config SET
      site_name = ?, site_description = ?, site_logo_media_id = ?, default_site_logo_url = ?,
      feature_announcements = ?, feature_events = ?, feature_guild_war = ?, feature_gallery = ?,
      feature_wiki = ?, feature_tools = ?, feature_storage = ?,
      oauth_google_enabled = ?, oauth_discord_enabled = ?, oauth_kook_enabled = ?, oauth_wechat_enabled = ?,
      max_site_logo_bytes = ?, max_class_icon_bytes = ?, max_profile_image_bytes = ?, max_profile_audio_bytes = ?,
      max_announcement_image_bytes = ?, max_wiki_image_bytes = ?, max_event_image_bytes = ?,
      max_gallery_image_bytes = ?, max_storage_image_bytes = ?, quota_profile = ?, quota_announcement = ?,
      quota_gallery = ?, quota_wiki = ?, storage_images_per_item = ?, absence_max_span_days = ?,
      absence_max_entries_per_user = ?, analytics_reference_duration_minutes = ?, analytics_weight_kills = ?,
      analytics_weight_towers = ?, analytics_weight_base_hp = ?, analytics_weight_credits = ?, analytics_weight_distance = ?,
      revision_token = ?, updated_at = ?,
      max_announcement_attachment_bytes = ?, quota_announcement_attachments = ?
      WHERE singleton = 1 AND revision_token = ?
      RETURNING 1 AS affected`,
    params: recordParams(record, expectedRevisionToken),
  };
}

function recordParams(record: SiteConfigRecord, expectedRevisionToken: string): readonly SqlValue[] {
  const sizes = record.media_policy.max_file_size_bytes;
  const quotas = record.media_policy.quotas;
  const weights = record.analytics_settings.modifier_weights;
  return [
    record.site_name, record.site_description, record.site_logo_media_id, record.default_site_logo_url,
    flag(record.features.announcements), flag(record.features.events), flag(record.features.guildWar),
    flag(record.features.gallery), flag(record.features.wiki), flag(record.features.tools), flag(record.features.storage),
    flag(record.oauth.google), flag(record.oauth.discord), flag(record.oauth.kook), flag(record.oauth.wechat),
    sizes.site_logo, sizes.class_icon, sizes.profile_image, sizes.profile_audio, sizes.announcement_image,
    sizes.wiki_image, sizes.event_image, sizes.gallery_image, sizes.storage_image,
    quotas.profile, quotas.announcement, quotas.gallery, quotas.wiki,
    record.storage_policy.images_per_item, record.absence_policy.max_span_days, record.absence_policy.max_entries_per_user,
    record.analytics_settings.reference_duration_minutes, weights.kills, weights.towers, weights.base_hp, weights.credits, weights.distance,
    record.revisionToken, record.updated_at, sizes.announcement_attachment, quotas.announcement_attachments,
    expectedRevisionToken,
  ];
}

function mapSiteConfig(row: readonly SqlValue[]): SiteConfigRecord {
  if (row.length !== 42) throw corrupt("Invalid site configuration projection");
  const string = (index: number) => {
    const value = row[index];
    if (typeof value !== "string") throw corrupt("Invalid site configuration string");
    return value;
  };
  const nullableString = (index: number) => {
    const value = row[index];
    if (value !== null && typeof value !== "string") throw corrupt("Invalid site configuration nullable string");
    return value;
  };
  const number = (index: number) => {
    const value = row[index];
    if (typeof value !== "number" || !Number.isFinite(value)) throw corrupt("Invalid site configuration number");
    return value;
  };
  const boolean = (index: number) => {
    const value = row[index];
    if (value !== 0 && value !== 1) throw corrupt("Invalid site configuration boolean");
    return value === 1;
  };
  const site = siteConfigSchema.parse({
    site_name: string(0),
    site_description: string(1),
    site_logo_media_id: nullableString(2),
    default_site_logo_url: string(3),
    features: {
      announcements: boolean(4), events: boolean(5), guildWar: boolean(6), gallery: boolean(7),
      wiki: boolean(8), tools: boolean(9), storage: boolean(10),
    },
    oauth: {
      google: boolean(11), discord: boolean(12), kook: boolean(13), wechat: boolean(14),
    },
    media_policy: {
      max_file_size_bytes: {
        site_logo: number(15), class_icon: number(16), profile_image: number(17), profile_audio: number(18),
        announcement_image: number(19), wiki_image: number(20), event_image: number(21),
        gallery_image: number(22), storage_image: number(23), announcement_attachment: number(40),
      },
      quotas: {
        profile: number(24), announcement: number(25), gallery: number(26), wiki: number(27),
        announcement_attachments: number(41),
      },
    },
    storage_policy: { images_per_item: number(28) },
    absence_policy: { max_span_days: number(29), max_entries_per_user: number(30) },
    analytics_settings: {
      reference_duration_minutes: number(31),
      modifier_weights: { kills: number(32), towers: number(33), base_hp: number(34), credits: number(35), distance: number(36) },
    },
    created_at: string(38),
    updated_at: string(39),
  });
  return { ...site, revisionToken: string(37) };
}

function configGuard(revisionToken: string) {
  return { sql: "SELECT 1 FROM site_config WHERE singleton = 1 AND revision_token = ?", params: [revisionToken] } as const;
}

function oneRow(result: SqlResult): readonly SqlValue[] | null {
  if (result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) throw corrupt("Invalid SQLite get result");
  return result.rows as readonly SqlValue[];
}

function flag(value: boolean): number {
  return value ? 1 : 0;
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
