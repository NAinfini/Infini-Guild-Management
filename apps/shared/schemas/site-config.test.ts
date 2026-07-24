import { describe, expect, it } from "vitest";
import { LIMITS } from "../config/limits";
import {
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  siteAbsencePolicySchema,
  siteMediaPolicySchema,
  siteStoragePolicySchema,
  updateSiteConfigSchema,
} from "./site-config";

describe("site media policy", () => {
  it("accepts the default media limits", () => {
    expect(siteMediaPolicySchema.parse(DEFAULT_SITE_MEDIA_POLICY)).toEqual(DEFAULT_SITE_MEDIA_POLICY);
  });

  it("leaves multipart overhead below the upload request ceiling", () => {
    const policy = structuredClone(DEFAULT_SITE_MEDIA_POLICY);
    policy.max_file_size_bytes.gallery_image = LIMITS.requestBody.upload;

    expect(siteMediaPolicySchema.safeParse(policy).success).toBe(false);
  });

  it("fills new logo and storage limits for legacy production policy JSON", () => {
    const legacy = structuredClone(DEFAULT_SITE_MEDIA_POLICY) as {
      max_file_size_bytes: Record<string, number>;
      quotas: typeof DEFAULT_SITE_MEDIA_POLICY.quotas;
    };
    delete legacy.max_file_size_bytes.site_logo;
    delete legacy.max_file_size_bytes.storage_image;

    const parsed = siteMediaPolicySchema.parse(legacy);

    expect(parsed.max_file_size_bytes.site_logo).toBe(LIMITS.media.maxFileSize.siteLogo);
    expect(parsed.max_file_size_bytes.storage_image).toBe(LIMITS.media.maxFileSize.storageImage);
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

  it("rejects analytics, pagination, and arbitrary logo URLs in the general update contract", () => {
    expect(updateSiteConfigSchema.safeParse({ analytics_settings: { reference_duration_minutes: 30 } }).success).toBe(false);
    expect(updateSiteConfigSchema.safeParse({ pagination_policy: { events: 10 } }).success).toBe(false);
    expect(updateSiteConfigSchema.safeParse({ site_logo_url: "https://example.com/tracker.gif" }).success).toBe(false);
  });
});
