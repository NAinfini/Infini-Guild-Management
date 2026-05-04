import type { Bindings } from "../index";

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
  const deletedUsers = await env.DB.prepare("SELECT id FROM users WHERE deleted_at IS NOT NULL").all<{ id: string }>();
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
      console.error("[media-orphan-cleanup] Malformed attachments JSON:", row.attachments, e);
    }
  }
  const eventObjects = await listAllKeys(env.MEDIA, "events/");
  const orphanEventKeys = eventObjects.filter((key) => !referencedEventKeys.has(key));
  if (orphanEventKeys.length > 0) {
    await env.MEDIA.delete(orphanEventKeys);
  }
}
