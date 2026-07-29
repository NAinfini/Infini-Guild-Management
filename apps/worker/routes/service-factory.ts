import type { Context } from "hono";
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  featureFlagsSchema,
  siteAbsencePolicySchema,
  siteMediaPolicySchema,
  siteStoragePolicySchema,
  type FeatureFlags,
  type SiteAbsencePolicy,
  type SiteMediaPolicy,
  type SiteStoragePolicy,
} from "@guild/shared";
import type { Bindings } from "../index";
import { logger } from "../utils/logger";
import { writeAuditLog, type WriteAuditLogInput } from "../services/audit";
import { publishEntityChanged, publishAnnouncementPublished } from "../services/push";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { getSystemTestRunId } from "../services/SystemTestService";

type PolicyColumn = "absence_policy_json" | "feature_flags_json" | "media_policy_json" | "storage_policy_json";
type SitePolicyRow = Record<PolicyColumn, string | null>;

/**
 * One D1 read per request for the whole policy row, memoised on the request's
 * Context. `featureGateMiddleware` runs on every content API call, so each of
 * those requests used to pay an extra round-trip, and an upload that needs both
 * the feature flags and the media policy paid for the same row twice.
 *
 * Deliberately NOT cached across requests: the Cache API is per-colo, so a
 * `delete` on config change would not reach other colos and an admin toggling a
 * feature would see it apply unevenly. One D1 read per request is the cheaper
 * mistake at guild scale.
 */
const sitePolicyRowByRequest = new WeakMap<Context, Promise<SitePolicyRow | null>>();

function loadSitePolicyRow(c: Context): Promise<SitePolicyRow | null> {
  const pending = sitePolicyRowByRequest.get(c);
  if (pending) return pending;
  const query = (c.env as Bindings).DB
    .prepare(
      "SELECT absence_policy_json, feature_flags_json, media_policy_json, storage_policy_json FROM site_config WHERE id = ?1",
    )
    .bind("default")
    .first<SitePolicyRow>();
  sitePolicyRowByRequest.set(c, query);
  return query;
}

async function readSitePolicy<T>(
  c: Context,
  column: PolicyColumn,
  schema: { parse(input: unknown): T },
  fallback: T,
): Promise<T> {
  const row = await loadSitePolicyRow(c);
  const value = row?.[column];
  // Missing row or column is the legitimate pre-seed default, not an error.
  if (!value) return fallback;
  try {
    return schema.parse(JSON.parse(value) as unknown);
  } catch (error) {
    // Deliberate fail-open, and the ONLY reason it is acceptable is that this
    // line is loud. A corrupt blob used to silently re-enable every feature
    // flag with no trace at all — the flags gate whole API prefixes, so that
    // quietly re-opened features an admin had turned off. Failing closed
    // instead would turn a data-integrity glitch into a full site outage,
    // which is the worse failure mode. To flip the policy, throw here instead
    // of returning the fallback.
    logger.error("site_config policy column is corrupt; serving defaults", {
      column,
      requestId: c.get("requestId") as string | undefined,
      reason: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export function getAbsencePolicy(c: Context): Promise<SiteAbsencePolicy> {
  return readSitePolicy(c, "absence_policy_json", siteAbsencePolicySchema, DEFAULT_SITE_ABSENCE_POLICY);
}

export function getFeatureFlags(c: Context): Promise<FeatureFlags> {
  return readSitePolicy(c, "feature_flags_json", featureFlagsSchema, DEFAULT_FEATURE_FLAGS);
}

export function getMediaPolicy(c: Context): Promise<SiteMediaPolicy> {
  return readSitePolicy(c, "media_policy_json", siteMediaPolicySchema, DEFAULT_SITE_MEDIA_POLICY);
}

export function getStoragePolicy(c: Context): Promise<SiteStoragePolicy> {
  return readSitePolicy(c, "storage_policy_json", siteStoragePolicySchema, DEFAULT_SITE_STORAGE_POLICY);
}

export async function hasMediaQuotaCapacity(
  c: Context,
  prefix: string,
  incomingCount: number,
  quota: number,
): Promise<boolean> {
  const result = await (c.env as Bindings).MEDIA.list({ prefix, limit: quota });
  return result.objects.length + incomingCount <= quota;
}

export function commonDeps(c: Context) {
  return {
    writeAuditLog: (input: WriteAuditLogInput) => writeAuditLog(c, input),
    publishEntityChanged: (payload: { entityType: PushEntityType; entityId: string; hint: PushHint; displayName?: string }) =>
      publishEntityChanged(c, payload),
    getAbsencePolicy: () => getAbsencePolicy(c),
  };
}

export function withMedia(c: Context) {
  return {
    ...commonDeps(c),
    media: (c.env as Bindings).MEDIA,
    rawDb: (c.env as Bindings).DB,
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
    signingSecret: (c.env as Bindings).SIGNING_SECRET,
  };
}
