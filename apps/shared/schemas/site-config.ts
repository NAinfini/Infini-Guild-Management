import { z } from "zod";
import { featureFlagsSchema } from "../config/features";
import { LIMITS, MAX_CONFIGURABLE_MEDIA_FILE_BYTES } from "../config/limits";
import { activeGame } from "../games";

const richTextJsonSchema = z.string().min(1);

export const siteMediaPolicySchema = z.object({
  max_file_size_bytes: z.object({
    site_logo: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES)
      .default(LIMITS.media.maxFileSize.siteLogo),
    profile_image: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES),
    profile_audio: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES),
    announcement_image: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES),
    wiki_image: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES),
    event_image: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES),
    gallery_image: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES),
    storage_image: z.number().int().positive().max(MAX_CONFIGURABLE_MEDIA_FILE_BYTES)
      .default(LIMITS.media.maxFileSize.storageImage),
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

export const siteAnalyticsSettingsSchema = z.object({
  reference_duration_minutes: z.number().positive(),
  modifier_weights: z.record(z.string(), z.number()),
});

export const DEFAULT_SITE_MEDIA_POLICY = siteMediaPolicySchema.parse({
  max_file_size_bytes: {
    site_logo: LIMITS.media.maxFileSize.siteLogo,
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
  modifier_weights: { ...activeGame.war.modifierWeights },
});

export const onboardingChecklistItemSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  required: z.boolean().default(true),
});

export const siteConfigSchema = z.object({
  site_name: z.string(),
  site_logo_url: z.string(),
  features: featureFlagsSchema,
  media_policy: siteMediaPolicySchema,
  storage_policy: siteStoragePolicySchema,
  absence_policy: siteAbsencePolicySchema,
  analytics_settings: siteAnalyticsSettingsSchema,
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const publicSiteConfigSchema = siteConfigSchema.pick({
  site_name: true,
  site_logo_url: true,
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

export const onboardingConfigSchema = z.object({
  title: z.string(),
  body_json: richTextJsonSchema,
  checklist: z.array(onboardingChecklistItemSchema),
  enabled: z.boolean(),
  require_ack: z.boolean(),
  published_at: z.string().nullable(),
  updated_by: z.string().nullable(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const updateOnboardingConfigSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  body_json: richTextJsonSchema.optional(),
  checklist: z.array(onboardingChecklistItemSchema).max(50).optional(),
  enabled: z.boolean().optional(),
  require_ack: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one onboarding field is required",
});

export const memberOnboardingStateSchema = z.object({
  user_id: z.string(),
  completed_item_ids: z.array(z.string()),
  acknowledged_at: z.string().nullable(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const memberOnboardingResponseSchema = z.object({
  config: onboardingConfigSchema,
  state: memberOnboardingStateSchema,
  is_complete: z.boolean(),
});

export const updateMemberOnboardingSchema = z.object({
  completed_item_ids: z.array(z.string()).max(100),
});

export const adminSiteConfigResponseSchema = z.object({
  site: siteConfigSchema.omit({ analytics_settings: true }),
  onboarding: onboardingConfigSchema,
});

export type OnboardingChecklistItem = z.infer<typeof onboardingChecklistItemSchema>;
export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type PublicSiteConfig = z.infer<typeof publicSiteConfigSchema>;
export type UpdateSiteConfigPayload = z.input<typeof updateSiteConfigSchema>;
export type SiteMediaPolicy = z.infer<typeof siteMediaPolicySchema>;
export type SiteStoragePolicy = z.infer<typeof siteStoragePolicySchema>;
export type SiteAbsencePolicy = z.infer<typeof siteAbsencePolicySchema>;
export type SiteAnalyticsSettings = z.infer<typeof siteAnalyticsSettingsSchema>;
export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;
export type UpdateOnboardingConfigPayload = z.input<typeof updateOnboardingConfigSchema>;
export type MemberOnboardingState = z.infer<typeof memberOnboardingStateSchema>;
export type MemberOnboardingResponse = z.infer<typeof memberOnboardingResponseSchema>;
export type UpdateMemberOnboardingPayload = z.input<typeof updateMemberOnboardingSchema>;
export type AdminSiteConfigResponse = z.infer<typeof adminSiteConfigResponseSchema>;
