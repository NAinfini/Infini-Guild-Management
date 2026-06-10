// Media reference counting: write paths record which R2 keys each entity
// references so the media-orphan-cleanup cron can find unreferenced objects
// with an indexed lookup instead of scanning content tables.
//
// Contract: after an entity's media-bearing fields are written, call
// replaceMediaRefs with the full current set of keys; after an entity is
// deleted, call deleteMediaRefs. Failures throw — callers surface them like
// any other write failure (no silent degradation).

export type MediaRefEntityType = "gallery_item" | "event" | "recurring_template" | "announcement" | "wiki_article";

/** SQLite bound-parameter budget per statement; keep chunks comfortably below. */
const IN_CHUNK_SIZE = 50;

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.filter((key) => typeof key === "string" && key.length > 0))];
}

/**
 * Replaces the full reference set for one entity (delete + inserts in a single
 * atomic D1 batch). Pass an empty array to clear all references.
 */
export async function replaceMediaRefs(db: D1Database, entityType: MediaRefEntityType, entityId: string, keys: readonly string[]): Promise<void> {
  const statements = [
    db.prepare(`DELETE FROM media_references WHERE entity_type = ? AND entity_id = ?`).bind(entityType, entityId),
  ];
  for (const key of uniqueKeys(keys)) {
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id) VALUES (?, ?, ?)`).bind(key, entityType, entityId),
    );
  }
  await db.batch(statements);
}

/** Removes all references held by one entity (call on entity deletion). */
export async function deleteMediaRefs(db: D1Database, entityType: MediaRefEntityType, entityId: string): Promise<void> {
  await db.prepare(`DELETE FROM media_references WHERE entity_type = ? AND entity_id = ?`).bind(entityType, entityId).run();
}

/** Removes references for many entities of one type (call on batch deletion). */
export async function deleteMediaRefsBulk(db: D1Database, entityType: MediaRefEntityType, entityIds: readonly string[]): Promise<void> {
  const ids = uniqueKeys(entityIds);
  if (ids.length === 0) return;
  const statements = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    statements.push(
      db.prepare(`DELETE FROM media_references WHERE entity_type = ? AND entity_id IN (${placeholders})`).bind(entityType, ...chunk),
    );
  }
  await db.batch(statements);
}

/**
 * Splits a key list into referenced / unreferenced by checking the
 * media_references table in chunks. Used by the orphan-cleanup cron.
 */
export async function findUnreferencedKeys(db: D1Database, keys: readonly string[]): Promise<string[]> {
  const candidates = uniqueKeys(keys);
  if (candidates.length === 0) return [];
  const referenced = new Set<string>();
  for (let i = 0; i < candidates.length; i += IN_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + IN_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db
      .prepare(`SELECT DISTINCT media_key FROM media_references WHERE media_key IN (${placeholders})`)
      .bind(...chunk)
      .all<{ media_key: string }>();
    for (const row of rows.results ?? []) referenced.add(row.media_key);
  }
  return candidates.filter((key) => !referenced.has(key));
}

// --- Extraction helpers (shared by write paths and the cron's backfill) ---

/** Parses an events/recurring-templates `attachments` JSON column into R2 keys. */
export function extractAttachmentKeys(attachmentsJson: string | null | undefined): string[] {
  if (!attachmentsJson) return [];
  try {
    const parsed = JSON.parse(attachmentsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

/**
 * Extracts R2 keys embedded in TipTap rich-text JSON for announcements and
 * wiki articles. Mirrors the historical orphan-cleanup matching exactly:
 * quoted strings containing `<domain>/.../images/...` that start with the
 * entity's own prefix `<domain>/<entityId>/images/`.
 */
export function extractRichTextMediaKeys(bodyJson: string | null | undefined, domain: "announcement" | "wiki", entityId: string): string[] {
  if (!bodyJson) return [];
  const prefix = `${domain}/${entityId}/images/`;
  const pattern = new RegExp(`"([^"]*${domain}\\/[^"]+\\/images\\/[^"]+)"`, "g");
  const keys: string[] = [];
  for (const match of bodyJson.matchAll(pattern)) {
    if (match[1] && match[1].startsWith(prefix)) keys.push(match[1]);
  }
  return keys;
}
