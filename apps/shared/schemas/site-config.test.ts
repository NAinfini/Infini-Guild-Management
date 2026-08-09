import { describe, expect, it } from "vitest";
import { LIMITS } from "../config/limits";
import {
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  siteAbsencePolicySchema,
  siteAnalyticsSettingsSchema,
  siteMediaPolicySchema,
  siteStoragePolicySchema,
  updateSiteConfigSchema,
} from "./site-config";

describe("site media policy", () => {
  it("keeps guild-war modifier defaults in Site Config", () => {
    expect(DEFAULT_SITE_ANALYTICS_SETTINGS).toEqual({
      reference_duration_minutes: 30,
      modifier_weights: {
        kills: 0.3,
        towers: 0.1,
        credits: 0.3,
        distance: 0.15,
        base_hp: 0.15,
      },
    });
    expect(siteAnalyticsSettingsSchema.parse(DEFAULT_SITE_ANALYTICS_SETTINGS))
      .toEqual(DEFAULT_SITE_ANALYTICS_SETTINGS);
  });

  it("requires exactly the five fixed nonnegative analytics weights with a positive sum", () => {
    expect(siteAnalyticsSettingsSchema.safeParse({
      ...DEFAULT_SITE_ANALYTICS_SETTINGS,
      modifier_weights: { ...DEFAULT_SITE_ANALYTICS_SETTINGS.modifier_weights, assists: 1 },
    }).success).toBe(false);
    expect(siteAnalyticsSettingsSchema.safeParse({
      ...DEFAULT_SITE_ANALYTICS_SETTINGS,
      modifier_weights: { ...DEFAULT_SITE_ANALYTICS_SETTINGS.modifier_weights, kills: -1 },
    }).success).toBe(false);
    expect(siteAnalyticsSettingsSchema.safeParse({
      ...DEFAULT_SITE_ANALYTICS_SETTINGS,
      modifier_weights: { kills: 0, towers: 0, base_hp: 0, credits: 0, distance: 0 },
    }).success).toBe(false);
  });

  it("accepts the default media limits", () => {
    expect(siteMediaPolicySchema.parse(DEFAULT_SITE_MEDIA_POLICY)).toEqual(DEFAULT_SITE_MEDIA_POLICY);
  });

  it("leaves multipart overhead below the upload request ceiling", () => {
    const policy = structuredClone(DEFAULT_SITE_MEDIA_POLICY);
    policy.max_file_size_bytes.gallery_image = LIMITS.requestBody.upload;

    expect(siteMediaPolicySchema.safeParse(policy).success).toBe(false);
  });

  it("requires every media limit in the persisted policy", () => {
    const incomplete = structuredClone(DEFAULT_SITE_MEDIA_POLICY) as {
      max_file_size_bytes: Record<string, number>;
      quotas: typeof DEFAULT_SITE_MEDIA_POLICY.quotas;
    };
    delete incomplete.max_file_size_bytes.site_logo;
    delete incomplete.max_file_size_bytes.storage_image;

    expect(siteMediaPolicySchema.safeParse(incomplete).success).toBe(false);
  });

  it("caps configurable quotas and content policies at hard application limits", () => {
    expect(siteMediaPolicySchema.safeParse({
      ...DEFAULT_SITE_MEDIA_POLICY,
      quotas: { ...DEFAULT_SITE_MEDIA_POLICY.quotas, gallery: LIMITS.media.configurableQuotaMax + 1 },
    }).success).toBe(false);
    expect(siteStoragePolicySchema.safeParse({
      images_per_item: LIMITS.content.storageImagesPerItem.max + 1,
    }).success).toBe(false);
    expect(siteAbsencePolicySchema.safeParse({
      ...DEFAULT_SITE_ABSENCE_POLICY,
      max_span_days: LIMITS.content.absenceSpanDays.max + 1,
    }).success).toBe(false);
    expect(siteStoragePolicySchema.parse(DEFAULT_SITE_STORAGE_POLICY)).toEqual(DEFAULT_SITE_STORAGE_POLICY);
  });

  it("rejects analytics, pagination, and upload-owned logo media in the general update contract", () => {
    expect(updateSiteConfigSchema.safeParse({ analytics_settings: { reference_duration_minutes: 30 } }).success).toBe(false);
    expect(updateSiteConfigSchema.safeParse({ pagination_policy: { events: 10 } }).success).toBe(false);
    expect(updateSiteConfigSchema.safeParse({ site_logo_media_id: "media1234567890abcdef" }).success).toBe(false);
  });

  it("rejects game rules in the general Site Config update contract", () => {
    expect(updateSiteConfigSchema.safeParse({ game_rules: {} }).success).toBe(false);
  });
});
