// Media reference counting: write paths record which R2 keys each entity
// references so the media-orphan-cleanup cron can find unreferenced objects
// with an indexed lookup instead of scanning content tables.
//
// Contract: after an entity's media-bearing fields are written, call
// replaceMediaRefs with the full current set of keys; after an entity is
// deleted, call deleteMediaRefs. Failures throw — callers surface them like
// any other write failure (no silent degradation).

export type MediaRefEntityType =
  | "gallery_item"
  | "event"
  | "recurring_template"
  | "announcement"
  | "wiki_article"
  | "storage_item"
  | "class_icon";

/** SQLite bound-parameter budget per statement; keep chunks comfortably below. */
const IN_CHUNK_SIZE = 50;

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.filter((key) => typeof key === "string" && key.length > 0))];
}

/** Builds the atomic delete/insert statement set used by media-bearing writes. */
export function buildReplaceMediaRefsStatements(
  db: D1Database,
  entityType: MediaRefEntityType,
  entityId: string,
  keys: readonly string[],
): D1PreparedStatement[] {
  const statements = [
    db.prepare(`DELETE FROM media_references WHERE entity_type = ? AND entity_id = ?`).bind(entityType, entityId),
  ];
  for (const key of uniqueKeys(keys)) {
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id) VALUES (?, ?, ?)`).bind(key, entityType, entityId),
    );
  }
  return statements;
}

/**
 * Replaces the full reference set for one entity (delete + inserts in a single
 * atomic D1 batch). Pass an empty array to clear all references.
 */
export async function replaceMediaRefs(db: D1Database, entityType: MediaRefEntityType, entityId: string, keys: readonly string[]): Promise<void> {
  await db.batch(buildReplaceMediaRefsStatements(db, entityType, entityId, keys));
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

/** Extracts only TipTap image-node sources, including the announcement image endpoint URL. */
export function extractAnnouncementImageNodeKeys(bodyJson: string | null | undefined, announcementId: string): string[] {
  if (!bodyJson) return [];
  const prefix = `announcement/${announcementId}/images/`;
  let document: unknown;
  try { document = JSON.parse(bodyJson) as unknown; } catch { return []; }
  const keys = new Set<string>();
  const extractSrc = (src: string): string | null => {
    if (src.startsWith(prefix)) return src;
    try {
      const url = new URL(src, "https://guild.invalid");
      const key = url.pathname === "/api/announcements/image" ? url.searchParams.get("key") : null;
      return key?.startsWith(prefix) ? key : null;
    } catch { return null; }
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: unknown; attrs?: { src?: unknown }; content?: unknown };
    if (node.type === "image" && typeof node.attrs?.src === "string") {
      const key = extractSrc(node.attrs.src);
      if (key) keys.add(key);
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(document);
  return [...keys];
}
