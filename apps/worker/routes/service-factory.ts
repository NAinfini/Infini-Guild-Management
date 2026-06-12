import type { Context } from "hono";
import {
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  siteAbsencePolicySchema,
  siteMediaPolicySchema,
  siteStoragePolicySchema,
  type SiteAbsencePolicy,
  type SiteMediaPolicy,
  type SiteStoragePolicy,
} from "@guild/shared";
import type { Bindings } from "../index";
import { writeAuditLog, type WriteAuditLogInput } from "../services/audit";
import { publishEntityChanged, publishAnnouncementPublished } from "../services/push";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";

type PolicyColumn = "absence_policy_json" | "media_policy_json" | "storage_policy_json";

async function readSitePolicy<T>(
  c: Context,
  column: PolicyColumn,
  schema: { parse(input: unknown): T },
  fallback: T,
): Promise<T> {
  const row = await (c.env as Bindings).DB
    .prepare(`SELECT ${column} AS value FROM site_config WHERE id = ?1`)
    .bind("default")
    .first<{ value: string }>();
  if (!row?.value) return fallback;
  try {
    return schema.parse(JSON.parse(row.value) as unknown);
  } catch {
    return fallback;
  }
}

export function getAbsencePolicy(c: Context): Promise<SiteAbsencePolicy> {
  return readSitePolicy(c, "absence_policy_json", siteAbsencePolicySchema, DEFAULT_SITE_ABSENCE_POLICY);
}

export function getMediaPolicy(c: Context): Promise<SiteMediaPolicy> {
  return readSitePolicy(c, "media_policy_json", siteMediaPolicySchema, DEFAULT_SITE_MEDIA_POLICY);
}

export function getStoragePolicy(c: Context): Promise<SiteStoragePolicy> {
  return readSitePolicy(c, "storage_policy_json", siteStoragePolicySchema, DEFAULT_SITE_STORAGE_POLICY);
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
