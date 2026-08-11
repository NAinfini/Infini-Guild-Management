import { z } from "zod";
import { featureFlagsSchema } from "../config/features";
import {
  LIMITS,
  MAX_CONFIGURABLE_AUDIO_BYTES,
  MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES,
} from "../config/limits";
import { mediaIdSchema } from "./media";

export const siteMediaPolicySchema = z.object({
  max_file_size_bytes: z.object({
    site_logo: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
    class_icon: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
    profile_image: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
    profile_audio: z.number().int().positive().max(MAX_CONFIGURABLE_AUDIO_BYTES),
    announcement_image: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
    wiki_image: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
    event_image: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
    gallery_image: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
    storage_image: z.number().int().positive().max(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES),
  }),
  quotas: z.object({
    profile: z.number().int().positive().max(LIMITS.media.configurableQuotaMax),
    announcement: z.number().int().positive().max(LIMITS.media.configurableQuotaMax),
    gallery: z.number().int().positive().max(LIMITS.media.configurableQuotaMax),
    wiki: z.number().int().positive().max(LIMITS.media.configurableQuotaMax),
  }),
});

export const siteStoragePolicySchema = z.object({
  images_per_item: z.number().int().min(1).max(LIMITS.content.storageImagesPerItem.max),
});

export const siteAbsencePolicySchema = z.object({
  max_span_days: z.number().int().min(1).max(LIMITS.content.absenceSpanDays.max),
  max_entries_per_user: z.number().int().min(1).max(LIMITS.content.absencesPerUser.max),
});

export const siteAnalyticsModifierWeightsSchema = z.object({
  kills: z.number().min(0).max(LIMITS.analytics.modifierWeight.max),
  towers: z.number().min(0).max(LIMITS.analytics.modifierWeight.max),
  base_hp: z.number().min(0).max(LIMITS.analytics.modifierWeight.max),
  credits: z.number().min(0).max(LIMITS.analytics.modifierWeight.max),
  distance: z.number().min(0).max(LIMITS.analytics.modifierWeight.max),
}).strict();

export const siteAnalyticsSettingsSchema = z.object({
  reference_duration_minutes: z.number().positive().max(LIMITS.analytics.referenceDurationMinutes.max),
  modifier_weights: siteAnalyticsModifierWeightsSchema,
}).strict().refine(
  ({ modifier_weights }) => Object.values(modifier_weights).some((weight) => weight > 0),
  { path: ["modifier_weights"], message: "At least one analytics weight must be positive" },
);

export const DEFAULT_SITE_MEDIA_POLICY = siteMediaPolicySchema.parse({
  max_file_size_bytes: {
    site_logo: LIMITS.media.maxFileSize.siteLogo,
    class_icon: LIMITS.media.maxFileSize.classIcon,
    profile_image: LIMITS.media.maxFileSize.profileImage,
    profile_audio: LIMITS.media.maxFileSize.profileAudio,
    announcement_image: LIMITS.media.maxFileSize.announcementImage,
    wiki_image: LIMITS.media.maxFileSize.wikiImage,
    event_image: LIMITS.media.maxFileSize.eventImage,
    gallery_image: LIMITS.media.maxFileSize.galleryImage,
    storage_image: LIMITS.media.maxFileSize.storageImage,
  },
  quotas: {
    profile: LIMITS.media.quotas.profile,
    announcement: LIMITS.media.quotas.announcement,
    gallery: LIMITS.media.quotas.gallery,
    wiki: LIMITS.media.quotas.wiki,
  },
});

export const DEFAULT_SITE_STORAGE_POLICY = siteStoragePolicySchema.parse({
  images_per_item: LIMITS.content.storageImagesPerItem.max,
});

export const DEFAULT_SITE_ABSENCE_POLICY = siteAbsencePolicySchema.parse({
  max_span_days: LIMITS.content.absenceSpanDays.max,
  max_entries_per_user: LIMITS.content.absencesPerUser.max,
});

export const DEFAULT_SITE_ANALYTICS_SETTINGS = siteAnalyticsSettingsSchema.parse({
  reference_duration_minutes: 30,
  modifier_weights: {
    kills: 0.30,
    towers: 0.10,
    credits: 0.30,
    distance: 0.15,
    base_hp: 0.15,
  },
});

export const siteConfigSchema = z.object({
  site_name: z.string().min(1).max(100).refine((value) => value === value.trim(), "Site name must be trimmed"),
  site_logo_media_id: mediaIdSchema.nullable(),
  default_site_logo_url: z.string().min(1),
  features: featureFlagsSchema,
  media_policy: siteMediaPolicySchema,
  storage_policy: siteStoragePolicySchema,
  absence_policy: siteAbsencePolicySchema,
  analytics_settings: siteAnalyticsSettingsSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const publicSiteConfigSchema = siteConfigSchema.pick({
  site_name: true,
  site_logo_media_id: true,
  default_site_logo_url: true,
  features: true,
  media_policy: true,
  storage_policy: true,
  absence_policy: true,
});

const updateSiteMediaPolicySchema = z.object({
  max_file_size_bytes: siteMediaPolicySchema.shape.max_file_size_bytes.partial().optional(),
  quotas: siteMediaPolicySchema.shape.quotas.partial().optional(),
});

export const updateSiteConfigSchema = z.object({
  site_name: z.string().trim().min(1).max(100).optional(),
  features: featureFlagsSchema.partial().optional(),
  media_policy: updateSiteMediaPolicySchema.optional(),
  storage_policy: siteStoragePolicySchema.partial().optional(),
  absence_policy: siteAbsencePolicySchema.partial().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one site config field is required",
});

export const adminSiteConfigResponseSchema = z.object({
  site: siteConfigSchema.omit({ analytics_settings: true }),
});

export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type PublicSiteConfig = z.infer<typeof publicSiteConfigSchema>;
export type UpdateSiteConfigPayload = z.input<typeof updateSiteConfigSchema>;
export type SiteMediaPolicy = z.infer<typeof siteMediaPolicySchema>;
export type SiteStoragePolicy = z.infer<typeof siteStoragePolicySchema>;
export type SiteAbsencePolicy = z.infer<typeof siteAbsencePolicySchema>;
export type SiteAnalyticsSettings = z.infer<typeof siteAnalyticsSettingsSchema>;
export type AdminSiteConfigResponse = z.infer<typeof adminSiteConfigResponseSchema>;
