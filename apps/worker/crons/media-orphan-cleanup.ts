import type { Bindings } from "../index";
import { logger } from "../utils/logger";
import {
  deleteMediaRefs,
  extractAnnouncementImageNodeKeys,
  extractRichTextMediaKeys,
  findUnreferencedKeys,
  replaceMediaRefs,
} from "../services/media-references";
import { assertDeletableContentMediaKey, mediaKeyFromUrl } from "../services/media-keys";
import {
  loadEventAttachments,
  loadMemberImages,
  loadRecurringTemplateAttachments,
} from "../services/ordered-relations";

const SOFT_DELETE_RETENTION_DAYS = 7;
const GRACE_HOURS = 48;
const R2_PAGE_SIZE = 1000;
const R2_DELETE_CHUNK = 1000;
const D1_PAGE_SIZE = 50;
export const MEDIA_REFERENCE_BACKFILL_VERSION = 2;

type BackfillDomain =
  | "gallery"
  | "event"
  | "recurring_template"
  | "announcement"
  | "wiki_article"
  | "class_icon"
  | "storage_item"
  | "member_profile"
  | "site_config";

const CLEANUP_GROUPS: ReadonlyArray<{ prefix: string; domains: readonly BackfillDomain[] }> = [
  { prefix: "gallery/", domains: ["gallery"] },
  { prefix: "events/", domains: ["event", "recurring_template"] },
  { prefix: "announcement/", domains: ["announcement"] },
  { prefix: "wiki/", domains: ["wiki_article"] },
  { prefix: "class-icons/", domains: ["class_icon"] },
  { prefix: "storage/items/", domains: ["storage_item"] },
  { prefix: "members/", domains: ["member_profile"] },
  { prefix: "site/logo/", domains: ["site_config"] },
] as const;

type IdRow = { id: string };

async function forEachIdPage<T extends IdRow>(
  db: D1Database,
  query: string,
  handle: (row: T) => Promise<number>,
): Promise<number> {
  let cursor = "";
  let processed = 0;
  while (true) {
    const page = await db.prepare(query).bind(cursor, D1_PAGE_SIZE).all<T>();
    const rows = page.results ?? [];
    for (const row of rows) processed += await handle(row);
    if (rows.length < D1_PAGE_SIZE) return processed;
    const nextCursor = rows.at(-1)?.id;
    if (!nextCursor || nextCursor <= cursor) throw new Error("Media reference backfill cursor did not advance");
    cursor = nextCursor;
  }
}

async function forEachIdBatchPage<T extends IdRow>(
  db: D1Database,
  query: string,
  handle: (rows: T[]) => Promise<number>,
): Promise<number> {
  let cursor = "";
  let processed = 0;
  while (true) {
    const page = await db.prepare(query).bind(cursor, D1_PAGE_SIZE).all<T>();
    const rows = page.results ?? [];
    processed += await handle(rows);
    if (rows.length < D1_PAGE_SIZE) return processed;
    const nextCursor = rows.at(-1)?.id;
    if (!nextCursor || nextCursor <= cursor) throw new Error("Media reference backfill cursor did not advance");
    cursor = nextCursor;
  }
}

async function backfillDomain(db: D1Database, domain: BackfillDomain): Promise<number> {
  switch (domain) {
    case "gallery":
      return forEachIdPage<{ id: string; url: string }>(
        db,
        "SELECT id, url FROM gallery_items WHERE type = 'image' AND id > ? ORDER BY id LIMIT ?",
        async (row) => {
          await replaceMediaRefs(db, "gallery_item", row.id, row.url ? [row.url] : []);
          return row.url ? 1 : 0;
        },
      );
    case "event":
      return forEachIdBatchPage<{ id: string }>(
        db,
        "SELECT id FROM events WHERE id > ? ORDER BY id LIMIT ?",
        async (rows) => {
          const attachmentMap = await loadEventAttachments(db, rows.map((row) => row.id));
          let total = 0;
          for (const row of rows) {
            const keys = attachmentMap.get(row.id) ?? [];
            await replaceMediaRefs(db, "event", row.id, keys);
            total += keys.length;
          }
          return total;
        },
      );
    case "recurring_template":
      return forEachIdBatchPage<{ id: string }>(
        db,
        "SELECT id FROM recurring_templates WHERE id > ? ORDER BY id LIMIT ?",
        async (rows) => {
          const attachmentMap = await loadRecurringTemplateAttachments(db, rows.map((row) => row.id));
          let total = 0;
          for (const row of rows) {
            const keys = attachmentMap.get(row.id) ?? [];
            await replaceMediaRefs(db, "recurring_template", row.id, keys);
            total += keys.length;
          }
          return total;
        },
      );
    case "announcement":
      return forEachIdPage<{ id: string; body_json: string | null }>(
        db,
        "SELECT id, body_json FROM announcements WHERE id > ? ORDER BY id LIMIT ?",
        async (row) => {
          const keys = extractAnnouncementImageNodeKeys(row.body_json, row.id);
          await replaceMediaRefs(db, "announcement", row.id, keys);
          return keys.length;
        },
      );
    case "wiki_article":
      return forEachIdPage<{ id: string; body_json: string | null }>(
        db,
        "SELECT id, body_json FROM wiki_articles WHERE id > ? ORDER BY id LIMIT ?",
        async (row) => {
          const keys = new Set(extractRichTextMediaKeys(row.body_json, "wiki", row.id));
          const revisions = await db.prepare(
            "SELECT body_json FROM wiki_revisions WHERE article_id = ? ORDER BY revision",
          ).bind(row.id).all<{ body_json: string | null }>();
          for (const revision of revisions.results ?? []) {
            for (const key of extractRichTextMediaKeys(revision.body_json, "wiki", row.id)) keys.add(key);
          }
          await replaceMediaRefs(db, "wiki_article", row.id, [...keys]);
          return keys.size;
        },
      );
    case "class_icon":
      return forEachIdPage<{ id: string; icon_key: string | null }>(
        db,
        "SELECT id, icon_key FROM class_catalog WHERE id > ? ORDER BY id LIMIT ?",
        async (row) => {
          const keys = row.icon_key ? [row.icon_key] : [];
          await replaceMediaRefs(db, "class_icon", row.id, keys);
          return keys.length;
        },
      );
    case "storage_item":
      return forEachIdPage(
        db,
        "SELECT id FROM storage_items WHERE id > ? ORDER BY id LIMIT ?",
        async (row) => {
          const images = await db.prepare(
            "SELECT r2_key FROM storage_item_images WHERE item_id = ? ORDER BY created_at, id",
          ).bind(row.id).all<{ r2_key: string }>();
          const keys = (images.results ?? []).map((image) => image.r2_key).filter(Boolean);
          await replaceMediaRefs(db, "storage_item", row.id, keys);
          return keys.length;
        },
      );
    case "member_profile":
      return forEachIdBatchPage<{ id: string; avatar_key: string | null; audio_key: string | null }>(
        db,
        `SELECT mp.user_id AS id, mp.avatar_key, mp.audio_key
         FROM member_profiles mp
         JOIN users u ON u.id = mp.user_id
         WHERE mp.user_id > ?
           AND (u.deleted_at IS NULL OR u.deleted_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${SOFT_DELETE_RETENTION_DAYS} days'))
         ORDER BY mp.user_id LIMIT ?`,
        async (rows) => {
          const imageMap = await loadMemberImages(db, rows.map((row) => row.id));
          let total = 0;
          for (const row of rows) {
            const keys = [
              ...(imageMap.get(row.id) ?? []),
              ...(row.avatar_key ? [row.avatar_key] : []),
              ...(row.audio_key ? [row.audio_key] : []),
            ];
            await replaceMediaRefs(db, "member_profile", row.id, keys);
            total += keys.length;
          }
          return total;
        },
      );
    case "site_config":
      return forEachIdPage<{ id: string; site_logo_url: string | null }>(
        db,
        "SELECT id, site_logo_url FROM site_config WHERE id > ? ORDER BY id LIMIT ?",
        async (row) => {
          const key = mediaKeyFromUrl(row.site_logo_url);
          const keys = key?.startsWith("site/logo/") ? [key] : [];
          await replaceMediaRefs(db, "site_config", row.id, keys);
          return keys.length;
        },
      );
  }
}

async function ensureDomainBackfilled(db: D1Database, domain: BackfillDomain): Promise<boolean> {
  const checkpoint = await db.prepare(
    "SELECT version FROM media_reference_backfills WHERE domain = ? AND version = ?",
  ).bind(domain, MEDIA_REFERENCE_BACKFILL_VERSION).first<{ version: number }>();
  if (checkpoint?.version === MEDIA_REFERENCE_BACKFILL_VERSION) return false;

  const totalRefs = await backfillDomain(db, domain);
  await db.prepare(
    `INSERT INTO media_reference_backfills (domain, version, completed_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(domain) DO UPDATE SET version = excluded.version, completed_at = excluded.completed_at`,
  ).bind(domain, MEDIA_REFERENCE_BACKFILL_VERSION).run();
  logger.warn("media reference domain backfill completed", { domain, version: MEDIA_REFERENCE_BACKFILL_VERSION, totalRefs });
  return true;
}

async function deleteR2Keys(bucket: R2Bucket, keys: readonly string[]): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < keys.length; index += R2_DELETE_CHUNK) {
    const chunk = keys.slice(index, index + R2_DELETE_CHUNK);
    if (chunk.length === 0) continue;
    chunk.forEach(assertDeletableContentMediaKey);
    await bucket.delete([...chunk]);
    deleted += chunk.length;
  }
  return deleted;
}

async function purgeExpiredUploadLeases(env: Bindings): Promise<number> {
  let deletedObjects = 0;
  while (true) {
    const page = await env.DB.prepare(
      `SELECT media_key
       FROM media_upload_leases
       WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ORDER BY media_key
       LIMIT ?1`,
    ).bind(D1_PAGE_SIZE).all<{ media_key: string }>();
    const keys = (page.results ?? []).map((row) => row.media_key).filter(Boolean);
    if (keys.length === 0) return deletedObjects;

    const placeholders = keys.map((_, index) => `?${index + 1}`).join(", ");
    const results = await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM media_upload_leases
         WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           AND media_key IN (${placeholders})
           AND EXISTS (SELECT 1 FROM media_references ref WHERE ref.media_key = media_upload_leases.media_key)`,
      ).bind(...keys),
      env.DB.prepare(
        `DELETE FROM media_upload_leases
         WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           AND media_key IN (${placeholders})
           AND NOT EXISTS (SELECT 1 FROM media_references ref WHERE ref.media_key = media_upload_leases.media_key)
         RETURNING media_key`,
      ).bind(...keys),
    ]);
    const orphanKeys = (results[1]?.results ?? [])
      .map((row) => (row as { media_key?: unknown }).media_key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);
    deletedObjects += await deleteR2Keys(env.MEDIA, orphanKeys);
  }
}

async function forEachR2Page(
  bucket: R2Bucket,
  prefix: string,
  handle: (objects: R2Object[]) => Promise<void>,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}), limit: R2_PAGE_SIZE });
    await handle(page.objects);
    if (!page.truncated) return;
    if (!page.cursor || page.cursor === cursor) throw new Error(`R2 cursor did not advance for prefix ${prefix}`);
    cursor = page.cursor;
  }
}

async function purgeSoftDeletedUserMedia(env: Bindings): Promise<number> {
  let cursor = "";
  let deletedKeys = 0;
  while (true) {
    const page = await env.DB.prepare(
      `SELECT id FROM users
       WHERE deleted_at IS NOT NULL
         AND deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${SOFT_DELETE_RETENTION_DAYS} days')
         AND id > ?
       ORDER BY id LIMIT ?`,
    ).bind(cursor, D1_PAGE_SIZE).all<{ id: string }>();
    const users = page.results ?? [];
    for (const user of users) {
      await deleteMediaRefs(env.DB, "member_profile", user.id);
      await forEachR2Page(env.MEDIA, `members/${encodeURIComponent(user.id)}/`, async (objects) => {
        deletedKeys += await deleteR2Keys(env.MEDIA, objects.map((object) => object.key));
      });
    }
    if (users.length < D1_PAGE_SIZE) return deletedKeys;
    const nextCursor = users.at(-1)?.id;
    if (!nextCursor || nextCursor <= cursor) throw new Error("Soft-delete user cursor did not advance");
    cursor = nextCursor;
  }
}

export type MediaCleanupSummary = {
  mode: "report" | "delete";
  deletedUserMediaKeys: number;
  expiredLeaseObjectsDeleted: number;
  backfillRan: boolean;
  prefixes: Array<{ prefix: string; objectsSeen: number; candidates: number; orphansFound: number; orphansDeleted: number }>;
};

export async function runMediaOrphanCleanupCron(env: Bindings): Promise<MediaCleanupSummary> {
  // Destructive cleanup is opt-in. Production starts in report mode so a new
  // schema/backfill can be compared with R2 before permanent deletion begins.
  const mode = env.MEDIA_ORPHAN_DELETE_MODE === "delete" ? "delete" : "report";
  let backfillRan = false;
  for (const group of CLEANUP_GROUPS) {
    for (const domain of group.domains) {
      backfillRan = await ensureDomainBackfilled(env.DB, domain) || backfillRan;
    }
  }

  const expiredLeaseObjectsDeleted = mode === "delete" ? await purgeExpiredUploadLeases(env) : 0;
  const deletedUserMediaKeys = mode === "delete" ? await purgeSoftDeletedUserMedia(env) : 0;
  const graceMs = GRACE_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  const prefixSummaries: MediaCleanupSummary["prefixes"] = [];

  for (const group of CLEANUP_GROUPS) {
    const summary = { prefix: group.prefix, objectsSeen: 0, candidates: 0, orphansFound: 0, orphansDeleted: 0 };
    await forEachR2Page(env.MEDIA, group.prefix, async (objects) => {
      summary.objectsSeen += objects.length;
      const candidateKeys = objects
        .filter((object) => now - object.uploaded.getTime() > graceMs)
        .map((object) => object.key);
      summary.candidates += candidateKeys.length;
      const orphanKeys = await findUnreferencedKeys(env.DB, candidateKeys);
      summary.orphansFound += orphanKeys.length;
      if (mode === "delete") {
        summary.orphansDeleted += await deleteR2Keys(env.MEDIA, orphanKeys);
      }
    });
    logger.info("media-orphan-cleanup prefix scan", summary);
    prefixSummaries.push(summary);
  }

  return { mode, deletedUserMediaKeys, expiredLeaseObjectsDeleted, backfillRan, prefixes: prefixSummaries };
}
