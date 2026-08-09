import {
  DEFAULT_GAME_RULES,
  featureFlagsSchema,
  siteAbsencePolicySchema,
  siteMediaPolicySchema,
  siteStoragePolicySchema,
  type FeatureFlags,
  type SiteAbsencePolicy,
  type SiteMediaPolicy,
  type SiteStoragePolicy,
} from "@guild/shared";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import type { Context } from "hono";
import type { Bindings } from "../index";
import { MediaService } from "../services/MediaService";
import { getSystemTestRunId } from "../services/SystemTestService";
import { writeAuditLog, type WriteAuditLogInput } from "../services/audit";
import { publishAnnouncementPublished, publishEntityChanged } from "../services/push";

type SitePolicyRow = {
  feature_announcements_enabled: number;
  feature_events_enabled: number;
  feature_guild_war_enabled: number;
  feature_gallery_enabled: number;
  feature_wiki_enabled: number;
  feature_tools_enabled: number;
  feature_storage_enabled: number;
  media_site_logo_max_bytes: number;
  media_class_icon_max_bytes: number;
  media_profile_image_max_bytes: number;
  media_profile_audio_max_bytes: number;
  media_announcement_image_max_bytes: number;
  media_wiki_image_max_bytes: number;
  media_event_image_max_bytes: number;
  media_gallery_image_max_bytes: number;
  media_storage_image_max_bytes: number;
  media_profile_quota: number;
  media_announcement_quota: number;
  media_gallery_quota: number;
  media_wiki_quota: number;
  storage_images_per_item: number;
  absence_max_span_days: number;
  absence_max_entries_per_user: number;
};

const sitePolicyRowByRequest = new WeakMap<Context, Promise<SitePolicyRow>>();

function loadSitePolicyRow(c: Context): Promise<SitePolicyRow> {
  const pending = sitePolicyRowByRequest.get(c);
  if (pending) return pending;
  const query = (c.env as Bindings).DB
    .prepare(
      `SELECT
        feature_announcements_enabled, feature_events_enabled, feature_guild_war_enabled,
        feature_gallery_enabled, feature_wiki_enabled, feature_tools_enabled, feature_storage_enabled,
        media_site_logo_max_bytes, media_class_icon_max_bytes, media_profile_image_max_bytes,
        media_profile_audio_max_bytes, media_announcement_image_max_bytes, media_wiki_image_max_bytes,
        media_event_image_max_bytes, media_gallery_image_max_bytes, media_storage_image_max_bytes,
        media_profile_quota, media_announcement_quota, media_gallery_quota, media_wiki_quota,
        storage_images_per_item, absence_max_span_days, absence_max_entries_per_user
       FROM site_config WHERE id = ?1`,
    )
    .bind("default")
    .first<SitePolicyRow>()
    .then((row) => {
      if (!row) throw new Error('Required site_config singleton "default" is missing');
      return row;
    });
  sitePolicyRowByRequest.set(c, query);
  return query;
}

function readBoolean(value: number, column: string): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(`Invalid boolean value in site_config.${column}`);
}

export async function getAbsencePolicy(c: Context): Promise<SiteAbsencePolicy> {
  const row = await loadSitePolicyRow(c);
  return siteAbsencePolicySchema.parse({
    max_span_days: row.absence_max_span_days,
    max_entries_per_user: row.absence_max_entries_per_user,
  });
}

export async function getFeatureFlags(c: Context): Promise<FeatureFlags> {
  const row = await loadSitePolicyRow(c);
  return featureFlagsSchema.parse({
    announcements: readBoolean(row.feature_announcements_enabled, "feature_announcements_enabled"),
    events: readBoolean(row.feature_events_enabled, "feature_events_enabled"),
    guildWar: readBoolean(row.feature_guild_war_enabled, "feature_guild_war_enabled"),
    gallery: readBoolean(row.feature_gallery_enabled, "feature_gallery_enabled"),
    wiki: readBoolean(row.feature_wiki_enabled, "feature_wiki_enabled"),
    tools: readBoolean(row.feature_tools_enabled, "feature_tools_enabled"),
    storage: readBoolean(row.feature_storage_enabled, "feature_storage_enabled"),
  });
}

export async function getMediaPolicy(c: Context): Promise<SiteMediaPolicy> {
  const row = await loadSitePolicyRow(c);
  return siteMediaPolicySchema.parse({
    max_file_size_bytes: {
      site_logo: row.media_site_logo_max_bytes,
      class_icon: row.media_class_icon_max_bytes,
      profile_image: row.media_profile_image_max_bytes,
      profile_audio: row.media_profile_audio_max_bytes,
      announcement_image: row.media_announcement_image_max_bytes,
      wiki_image: row.media_wiki_image_max_bytes,
      event_image: row.media_event_image_max_bytes,
      gallery_image: row.media_gallery_image_max_bytes,
      storage_image: row.media_storage_image_max_bytes,
    },
    quotas: {
      profile: row.media_profile_quota,
      announcement: row.media_announcement_quota,
      gallery: row.media_gallery_quota,
      wiki: row.media_wiki_quota,
    },
  });
}

export async function getStoragePolicy(c: Context): Promise<SiteStoragePolicy> {
  const row = await loadSitePolicyRow(c);
  return siteStoragePolicySchema.parse({ images_per_item: row.storage_images_per_item });
}

export function getGameRules(_c: Context) {
  return Promise.resolve(DEFAULT_GAME_RULES);
}

export function commonDeps(c: Context) {
  return {
    writeAuditLog: (input: WriteAuditLogInput) => writeAuditLog(c, input),
    publishEntityChanged: (payload: { entityType: PushEntityType; entityId: string; hint: PushHint; displayName?: string }) =>
      publishEntityChanged(c, payload),
    getAbsencePolicy: () => getAbsencePolicy(c),
    getGameRules: () => getGameRules(c),
  };
}

export function withMedia(c: Context) {
  const env = c.env as Bindings;
  return {
    ...commonDeps(c),
    media: env.MEDIA,
    mediaService: new MediaService(env.DB, env.MEDIA),
    rawDb: env.DB,
    systemTestRunId: getSystemTestRunId(c),
    getMediaPolicy: () => getMediaPolicy(c),
    getStoragePolicy: () => getStoragePolicy(c),
  };
}

export function withMediaAndPublishAnnouncement(c: Context) {
  return {
    ...withMedia(c),
    publishAnnouncementPublished: (payload: { announcementId: string; title: string; publishedAt?: string }) =>
      publishAnnouncementPublished(c, payload),
  };
}
