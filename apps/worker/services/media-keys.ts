const CONTENT_TYPE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
} as const;

type StoredContentType = keyof typeof CONTENT_TYPE_EXTENSIONS;
type MediaKeyKind =
  | "member_image"
  | "member_audio"
  | "site_logo"
  | "class_icon"
  | "gallery_image"
  | "event_image"
  | "announcement_image"
  | "wiki_image"
  | "storage_item_image";

export type ParsedMediaKey = {
  kind: MediaKeyKind;
  entityId: string | null;
  contentType: StoredContentType | null;
};

export const AUDIT_ARCHIVE_PREFIX = "audit-archive/";

const EXTENSION_CONTENT_TYPES = new Map<string, StoredContentType>(
  Object.entries(CONTENT_TYPE_EXTENSIONS).map(([contentType, extension]) => [extension, contentType as StoredContentType]),
);

function encodedEntityId(entityId: string): string {
  if (!entityId || entityId.includes("/")) return encodeURIComponent(entityId);
  return encodeURIComponent(entityId);
}

function safeObjectId(objectId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(objectId)) throw new Error("Media object id must be a UUID or nanoid");
  return objectId;
}

export function extensionForContentType(contentType: string): string {
  const extension = CONTENT_TYPE_EXTENSIONS[contentType as StoredContentType];
  if (!extension) throw new Error(`Unsupported stored media type: ${contentType}`);
  return extension;
}

function buildKey(prefix: string, contentType: string, objectId: string = crypto.randomUUID()): string {
  return `${prefix}/${safeObjectId(objectId)}.${extensionForContentType(contentType)}`;
}

export function buildMemberImageKey(userId: string, contentType: string, objectId?: string): string {
  return buildKey(`members/${encodedEntityId(userId)}/images`, contentType, objectId);
}

export function buildMemberAudioKey(userId: string, contentType: string, objectId?: string): string {
  return buildKey(`members/${encodedEntityId(userId)}/audio`, contentType, objectId);
}

export function buildSiteLogoKey(contentType: string, objectId?: string): string {
  return buildKey("site/logo", contentType, objectId);
}

export function buildClassIconKey(classId: string, contentType: string, objectId?: string): string {
  return buildKey(`class-icons/${encodedEntityId(classId)}`, contentType, objectId);
}

export function buildGalleryUserPrefix(userId: string): string {
  return `gallery/users/${encodedEntityId(userId)}/items/`;
}

export function buildGalleryImageKey(userId: string, itemId: string, contentType: string, objectId?: string): string {
  return buildKey(`${buildGalleryUserPrefix(userId)}${encodedEntityId(itemId)}/images`, contentType, objectId);
}

export function buildEventImageKey(eventId: string, contentType: string, objectId?: string): string {
  return buildKey(`events/${encodedEntityId(eventId)}/images`, contentType, objectId);
}

export function buildAnnouncementImageKey(announcementId: string, contentType: string, objectId?: string): string {
  return buildKey(`announcement/${encodedEntityId(announcementId)}/images`, contentType, objectId);
}

export function buildWikiImageKey(articleId: string, contentType: string, objectId?: string): string {
  return buildKey(`wiki/${encodedEntityId(articleId)}/images`, contentType, objectId);
}

export function buildStorageItemImageKey(itemId: string, contentType: string, objectId?: string): string {
  return buildKey(`storage/items/${encodedEntityId(itemId)}`, contentType, objectId);
}

function decodedSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded
      && decoded !== "."
      && decoded !== ".."
      && !decoded.includes("\\")
      && !/[\u0000-\u001f]/.test(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

function parseLeaf(leaf: string): StoredContentType | null | undefined {
  const match = /^([A-Za-z0-9_-]+)\.([a-z0-9]+)$/.exec(leaf);
  if (!match) return undefined;
  return EXTENSION_CONTENT_TYPES.get(match[2]!) ?? null;
}

export function parseMediaKey(key: string): ParsedMediaKey | null {
  const galleryMatch = /^gallery\/users\/([^/]+)\/items\/([^/]+)\/images\/([^/]+)$/.exec(key);
  if (galleryMatch) {
    const userId = decodedSegment(galleryMatch[1]!);
    const entityId = decodedSegment(galleryMatch[2]!);
    const contentType = parseLeaf(galleryMatch[3]!);
    if (!userId || !entityId || contentType === undefined) return null;
    return { kind: "gallery_image", entityId, contentType };
  }

  const patterns: Array<{ regex: RegExp; kind: MediaKeyKind; entityIndex: number | null; leafIndex: number }> = [
    { regex: /^members\/([^/]+)\/images\/([^/]+)$/, kind: "member_image", entityIndex: 1, leafIndex: 2 },
    { regex: /^members\/([^/]+)\/audio\/([^/]+)$/, kind: "member_audio", entityIndex: 1, leafIndex: 2 },
    { regex: /^site\/logo\/([^/]+)$/, kind: "site_logo", entityIndex: null, leafIndex: 1 },
    { regex: /^class-icons\/([^/]+)\/([^/]+)$/, kind: "class_icon", entityIndex: 1, leafIndex: 2 },
    { regex: /^events\/([^/]+)\/images\/([^/]+)$/, kind: "event_image", entityIndex: 1, leafIndex: 2 },
    { regex: /^announcement\/([^/]+)\/images\/([^/]+)$/, kind: "announcement_image", entityIndex: 1, leafIndex: 2 },
    { regex: /^wiki\/([^/]+)\/images\/([^/]+)$/, kind: "wiki_image", entityIndex: 1, leafIndex: 2 },
    { regex: /^storage\/items\/([^/]+)\/([^/]+)$/, kind: "storage_item_image", entityIndex: 1, leafIndex: 2 },
  ];

  for (const pattern of patterns) {
    const match = pattern.regex.exec(key);
    if (!match) continue;
    const contentType = parseLeaf(match[pattern.leafIndex]!);
    if (contentType === undefined) return null;
    const entityId = pattern.entityIndex === null ? null : decodedSegment(match[pattern.entityIndex]!);
    if (pattern.entityIndex !== null && !entityId) return null;
    return { kind: pattern.kind, entityId, contentType };
  }
  return null;
}

/**
 * R2 contains both user-facing content and audit archives. Content cleanup
 * must only remove keys produced by this module; audit objects are owned by
 * the archive service and must never be swept through a content path.
 */
export function assertContentMediaKey(key: string): ParsedMediaKey {
  if (key.startsWith(AUDIT_ARCHIVE_PREFIX)) {
    throw new Error(`Refusing audit archive key through content media path: ${key}`);
  }
  const parsed = parseMediaKey(key);
  if (!parsed?.contentType) {
    throw new Error(`Refusing unrecognized content media key: ${key}`);
  }
  return parsed;
}

/** Backwards-compatible name for callers that only delete content objects. */
export const assertDeletableContentMediaKey = assertContentMediaKey;

export function mediaKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://guild.invalid");
    return parsed.searchParams.get("key");
  } catch {
    return null;
  }
}
