import type { Bindings } from "../index";
import { logger } from "../utils/logger";
import {
  extractAttachmentKeys,
  extractRichTextMediaKeys,
  findUnreferencedKeys,
  replaceMediaRefs,
} from "../services/media-references";

/** Days to retain soft-deleted users' media before permanent removal. */
const SOFT_DELETE_RETENTION_DAYS = 7;

/** Hours after upload before an R2 object is eligible for orphan deletion.
 *  Protects freshly-uploaded editor images that have not yet been saved into
 *  a body_json / attachments field. */
const GRACE_HOURS = 48;

/** Prefixes scanned for orphaned media objects. */
const CLEANUP_PREFIXES = ["gallery/images/", "events/", "announcement/", "wiki/"] as const;

/** Maximum keys per R2 bulk-delete call. */
const R2_DELETE_CHUNK = 1000;

interface R2ObjectWithDate {
  key: string;
  uploaded: Date;
}

async function listAllObjects(bucket: R2Bucket, prefix: string): Promise<R2ObjectWithDate[]> {
  const objects: R2ObjectWithDate[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: 1000,
    });

    for (const object of page.objects) {
      objects.push({ key: object.key, uploaded: object.uploaded });
    }

    if (!page.truncated) {
      break;
    }

    cursor = page.cursor;
    if (!cursor) {
      break;
    }
  }

  return objects;
}

/**
 * One-time rebuild of the media_references table from all existing content.
 * Called only when the table is empty (fresh deploy or after manual truncation).
 * Processes rows one-by-one to bound memory usage.
 */
async function runBackfill(db: D1Database): Promise<void> {
  let totalRefs = 0;

  // gallery_items: type='image', key = url
  const galleryRows = await db.prepare("SELECT id, url FROM gallery_items WHERE type = 'image'").all<{ id: string; url: string }>();
  for (const row of galleryRows.results ?? []) {
    if (row.url) {
      await replaceMediaRefs(db, "gallery_item", row.id, [row.url]);
      totalRefs++;
    }
  }

  // events: attachments JSON array
  const eventRows = await db.prepare("SELECT id, attachments FROM events").all<{ id: string; attachments: string | null }>();
  for (const row of eventRows.results ?? []) {
    const keys = extractAttachmentKeys(row.attachments);
    if (keys.length > 0) {
      await replaceMediaRefs(db, "event", row.id, keys);
      totalRefs += keys.length;
    }
  }

  // recurring_templates: attachments JSON array (latent bug in old cron — now included)
  const templateRows = await db.prepare("SELECT id, attachments FROM recurring_templates").all<{ id: string; attachments: string | null }>();
  for (const row of templateRows.results ?? []) {
    const keys = extractAttachmentKeys(row.attachments);
    if (keys.length > 0) {
      await replaceMediaRefs(db, "recurring_template", row.id, keys);
      totalRefs += keys.length;
    }
  }

  // announcements: rich-text body_json
  const announcementRows = await db.prepare("SELECT id, body_json FROM announcements").all<{ id: string; body_json: string | null }>();
  for (const row of announcementRows.results ?? []) {
    const keys = extractRichTextMediaKeys(row.body_json, "announcement", row.id);
    if (keys.length > 0) {
      await replaceMediaRefs(db, "announcement", row.id, keys);
      totalRefs += keys.length;
    }
  }

  // wiki_articles: rich-text body_json
  const wikiRows = await db.prepare("SELECT id, body_json FROM wiki_articles").all<{ id: string; body_json: string | null }>();
  for (const row of wikiRows.results ?? []) {
    const keys = extractRichTextMediaKeys(row.body_json, "wiki", row.id);
    if (keys.length > 0) {
      await replaceMediaRefs(db, "wiki_article", row.id, keys);
      totalRefs += keys.length;
    }
  }

  logger.warn("media_references backfill completed — table was empty; rebuild finished", {
    totalRefs,
  });
}

export type MediaCleanupSummary = {
  deletedUserMediaKeys: number;
  backfillRan: boolean;
  prefixes: Array<{ prefix: string; objectsSeen: number; candidates: number; orphansDeleted: number }>;
};

/** Purge media of users soft-deleted longer than the retention window. */
async function purgeSoftDeletedUserMedia(env: Bindings): Promise<number> {
  const deletedUsers = await env.DB.prepare(
    `SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${SOFT_DELETE_RETENTION_DAYS} days')`,
  ).all<{ id: string }>();
  const deletedUserIds = (deletedUsers.results ?? [])
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  let deletedKeys = 0;
  for (const userId of deletedUserIds) {
    const profileKeys = await listAllObjects(env.MEDIA, `members/${userId}/`);
    const keys = profileKeys.map((o) => o.key);
    if (keys.length > 0) {
      await env.MEDIA.delete(keys);
      deletedKeys += keys.length;
    }
  }
  return deletedKeys;
}

export async function runMediaOrphanCleanupCron(env: Bindings): Promise<MediaCleanupSummary> {
  const deletedUserMediaKeys = await purgeSoftDeletedUserMedia(env);

  // ── Backfill if media_references table is empty ──────────────────────────
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM media_references").first<{ cnt: number }>();
  const backfillRan = (countRow?.cnt ?? 0) === 0;
  if (backfillRan) {
    await runBackfill(env.DB);
  }

  // ── Orphan cleanup per prefix ─────────────────────────────────────────────
  const graceMs = GRACE_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  const prefixSummaries: MediaCleanupSummary["prefixes"] = [];

  for (const prefix of CLEANUP_PREFIXES) {
    const allObjects = await listAllObjects(env.MEDIA, prefix);

    // Only consider objects uploaded more than GRACE_HOURS ago
    const candidates = allObjects.filter((o) => now - o.uploaded.getTime() > graceMs);
    const candidateKeys = candidates.map((o) => o.key);

    const orphanKeys = await findUnreferencedKeys(env.DB, candidateKeys);

    logger.info("media-orphan-cleanup prefix scan", {
      prefix,
      objectsSeen: allObjects.length,
      candidates: candidateKeys.length,
      orphans: orphanKeys.length,
    });

    // Delete in chunks of ≤ R2_DELETE_CHUNK
    for (let i = 0; i < orphanKeys.length; i += R2_DELETE_CHUNK) {
      const chunk = orphanKeys.slice(i, i + R2_DELETE_CHUNK);
      await env.MEDIA.delete(chunk);
    }

    if (orphanKeys.length > 0) {
      logger.info("media-orphan-cleanup deleted orphans", {
        prefix,
        deleted: orphanKeys.length,
      });
    }

    prefixSummaries.push({
      prefix,
      objectsSeen: allObjects.length,
      candidates: candidateKeys.length,
      orphansDeleted: orphanKeys.length,
    });
  }

  return { deletedUserMediaKeys, backfillRan, prefixes: prefixSummaries };
}
