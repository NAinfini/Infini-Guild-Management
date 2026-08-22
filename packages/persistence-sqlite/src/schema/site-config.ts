import { sql } from "drizzle-orm";
import { check, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  LIMITS,
  MAX_CONFIGURABLE_AUDIO_BYTES,
  MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES,
} from "@guild/shared/config/limits";
import { DEFAULT_SITE_DESCRIPTION, SITE_DESCRIPTION_MAX_LENGTH } from "@guild/shared/schemas/site-config";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const maxImageBytes = sql.raw(String(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES));
const maxAudioBytes = sql.raw(String(MAX_CONFIGURABLE_AUDIO_BYTES));
const maxQuota = sql.raw(String(LIMITS.media.configurableQuotaMax));
const maxStorageImages = sql.raw(String(LIMITS.content.storageImagesPerItem.max));
const maxAbsenceSpan = sql.raw(String(LIMITS.content.absenceSpanDays.max));
const maxAbsenceEntries = sql.raw(String(LIMITS.content.absencesPerUser.max));
const maxAnalyticsDuration = sql.raw(String(LIMITS.analytics.referenceDurationMinutes.max));
const maxAnalyticsWeight = sql.raw(String(LIMITS.analytics.modifierWeight.max));

export const siteConfig = sqliteTable(
  "site_config",
  {
    singleton: integer("singleton").primaryKey(),
    siteName: text("site_name").notNull(),
    siteLogoMediaId: text("site_logo_media_id"),
    defaultSiteLogoUrl: text("default_site_logo_url").notNull(),
    featureAnnouncements: integer("feature_announcements", { mode: "boolean" }).notNull(),
    featureEvents: integer("feature_events", { mode: "boolean" }).notNull(),
    featureGuildWar: integer("feature_guild_war", { mode: "boolean" }).notNull(),
    featureGallery: integer("feature_gallery", { mode: "boolean" }).notNull(),
    featureWiki: integer("feature_wiki", { mode: "boolean" }).notNull(),
    featureTools: integer("feature_tools", { mode: "boolean" }).notNull(),
    featureStorage: integer("feature_storage", { mode: "boolean" }).notNull(),
    maxSiteLogoBytes: integer("max_site_logo_bytes").notNull(),
    maxClassIconBytes: integer("max_class_icon_bytes").notNull(),
    maxProfileImageBytes: integer("max_profile_image_bytes").notNull(),
    maxProfileAudioBytes: integer("max_profile_audio_bytes").notNull(),
    maxAnnouncementImageBytes: integer("max_announcement_image_bytes").notNull(),
    maxWikiImageBytes: integer("max_wiki_image_bytes").notNull(),
    maxEventImageBytes: integer("max_event_image_bytes").notNull(),
    maxGalleryImageBytes: integer("max_gallery_image_bytes").notNull(),
    maxStorageImageBytes: integer("max_storage_image_bytes").notNull(),
    quotaProfile: integer("quota_profile").notNull(),
    quotaAnnouncement: integer("quota_announcement").notNull(),
    quotaGallery: integer("quota_gallery").notNull(),
    quotaWiki: integer("quota_wiki").notNull(),
    storageImagesPerItem: integer("storage_images_per_item").notNull(),
    absenceMaxSpanDays: integer("absence_max_span_days").notNull(),
    absenceMaxEntriesPerUser: integer("absence_max_entries_per_user").notNull(),
    analyticsReferenceDurationMinutes: real("analytics_reference_duration_minutes").notNull(),
    analyticsWeightKills: real("analytics_weight_kills").notNull(),
    analyticsWeightTowers: real("analytics_weight_towers").notNull(),
    analyticsWeightBaseHp: real("analytics_weight_base_hp").notNull(),
    analyticsWeightCredits: real("analytics_weight_credits").notNull(),
    analyticsWeightDistance: real("analytics_weight_distance").notNull(),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    siteDescription: text("site_description").notNull().default(DEFAULT_SITE_DESCRIPTION),
  },
  (table) => [
    check("site_config_singleton", sql`${table.singleton} = 1`),
    check("site_config_name_bounded", sql`length(trim(${table.siteName})) BETWEEN 1 AND 100`),
    check("site_config_description_bounded", sql`length(trim(${table.siteDescription})) BETWEEN 1 AND ${sql.raw(String(SITE_DESCRIPTION_MAX_LENGTH))}`),
    check("site_config_logo_url_present", sql`length(trim(${table.defaultSiteLogoUrl})) >= 1`),
    check("site_config_features_boolean", sql`
      ${table.featureAnnouncements} IN (0, 1) AND ${table.featureEvents} IN (0, 1)
      AND ${table.featureGuildWar} IN (0, 1) AND ${table.featureGallery} IN (0, 1)
      AND ${table.featureWiki} IN (0, 1) AND ${table.featureTools} IN (0, 1)
      AND ${table.featureStorage} IN (0, 1)`),
    check("site_config_limits_positive", sql`
      ${table.maxSiteLogoBytes} > 0 AND ${table.maxClassIconBytes} > 0
      AND ${table.maxProfileImageBytes} > 0 AND ${table.maxProfileAudioBytes} > 0
      AND ${table.maxAnnouncementImageBytes} > 0 AND ${table.maxWikiImageBytes} > 0
      AND ${table.maxEventImageBytes} > 0 AND ${table.maxGalleryImageBytes} > 0
      AND ${table.maxStorageImageBytes} > 0 AND ${table.quotaProfile} > 0
      AND ${table.quotaAnnouncement} > 0 AND ${table.quotaGallery} > 0 AND ${table.quotaWiki} > 0
      AND ${table.storageImagesPerItem} > 0 AND ${table.absenceMaxSpanDays} > 0
      AND ${table.absenceMaxEntriesPerUser} > 0`),
    check("site_config_limits_bounded", sql`
      ${table.maxSiteLogoBytes} <= ${maxImageBytes}
      AND ${table.maxClassIconBytes} <= ${maxImageBytes}
      AND ${table.maxProfileImageBytes} <= ${maxImageBytes}
      AND ${table.maxProfileAudioBytes} <= ${maxAudioBytes}
      AND ${table.maxAnnouncementImageBytes} <= ${maxImageBytes}
      AND ${table.maxWikiImageBytes} <= ${maxImageBytes}
      AND ${table.maxEventImageBytes} <= ${maxImageBytes}
      AND ${table.maxGalleryImageBytes} <= ${maxImageBytes}
      AND ${table.maxStorageImageBytes} <= ${maxImageBytes}
      AND ${table.quotaProfile} <= ${maxQuota}
      AND ${table.quotaAnnouncement} <= ${maxQuota}
      AND ${table.quotaGallery} <= ${maxQuota}
      AND ${table.quotaWiki} <= ${maxQuota}
      AND ${table.storageImagesPerItem} <= ${maxStorageImages}
      AND ${table.absenceMaxSpanDays} <= ${maxAbsenceSpan}
      AND ${table.absenceMaxEntriesPerUser} <= ${maxAbsenceEntries}`),
    check("site_config_analytics_finite", sql`
      typeof(${table.analyticsReferenceDurationMinutes}) IN ('integer', 'real')
      AND ${table.analyticsReferenceDurationMinutes} > 0
      AND ${table.analyticsReferenceDurationMinutes} <= ${maxAnalyticsDuration}
      AND ${table.analyticsReferenceDurationMinutes} = ${table.analyticsReferenceDurationMinutes}
      AND ${table.analyticsWeightKills} BETWEEN 0 AND ${maxAnalyticsWeight}
      AND ${table.analyticsWeightKills} = ${table.analyticsWeightKills}
      AND ${table.analyticsWeightTowers} BETWEEN 0 AND ${maxAnalyticsWeight}
      AND ${table.analyticsWeightTowers} = ${table.analyticsWeightTowers}
      AND ${table.analyticsWeightBaseHp} BETWEEN 0 AND ${maxAnalyticsWeight}
      AND ${table.analyticsWeightBaseHp} = ${table.analyticsWeightBaseHp}
      AND ${table.analyticsWeightCredits} BETWEEN 0 AND ${maxAnalyticsWeight}
      AND ${table.analyticsWeightCredits} = ${table.analyticsWeightCredits}
      AND ${table.analyticsWeightDistance} BETWEEN 0 AND ${maxAnalyticsWeight}
      AND ${table.analyticsWeightDistance} = ${table.analyticsWeightDistance}
      AND (${table.analyticsWeightKills} + ${table.analyticsWeightTowers} + ${table.analyticsWeightBaseHp}
        + ${table.analyticsWeightCredits} + ${table.analyticsWeightDistance}) > 0`),
    check("site_config_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);
