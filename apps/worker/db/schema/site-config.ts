// Domain: Site Config
// Tables: site_config
// Dependencies: none
import {
  LIMITS,
  MAX_CONFIGURABLE_AUDIO_BYTES,
  MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES,
} from "@guild/shared";
import { sql } from "drizzle-orm";
import { check, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowUtc } from "./shared";

const imageMaxBytes = sql.raw(String(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES));
const audioMaxBytes = sql.raw(String(MAX_CONFIGURABLE_AUDIO_BYTES));
const quotaMax = sql.raw(String(LIMITS.media.configurableQuotaMax));
const storageImagesMax = sql.raw(String(LIMITS.content.storageImagesPerItem.max));
const absenceSpanMax = sql.raw(String(LIMITS.content.absenceSpanDays.max));
const absenceEntriesMax = sql.raw(String(LIMITS.content.absencesPerUser.max));

export const siteConfig = sqliteTable(
  "site_config",
  {
    id: text("id").primaryKey(),
    siteName: text("site_name").notNull(),
    featureAnnouncementsEnabled: integer("feature_announcements_enabled", { mode: "boolean" }).notNull(),
    featureEventsEnabled: integer("feature_events_enabled", { mode: "boolean" }).notNull(),
    featureGuildWarEnabled: integer("feature_guild_war_enabled", { mode: "boolean" }).notNull(),
    featureGalleryEnabled: integer("feature_gallery_enabled", { mode: "boolean" }).notNull(),
    featureWikiEnabled: integer("feature_wiki_enabled", { mode: "boolean" }).notNull(),
    featureToolsEnabled: integer("feature_tools_enabled", { mode: "boolean" }).notNull(),
    featureStorageEnabled: integer("feature_storage_enabled", { mode: "boolean" }).notNull(),
    mediaSiteLogoMaxBytes: integer("media_site_logo_max_bytes").notNull(),
    mediaClassIconMaxBytes: integer("media_class_icon_max_bytes").notNull(),
    mediaProfileImageMaxBytes: integer("media_profile_image_max_bytes").notNull(),
    mediaProfileAudioMaxBytes: integer("media_profile_audio_max_bytes").notNull(),
    mediaAnnouncementImageMaxBytes: integer("media_announcement_image_max_bytes").notNull(),
    mediaWikiImageMaxBytes: integer("media_wiki_image_max_bytes").notNull(),
    mediaEventImageMaxBytes: integer("media_event_image_max_bytes").notNull(),
    mediaGalleryImageMaxBytes: integer("media_gallery_image_max_bytes").notNull(),
    mediaStorageImageMaxBytes: integer("media_storage_image_max_bytes").notNull(),
    mediaProfileQuota: integer("media_profile_quota").notNull(),
    mediaAnnouncementQuota: integer("media_announcement_quota").notNull(),
    mediaGalleryQuota: integer("media_gallery_quota").notNull(),
    mediaWikiQuota: integer("media_wiki_quota").notNull(),
    storageImagesPerItem: integer("storage_images_per_item").notNull(),
    absenceMaxSpanDays: integer("absence_max_span_days").notNull(),
    absenceMaxEntriesPerUser: integer("absence_max_entries_per_user").notNull(),
    analyticsReferenceDurationMinutes: real("analytics_reference_duration_minutes").notNull(),
    analyticsKillsWeight: real("analytics_kills_weight").notNull(),
    analyticsTowersWeight: real("analytics_towers_weight").notNull(),
    analyticsBaseHpWeight: real("analytics_base_hp_weight").notNull(),
    analyticsCreditsWeight: real("analytics_credits_weight").notNull(),
    analyticsDistanceWeight: real("analytics_distance_weight").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("site_config_singleton_id", sql`${table.id} = 'default'`),
    check(
      "site_config_site_name_valid",
      sql`length(${table.siteName}) BETWEEN 1 AND 100 AND ${table.siteName} = trim(${table.siteName})`,
    ),
    check(
      "site_config_feature_flags_boolean",
      sql`${table.featureAnnouncementsEnabled} IN (0, 1)
        AND ${table.featureEventsEnabled} IN (0, 1)
        AND ${table.featureGuildWarEnabled} IN (0, 1)
        AND ${table.featureGalleryEnabled} IN (0, 1)
        AND ${table.featureWikiEnabled} IN (0, 1)
        AND ${table.featureToolsEnabled} IN (0, 1)
        AND ${table.featureStorageEnabled} IN (0, 1)`,
    ),
    check(
      "site_config_media_max_bytes_bounds",
      sql`${table.mediaSiteLogoMaxBytes} BETWEEN 1 AND ${imageMaxBytes}
        AND ${table.mediaClassIconMaxBytes} BETWEEN 1 AND ${imageMaxBytes}
        AND ${table.mediaProfileImageMaxBytes} BETWEEN 1 AND ${imageMaxBytes}
        AND ${table.mediaProfileAudioMaxBytes} BETWEEN 1 AND ${audioMaxBytes}
        AND ${table.mediaAnnouncementImageMaxBytes} BETWEEN 1 AND ${imageMaxBytes}
        AND ${table.mediaWikiImageMaxBytes} BETWEEN 1 AND ${imageMaxBytes}
        AND ${table.mediaEventImageMaxBytes} BETWEEN 1 AND ${imageMaxBytes}
        AND ${table.mediaGalleryImageMaxBytes} BETWEEN 1 AND ${imageMaxBytes}
        AND ${table.mediaStorageImageMaxBytes} BETWEEN 1 AND ${imageMaxBytes}`,
    ),
    check(
      "site_config_media_quotas_bounds",
      sql`${table.mediaProfileQuota} BETWEEN 1 AND ${quotaMax}
        AND ${table.mediaAnnouncementQuota} BETWEEN 1 AND ${quotaMax}
        AND ${table.mediaGalleryQuota} BETWEEN 1 AND ${quotaMax}
        AND ${table.mediaWikiQuota} BETWEEN 1 AND ${quotaMax}`,
    ),
    check(
      "site_config_storage_images_per_item_bounds",
      sql`${table.storageImagesPerItem} BETWEEN 1 AND ${storageImagesMax}`,
    ),
    check(
      "site_config_absence_policy_bounds",
      sql`${table.absenceMaxSpanDays} BETWEEN 1 AND ${absenceSpanMax}
        AND ${table.absenceMaxEntriesPerUser} BETWEEN 1 AND ${absenceEntriesMax}`,
    ),
    check(
      "site_config_analytics_reference_duration_positive",
      sql`${table.analyticsReferenceDurationMinutes} > 0`,
    ),
    check(
      "site_config_analytics_weights_valid",
      sql`${table.analyticsKillsWeight} >= 0
        AND ${table.analyticsTowersWeight} >= 0
        AND ${table.analyticsBaseHpWeight} >= 0
        AND ${table.analyticsCreditsWeight} >= 0
        AND ${table.analyticsDistanceWeight} >= 0
        AND (${table.analyticsKillsWeight} + ${table.analyticsTowersWeight} + ${table.analyticsBaseHpWeight} + ${table.analyticsCreditsWeight} + ${table.analyticsDistanceWeight}) > 0`,
    ),
  ],
);
