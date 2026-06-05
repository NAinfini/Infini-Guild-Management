import type { Bindings } from "../index";
import { logger } from "../utils/logger";

/** Days to retain soft-deleted users' media before permanent removal. */
const SOFT_DELETE_RETENTION_DAYS = 7;

async function listAllKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: 1000,
    });

    for (const object of page.objects) {
      keys.push(object.key);
    }

    if (!page.truncated) {
      break;
    }

    cursor = page.cursor;
    if (!cursor) {
      break;
    }
  }

  return keys;
}

export async function runMediaOrphanCleanupCron(env: Bindings): Promise<void> {
  // Retention policy: only purge media for users soft-deleted more than N days ago.
  // We use strftime to produce ISO-8601 output so the comparison matches the stored
  // deleted_at format (JavaScript toISOString → "YYYY-MM-DDTHH:MM:SS.sssZ").
  const deletedUsers = await env.DB.prepare(
    `SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${SOFT_DELETE_RETENTION_DAYS} days')`,
  ).all<{ id: string }>();
  const deletedUserIds = (deletedUsers.results ?? [])
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const userId of deletedUserIds) {
    const profileKeys = await listAllKeys(env.MEDIA, `members/${userId}/`);
    if (profileKeys.length > 0) {
      await env.MEDIA.delete(profileKeys);
    }
  }

  const galleryRows = await env.DB.prepare("SELECT url FROM gallery_items WHERE type = 'image'").all<{ url: string }>();
  const referencedGalleryKeys = new Set(
    (galleryRows.results ?? [])
      .map((row) => row.url)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );

  const galleryObjects = await listAllKeys(env.MEDIA, "gallery/images/");
  const orphanGalleryKeys = galleryObjects.filter((key) => !referencedGalleryKeys.has(key));
  if (orphanGalleryKeys.length > 0) {
    await env.MEDIA.delete(orphanGalleryKeys);
  }

  const eventRows = await env.DB.prepare("SELECT attachments FROM events").all<{ attachments: string | null }>();
  const referencedEventKeys = new Set<string>();
  for (const row of eventRows.results ?? []) {
    if (!row.attachments) {
      continue;
    }
    try {
      const parsed = JSON.parse(row.attachments) as unknown;
      if (!Array.isArray(parsed)) {
        continue;
      }
      for (const item of parsed) {
        if (typeof item === "string" && item.length > 0) {
          referencedEventKeys.add(item);
        }
      }
    } catch (e) {
      logger.warn("Malformed attachments JSON", { value: row.attachments, error: String(e) });
    }
  }
  const eventObjects = await listAllKeys(env.MEDIA, "events/");
  const orphanEventKeys = eventObjects.filter((key) => !referencedEventKeys.has(key));
  if (orphanEventKeys.length > 0) {
    await env.MEDIA.delete(orphanEventKeys);
  }

  const announcementRows = await env.DB.prepare("SELECT id, body_json FROM announcements").all<{ id: string; body_json: string | null }>();
  const referencedAnnouncementKeys = new Set<string>();
  for (const row of announcementRows.results ?? []) {
    if (!row.body_json) continue;
    const prefix = `announcement/${row.id}/images/`;
    const matches = row.body_json.matchAll(/"([^"]*announcement\/[^"]+\/images\/[^"]+)"/g);
    for (const match of matches) {
      if (match[1] && match[1].startsWith(prefix)) referencedAnnouncementKeys.add(match[1]);
    }
  }
  const announcementObjects = await listAllKeys(env.MEDIA, "announcement/");
  const orphanAnnouncementKeys = announcementObjects.filter((key) => !referencedAnnouncementKeys.has(key));
  if (orphanAnnouncementKeys.length > 0) {
    await env.MEDIA.delete(orphanAnnouncementKeys);
  }

  const wikiRows = await env.DB.prepare("SELECT id, body_json FROM wiki_articles").all<{ id: string; body_json: string | null }>();
  const referencedWikiKeys = new Set<string>();
  for (const row of wikiRows.results ?? []) {
    if (!row.body_json) continue;
    const prefix = `wiki/${row.id}/images/`;
    const matches = row.body_json.matchAll(/"([^"]*wiki\/[^"]+\/images\/[^"]+)"/g);
    for (const match of matches) {
      if (match[1] && match[1].startsWith(prefix)) referencedWikiKeys.add(match[1]);
    }
  }
  const wikiObjects = await listAllKeys(env.MEDIA, "wiki/");
  const orphanWikiKeys = wikiObjects.filter((key) => !referencedWikiKeys.has(key));
  if (orphanWikiKeys.length > 0) {
    await env.MEDIA.delete(orphanWikiKeys);
  }
}
