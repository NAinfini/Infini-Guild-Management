import { getMediaViewDimensions, MEDIA_CONTRACT, type Permission } from "@guild/shared";
import {
  buildMediaKey,
  createMediaId,
  isMediaId,
  mediaTypeForPurpose,
  mediaVariantContentType,
  requiredMediaVariants,
  type MediaEntityType,
  type MediaLinkSlot,
  type MediaPurpose,
  type MediaType,
  type MediaVariant,
} from "./media-keys";

const ANNOUNCEMENT_MANAGE_PERMISSIONS: readonly Permission[] = [
  "announcements.create",
  "announcements.edit",
  "announcements.archive",
  "announcements.delete",
];

const DELETE_PAGE_SIZE = 50;
const LINK_QUERY_CHUNK_SIZE = 50;
export const MEDIA_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export class MediaValidationError extends Error {
  override readonly name = "MediaValidationError";
}

export type ImageDimensions = { width: number; height: number };

export type ParsedImageMediaUpload = {
  full: ArrayBuffer;
  view: ArrayBuffer;
};

type CreateMediaBaseInput = {
  ownerUserId: string;
  expiresAt: string;
  now: string;
  maxBytes: number;
};

export type CreateMediaInput = CreateMediaBaseInput & (
  | {
      purpose: Exclude<MediaPurpose, "member_audio">;
      mediaType: "image";
      variants: { full: ArrayBuffer; view: ArrayBuffer };
    }
  | {
      purpose: "member_audio";
      originalName: string;
      mediaType: "audio";
      variants: { full: ArrayBuffer };
    }
);

export type MediaLinkInput = {
  mediaId: string;
  entityType: MediaEntityType;
  entityId: string;
  slot: MediaLinkSlot;
  sortOrder: number;
  now: string;
};

export type MediaSession = {
  id: string;
  permissions: ReadonlySet<Permission>;
};

export type ReadableMediaVariant = {
  r2Key: string;
  contentType: string;
};

export type LinkedMedia = {
  mediaId: string;
  entityId: string;
  slot: MediaLinkSlot;
  sortOrder: number;
  purpose: MediaPurpose;
  originalName: string | null;
};

type AssetRow = {
  id: string;
  owner_user_id: string | null;
  purpose: MediaPurpose;
  media_type: MediaType;
  state: "pending" | "ready";
  expires_at: string | null;
};

type VariantRow = {
  variant: MediaVariant;
  byte_size: number;
  width: number | null;
  height: number | null;
};

type LinkRow = {
  entity_type: MediaEntityType;
  entity_id: string;
  slot: MediaLinkSlot;
};

function normalizedIso(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new MediaValidationError(`${field} must be a valid date`);
  return new Date(timestamp).toISOString();
}

function assertMediaId(mediaId: string): void {
  if (!isMediaId(mediaId)) throw new MediaValidationError("Invalid media id");
}

function findMediaTarget(entityType: MediaEntityType, slot: MediaLinkSlot): { singular: boolean } | null {
  for (const definition of MEDIA_CONTRACT) {
    for (const target of definition.targets) {
      if (target.entityType === entityType && target.slot === slot) return target;
    }
  }
  return null;
}

function purposeAllowsLink(purpose: MediaPurpose, entityType: MediaEntityType, slot: MediaLinkSlot): boolean {
  const definition = MEDIA_CONTRACT.find((entry) => entry.purpose === purpose);
  return definition?.targets.some((target) => target.entityType === entityType && target.slot === slot) ?? false;
}

function assertLinkCoordinates(
  entityType: MediaEntityType,
  entityId: string,
  slot: MediaLinkSlot,
): { singular: boolean } {
  if (!entityId) throw new MediaValidationError("Media link entity id is required");
  const target = findMediaTarget(entityType, slot);
  if (!target) {
    throw new MediaValidationError(`Invalid media link target: ${entityType}/${slot}`);
  }
  return target;
}

function assertPurposeLink(purpose: MediaPurpose, entityType: MediaEntityType, slot: MediaLinkSlot): void {
  if (!purposeAllowsLink(purpose, entityType, slot)) {
    throw new MediaValidationError(`${purpose} media cannot attach to ${entityType}/${slot}`);
  }
}

function assertSortOrder(sortOrder: number): void {
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new MediaValidationError("Media sort order must be a non-negative integer");
  }
}

function normalizeAudioOriginalName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 255) {
    throw new MediaValidationError("Audio display name must be between 1 and 255 characters");
  }
  return normalized;
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function uint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

/** Reads the encoded canvas size and rejects animated or malformed WebP data. */
export function readWebPDimensions(buffer: ArrayBuffer): ImageDimensions {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 20 || fourCc(bytes, 0) !== "RIFF" || fourCc(bytes, 8) !== "WEBP") {
    throw new MediaValidationError("Image bytes must be WebP");
  }

  const view = new DataView(buffer);
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd > bytes.length || riffEnd < 20) throw new MediaValidationError("WebP data is truncated");

  let canvas: ImageDimensions | null = null;
  let encodedImage: ImageDimensions | null = null;
  let animated = false;

  for (let offset = 12; offset + 8 <= riffEnd;) {
    const kind = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > riffEnd) throw new MediaValidationError("WebP chunk is truncated");

    if (kind === "VP8X") {
      if (size < 10) throw new MediaValidationError("WebP VP8X header is truncated");
      animated ||= (bytes[start]! & 0x02) !== 0;
      canvas = { width: uint24(bytes, start + 4) + 1, height: uint24(bytes, start + 7) + 1 };
    } else if (kind === "VP8 ") {
      if (
        size < 10
        || bytes[start + 3] !== 0x9d
        || bytes[start + 4] !== 0x01
        || bytes[start + 5] !== 0x2a
      ) {
        throw new MediaValidationError("WebP VP8 frame header is invalid");
      }
      encodedImage = {
        width: view.getUint16(start + 6, true) & 0x3fff,
        height: view.getUint16(start + 8, true) & 0x3fff,
      };
    } else if (kind === "VP8L") {
      if (size < 5 || bytes[start] !== 0x2f) throw new MediaValidationError("WebP VP8L frame header is invalid");
      encodedImage = {
        width: 1 + (bytes[start + 1]! | ((bytes[start + 2]! & 0x3f) << 8)),
        height: 1 + (((bytes[start + 2]! & 0xc0) >> 6) | (bytes[start + 3]! << 2) | ((bytes[start + 4]! & 0x0f) << 10)),
      };
    } else if (kind === "ANIM" || kind === "ANMF") {
      animated = true;
    }

    offset = end + (size & 1);
  }

  if (animated) throw new MediaValidationError("Animated images must be uploaded as video");
  const dimensions = canvas ?? encodedImage;
  if (!dimensions || !encodedImage || dimensions.width < 1 || dimensions.height < 1) {
    throw new MediaValidationError("WebP dimensions are missing or invalid");
  }
  return dimensions;
}

function validateImageVariants(full: ArrayBuffer, view: ArrayBuffer): {
  full: ImageDimensions;
  view: ImageDimensions;
} {
  const fullDimensions = readWebPDimensions(full);
  const viewDimensions = readWebPDimensions(view);
  const expected = getMediaViewDimensions(fullDimensions.width, fullDimensions.height);
  if (viewDimensions.width !== expected.width || viewDimensions.height !== expected.height) {
    throw new MediaValidationError("View dimensions must exactly match the orientation-aware contain size");
  }

  return { full: fullDimensions, view: viewDimensions };
}

function validateOggOpus(buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 35 || fourCc(bytes, 0) !== "OggS") {
    throw new MediaValidationError("Audio bytes must be Ogg/Opus");
  }
  const payloadOffset = 27 + bytes[26]!;
  const opusHead = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64];
  if (payloadOffset + opusHead.length > bytes.length || !opusHead.every((byte, index) => bytes[payloadOffset + index] === byte)) {
    throw new MediaValidationError("Audio bytes must be Ogg/Opus");
  }
}

/** Parses the portal's aligned repeated full/view multipart contract. */
export async function parseImageMediaFormData(form: FormData): Promise<ParsedImageMediaUpload[]> {
  const fullEntries = form.getAll("full");
  const viewEntries = form.getAll("view");
  if (fullEntries.length === 0 || fullEntries.length !== viewEntries.length) {
    throw new MediaValidationError("full and view fields must be aligned");
  }
  if (
    fullEntries.some((entry) => !(entry instanceof File))
    || viewEntries.some((entry) => !(entry instanceof File))
  ) {
    throw new MediaValidationError("Invalid image multipart fields");
  }

  const parsed = await Promise.all(fullEntries.map(async (entry, index) => {
    const fullFile = entry as File;
    const viewFile = viewEntries[index] as File;
    if (fullFile.type !== "image/webp" || viewFile.type !== "image/webp") {
      throw new MediaValidationError("full and view files must be image/webp");
    }
    const [full, view] = await Promise.all([fullFile.arrayBuffer(), viewFile.arrayBuffer()]);
    return {
      full,
      view,
    };
  }));

  return parsed;
}

export function mediaPendingExpiry(nowValue: string): string {
  const now = normalizedIso(nowValue, "now");
  return new Date(Date.parse(now) + MEDIA_PENDING_TTL_MS).toISOString();
}

/** Extracts only canonical image-node URLs; no key or legacy URL parsing exists. */
export function extractRichTextMediaIds(bodyJson: string | null | undefined): string[] {
  if (!bodyJson) return [];
  let document: unknown;
  try {
    document = JSON.parse(bodyJson) as unknown;
  } catch {
    return [];
  }
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: unknown; attrs?: { src?: unknown }; content?: unknown };
    if (node.type === "image" && typeof node.attrs?.src === "string") {
      const match = /^\/api\/media\/([A-Za-z0-9_-]{21})\/view$/.exec(node.attrs.src);
      if (match) ids.add(match[1]!);
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(document);
  return [...ids];
}

function variantMetadata(input: CreateMediaInput): Array<VariantRow & { data: ArrayBuffer }> {
  if (!Number.isInteger(input.maxBytes) || input.maxBytes < 1) {
    throw new MediaValidationError("Media byte limit must be a positive integer");
  }
  if (mediaTypeForPurpose(input.purpose) !== input.mediaType) {
    throw new MediaValidationError(`${input.purpose} requires ${mediaTypeForPurpose(input.purpose)} media`);
  }

  if (input.mediaType === "image") {
    if (!("view" in input.variants)) throw new MediaValidationError("Image media requires full and view variants");
    const imageVariants = input.variants as { full: ArrayBuffer; view: ArrayBuffer };
    if (imageVariants.full.byteLength > input.maxBytes || imageVariants.view.byteLength > input.maxBytes) {
      throw new MediaValidationError(`${input.purpose} variants must each be at most ${input.maxBytes} bytes`);
    }
    const dimensions = validateImageVariants(imageVariants.full, imageVariants.view);
    return (["full", "view"] as const).map((variant) => ({
      variant,
      byte_size: imageVariants[variant].byteLength,
      width: dimensions[variant].width,
      height: dimensions[variant].height,
      data: imageVariants[variant],
    }));
  }

  if ("view" in input.variants) throw new MediaValidationError("Audio media has only the full variant");
  if (input.variants.full.byteLength > input.maxBytes) {
    throw new MediaValidationError(`${input.purpose} full variant must be at most ${input.maxBytes} bytes`);
  }
  validateOggOpus(input.variants.full);
  return [{
    variant: "full",
    byte_size: input.variants.full.byteLength,
    width: null,
    height: null,
    data: input.variants.full,
  }];
}

function validateStoredVariants(asset: Pick<AssetRow, "id" | "media_type">, rows: readonly VariantRow[]): void {
  const expected = requiredMediaVariants(asset.media_type);
  if (rows.length !== expected.length || new Set(rows.map((row) => row.variant)).size !== expected.length) {
    throw new MediaValidationError(`Media ${asset.id} does not have its mandatory variants`);
  }
  const byVariant = new Map(rows.map((row) => [row.variant, row]));
  for (const variant of expected) {
    const row = byVariant.get(variant);
    if (
      !row
      || !Number.isInteger(row.byte_size)
      || row.byte_size < 1
    ) {
      throw new MediaValidationError(`Media ${asset.id}/${variant} metadata is invalid`);
    }
  }

  if (asset.media_type === "audio") {
    const full = byVariant.get("full")!;
    if (full.width !== null || full.height !== null) throw new MediaValidationError("Audio variants cannot have dimensions");
    return;
  }

  const full = byVariant.get("full")!;
  const view = byVariant.get("view")!;
  if (!full.width || !full.height || !view.width || !view.height) {
    throw new MediaValidationError("Image variant dimensions are required");
  }
  const expectedDimensions = getMediaViewDimensions(full.width, full.height);
  if (
    view.width !== expectedDimensions.width
    || view.height !== expectedDimensions.height
  ) {
    throw new MediaValidationError("Stored image variant dimensions are invalid");
  }
}

export class MediaService {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
  ) {}

  async create(input: CreateMediaInput): Promise<{ id: string }> {
    if (!input.ownerUserId) throw new MediaValidationError("Media owner is required");
    const now = normalizedIso(input.now, "now");
    const expiresAt = normalizedIso(input.expiresAt, "expiresAt");
    if (expiresAt <= now) throw new MediaValidationError("Media expiry must be in the future");
    const originalName = input.mediaType === "audio"
      ? normalizeAudioOriginalName(input.originalName)
      : null;

    // This validates every variant before the first R2 write.
    const variants = variantMetadata(input);
    const id = createMediaId();

    await this.db.batch([
      this.db.prepare(`
        INSERT INTO media_assets
          (id, owner_user_id, purpose, original_name, media_type, state, expires_at)
        VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)
      `).bind(
        id,
        input.ownerUserId,
        input.purpose,
        originalName,
        input.mediaType,
        expiresAt,
      ),
      ...variants.map((variant) => this.db.prepare(`
        INSERT INTO media_variants
          (media_id, variant, byte_size, width, height)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(
        id,
        variant.variant,
        variant.byte_size,
        variant.width,
        variant.height,
      )),
    ]);

    try {
      for (const variant of variants) {
        await this.bucket.put(buildMediaKey(id, variant.variant, input.mediaType), variant.data, {
          httpMetadata: { contentType: mediaVariantContentType(input.mediaType) },
        });
      }
    } catch (uploadError) {
      const keys = variants.map((variant) => buildMediaKey(id, variant.variant, input.mediaType));
      try {
        await this.bucket.delete(keys);
      } catch (cleanupError) {
        throw new AggregateError(
          [uploadError, cleanupError],
          `Media ${id} upload and R2 compensation both failed; pending D1 metadata was retained for cleanup`,
        );
      }
      try {
        await this.db.prepare("DELETE FROM media_assets WHERE id = ?1 AND state = 'pending'").bind(id).run();
      } catch (metadataCleanupError) {
        throw new AggregateError(
          [uploadError, metadataCleanupError],
          `Media ${id} upload failed and its compensated D1 metadata could not be removed`,
        );
      }
      throw uploadError;
    }

    return { id };
  }

  async createImages(input: {
    ownerUserId: string;
    purpose: Exclude<MediaPurpose, "member_audio">;
    uploads: readonly ParsedImageMediaUpload[];
    now: string;
    maxBytes: number;
    expiresAt?: string;
  }): Promise<{ expiresAt: string; mediaIds: string[] }> {
    const expiresAt = input.expiresAt ?? mediaPendingExpiry(input.now);
    const mediaIds: string[] = [];
    try {
      for (const upload of input.uploads) {
        const created = await this.create({
          ownerUserId: input.ownerUserId,
          purpose: input.purpose,
          mediaType: "image",
          expiresAt,
          now: input.now,
          maxBytes: input.maxBytes,
          variants: { full: upload.full, view: upload.view },
        });
        mediaIds.push(created.id);
      }
    } catch (error) {
      if (mediaIds.length > 0) {
        try {
          await this.deleteAssets(mediaIds);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Image batch creation and exact media compensation both failed",
          );
        }
      }
      throw error;
    }
    return { expiresAt: normalizedIso(expiresAt, "expiresAt"), mediaIds };
  }

  async createAudio(input: {
    ownerUserId: string;
    originalName: string;
    data: ArrayBuffer;
    now: string;
    maxBytes: number;
    expiresAt?: string;
  }): Promise<{ expiresAt: string; mediaId: string }> {
    const expiresAt = input.expiresAt ?? mediaPendingExpiry(input.now);
    const created = await this.create({
      ownerUserId: input.ownerUserId,
      purpose: "member_audio",
      originalName: input.originalName,
      mediaType: "audio",
      expiresAt,
      now: input.now,
      maxBytes: input.maxBytes,
      variants: { full: input.data },
    });
    return { expiresAt: normalizedIso(expiresAt, "expiresAt"), mediaId: created.id };
  }

  async markReady(mediaId: string, nowValue: string, ownerUserId?: string): Promise<void> {
    assertMediaId(mediaId);
    const now = normalizedIso(nowValue, "now");
    const asset = await this.db.prepare(`
      SELECT id, owner_user_id, purpose, media_type, state, expires_at
      FROM media_assets
      WHERE id = ?1
    `).bind(mediaId).first<AssetRow>();
    if (!asset) throw new MediaValidationError("Media asset not found");
    if (asset.state !== "pending") throw new MediaValidationError("Only pending media can be marked ready");
    if (ownerUserId !== undefined && asset.owner_user_id !== ownerUserId) {
      throw new MediaValidationError("Pending media belongs to another user");
    }
    if (!asset.expires_at || asset.expires_at <= now) throw new MediaValidationError("Pending media has expired");

    const variants = await this.db.prepare(`
      SELECT variant, byte_size, width, height
      FROM media_variants
      WHERE media_id = ?1
      ORDER BY variant
    `).bind(mediaId).all<VariantRow>();
    validateStoredVariants(asset, variants.results ?? []);

    const result = await this.db.prepare(`
      UPDATE media_assets
      SET state = 'ready'
      WHERE id = ?1 AND state = 'pending' AND expires_at > ?2
    `).bind(mediaId, now).run();
    if ((result.meta.changes ?? 0) !== 1) throw new MediaValidationError("Media state changed before it became ready");
  }

  async attach(input: MediaLinkInput): Promise<void> {
    const asset = await this.requireAttachable(input.mediaId, input.entityType, input.entityId, input.slot, input.sortOrder, input.now);
    assertPurposeLink(asset.purpose, input.entityType, input.slot);
    await this.db.prepare(`
      INSERT INTO media_links (media_id, entity_type, entity_id, slot, sort_order)
      VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (media_id, entity_type, entity_id, slot)
      DO UPDATE SET sort_order = excluded.sort_order
    `).bind(input.mediaId, input.entityType, input.entityId, input.slot, input.sortOrder).run();
  }

  async replace(input: {
    entityType: MediaEntityType;
    entityId: string;
    slot: MediaLinkSlot;
    media: ReadonlyArray<{ mediaId: string; sortOrder: number }>;
    now: string;
    ownerUserId?: string;
  }): Promise<void> {
    const target = assertLinkCoordinates(input.entityType, input.entityId, input.slot);
    const now = normalizedIso(input.now, "now");
    const ids = input.media.map((item) => item.mediaId);
    if (new Set(ids).size !== ids.length) throw new MediaValidationError("Replacement media ids must be unique");
    input.media.forEach((item) => {
      assertMediaId(item.mediaId);
      assertSortOrder(item.sortOrder);
    });
    if (new Set(input.media.map((item) => item.sortOrder)).size !== input.media.length) {
      throw new MediaValidationError("Replacement sort orders must be unique");
    }
    if (target.singular && input.media.length > 1) {
      throw new MediaValidationError(`${input.slot} accepts only one media asset`);
    }

    const existing = await this.db.prepare(`
      SELECT media_id
      FROM media_links
      WHERE entity_type = ?1 AND entity_id = ?2 AND slot = ?3
    `).bind(input.entityType, input.entityId, input.slot).all<{ media_id: string }>();
    const oldIds = [...new Set((existing.results ?? []).map((row) => row.media_id))];
    const oldIdSet = new Set(oldIds);

    if (ids.length > 0) {
      const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ");
      const rows = await this.db.prepare(`
        SELECT id, owner_user_id, purpose, media_type, state, expires_at
        FROM media_assets
        WHERE id IN (${placeholders})
      `).bind(...ids).all<AssetRow>();
      const assets = new Map((rows.results ?? []).map((row) => [row.id, row]));
      for (const id of ids) {
        const asset = assets.get(id);
        if (!asset || (asset.expires_at !== null && asset.expires_at <= now)) {
          throw new MediaValidationError(`Media ${id} is not attachable`);
        }
        if (input.ownerUserId !== undefined && !oldIdSet.has(id) && asset.owner_user_id !== input.ownerUserId) {
          throw new MediaValidationError(`Media ${id} belongs to another user`);
        }
        if (asset.state === "pending") {
          if (!input.ownerUserId) throw new MediaValidationError("Pending media owner is required");
          await this.markReady(id, now, input.ownerUserId);
        }
        assertPurposeLink(asset.purpose, input.entityType, input.slot);
      }
    }

    await this.db.batch([
      this.db.prepare(`
        DELETE FROM media_links
        WHERE entity_type = ?1 AND entity_id = ?2 AND slot = ?3
      `).bind(input.entityType, input.entityId, input.slot),
      ...input.media.map((item) => this.db.prepare(`
        INSERT INTO media_links (media_id, entity_type, entity_id, slot, sort_order)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(item.mediaId, input.entityType, input.entityId, input.slot, item.sortOrder)),
    ]);
  }

  async detach(input: Omit<MediaLinkInput, "sortOrder">): Promise<void> {
    assertMediaId(input.mediaId);
    assertLinkCoordinates(input.entityType, input.entityId, input.slot);
    normalizedIso(input.now, "now");
    await this.db.prepare(`
      DELETE FROM media_links
      WHERE media_id = ?1 AND entity_type = ?2 AND entity_id = ?3 AND slot = ?4
    `).bind(input.mediaId, input.entityType, input.entityId, input.slot).run();
  }

  async checkQuota(input: {
    purpose: MediaPurpose;
    ownerUserId: string;
    scope:
      | { kind: "owner" }
      | { kind: "pending" }
      | { kind: "entity"; entityType: MediaEntityType; entityId: string };
    limit: number;
    incomingCount: number;
    now: string;
  }): Promise<boolean> {
    if (!input.ownerUserId) throw new MediaValidationError("Media owner is required");
    if (!Number.isInteger(input.limit) || input.limit < 0 || !Number.isInteger(input.incomingCount) || input.incomingCount < 0) {
      throw new MediaValidationError("Media quota values must be non-negative integers");
    }
    const now = normalizedIso(input.now, "now");

    const row = input.scope.kind === "entity"
      ? await this.db.prepare(`
          SELECT COUNT(*) AS used
          FROM (
            SELECT asset.id
            FROM media_links link
            INNER JOIN media_assets asset ON asset.id = link.media_id
            WHERE link.entity_type = ?1 AND link.entity_id = ?2 AND asset.purpose = ?3
            UNION
            SELECT asset.id
            FROM media_assets asset
            WHERE asset.owner_user_id = ?4
              AND asset.purpose = ?3
              AND asset.state = 'pending'
              AND asset.expires_at > ?5
          )
        `).bind(input.scope.entityType, input.scope.entityId, input.purpose, input.ownerUserId, now).first<{ used: number }>()
      : input.scope.kind === "pending"
        ? await this.db.prepare(`
          SELECT COUNT(*) AS used
          FROM media_assets asset
          WHERE asset.owner_user_id = ?1
            AND asset.purpose = ?2
            AND asset.state = 'pending'
            AND asset.expires_at > ?3
        `).bind(input.ownerUserId, input.purpose, now).first<{ used: number }>()
        : await this.db.prepare(`
          SELECT COUNT(*) AS used
          FROM media_assets asset
          WHERE asset.owner_user_id = ?1
            AND asset.purpose = ?2
            AND (
              (asset.state = 'ready' AND EXISTS (SELECT 1 FROM media_links link WHERE link.media_id = asset.id))
              OR (asset.state = 'pending' AND asset.expires_at > ?3)
            )
        `).bind(input.ownerUserId, input.purpose, now).first<{ used: number }>();
    return Number(row?.used ?? 0) + input.incomingCount <= input.limit;
  }

  async listLinkedMedia(
    entityType: MediaEntityType,
    entityIds: readonly string[],
    slots?: readonly MediaLinkSlot[],
  ): Promise<Map<string, LinkedMedia[]>> {
    const ids = [...new Set(entityIds.filter(Boolean))];
    const result = new Map<string, LinkedMedia[]>();
    if (ids.length === 0) return result;
    for (let index = 0; index < ids.length; index += LINK_QUERY_CHUNK_SIZE) {
      const chunk = ids.slice(index, index + LINK_QUERY_CHUNK_SIZE);
      const idPlaceholders = chunk.map(() => "?").join(", ");
      const slotValues = slots ? [...new Set(slots)] : [];
      const slotClause = slotValues.length > 0
        ? ` AND link.slot IN (${slotValues.map(() => "?").join(", ")})`
        : "";
      const rows = await this.db.prepare(`
        SELECT
          link.entity_id,
          link.media_id,
          link.slot,
          link.sort_order,
          asset.purpose,
          asset.original_name
        FROM media_links link
        INNER JOIN media_assets asset ON asset.id = link.media_id
        WHERE link.entity_type = ?
          AND link.entity_id IN (${idPlaceholders})${slotClause}
        ORDER BY link.entity_id, link.slot, link.sort_order, link.media_id
      `).bind(entityType, ...chunk, ...slotValues).all<{
        entity_id: string;
        media_id: string;
        slot: MediaLinkSlot;
        sort_order: number;
        purpose: MediaPurpose;
        original_name: string | null;
      }>();
      for (const row of rows.results ?? []) {
        const media = result.get(row.entity_id) ?? [];
        media.push({
          mediaId: row.media_id,
          entityId: row.entity_id,
          slot: row.slot,
          sortOrder: row.sort_order,
          purpose: row.purpose,
          originalName: row.original_name,
        });
        result.set(row.entity_id, media);
      }
    }
    return result;
  }

  async listLinkedMediaIds(
    entityType: MediaEntityType,
    entityId: string,
    slot: MediaLinkSlot,
  ): Promise<string[]> {
    const links = await this.listLinkedMedia(entityType, [entityId], [slot]);
    return (links.get(entityId) ?? []).map((link) => link.mediaId);
  }

  async resolveReadableVariant(input: {
    mediaId: string;
    variant: MediaVariant;
    session: MediaSession | null;
    now: string;
  }): Promise<ReadableMediaVariant | null> {
    if (!isMediaId(input.mediaId)) return null;
    const now = normalizedIso(input.now, "now");
    const row = await this.db.prepare(`
      SELECT
        asset.id,
        asset.owner_user_id,
        asset.purpose,
        asset.media_type,
        asset.state,
        asset.expires_at,
        variant.variant
      FROM media_assets asset
      INNER JOIN media_variants variant ON variant.media_id = asset.id
      WHERE asset.id = ?1 AND variant.variant = ?2
    `).bind(input.mediaId, input.variant).first<AssetRow & Pick<VariantRow, "variant">>();
    if (!row) return null;

    const readable = {
      r2Key: buildMediaKey(row.id, row.variant, row.media_type),
      contentType: mediaVariantContentType(row.media_type),
    };
    if (row.state === "pending") {
      return input.session?.id === row.owner_user_id && row.expires_at !== null && row.expires_at > now
        ? readable
        : null;
    }

    const links = await this.db.prepare(`
      SELECT entity_type, entity_id, slot
      FROM media_links
      WHERE media_id = ?1
    `).bind(input.mediaId).all<LinkRow>();
    for (const link of links.results ?? []) {
      if (await this.isLinkReadable(row.purpose, link, input.session, now)) return readable;
    }
    return null;
  }

  async deleteUnclaimed(nowValue: string): Promise<number> {
    const now = normalizedIso(nowValue, "now");
    let deleted = 0;
    while (true) {
      const page = await this.db.prepare(`
        SELECT id, media_type
        FROM media_assets asset
        WHERE asset.expires_at <= ?1
          AND NOT EXISTS (SELECT 1 FROM media_links link WHERE link.media_id = asset.id)
        ORDER BY asset.expires_at, asset.id
        LIMIT ?2
      `).bind(now, DELETE_PAGE_SIZE).all<{ id: string; media_type: MediaType }>();
      const assets = page.results ?? [];
      if (assets.length === 0) return deleted;

      const keys = this.deriveVariantKeys(assets);
      await this.bucket.delete(keys);
      const results = await this.db.batch(assets.map((asset) => this.db.prepare(`
        DELETE FROM media_assets
        WHERE id = ?1
          AND expires_at <= ?2
          AND NOT EXISTS (SELECT 1 FROM media_links WHERE media_id = ?1)
      `).bind(asset.id, now)));
      const changes = results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
      deleted += changes;
      if (changes === 0) return deleted;
    }
  }

  /** Deletes explicitly registered assets without listing R2 or deriving ownership from object keys. */
  async deleteAssets(mediaIds: readonly string[]): Promise<number> {
    const ids = [...new Set(mediaIds)];
    ids.forEach(assertMediaId);
    let deleted = 0;
    for (let index = 0; index < ids.length; index += LINK_QUERY_CHUNK_SIZE) {
      const chunk = ids.slice(index, index + LINK_QUERY_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const assets = await this.db.prepare(`
        SELECT id, media_type
        FROM media_assets
        WHERE id IN (${placeholders})
        ORDER BY id
      `).bind(...chunk).all<{ id: string; media_type: MediaType }>();
      const keys = this.deriveVariantKeys(assets.results ?? []);
      if (keys.length > 0) await this.bucket.delete(keys);
      const results = await this.db.batch(chunk.map((id) => this.db.prepare(
        "DELETE FROM media_assets WHERE id = ?1",
      ).bind(id)));
      deleted += results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
    }
    return deleted;
  }

  private deriveVariantKeys(
    assets: ReadonlyArray<{ id: string; media_type: MediaType }>,
  ): string[] {
    return assets.flatMap((asset) => requiredMediaVariants(asset.media_type)
      .map((variant) => buildMediaKey(asset.id, variant, asset.media_type)));
  }

  private async requireAttachable(
    mediaId: string,
    entityType: MediaEntityType,
    entityId: string,
    slot: MediaLinkSlot,
    sortOrder: number,
    nowValue: string,
  ): Promise<AssetRow> {
    assertMediaId(mediaId);
    const target = assertLinkCoordinates(entityType, entityId, slot);
    assertSortOrder(sortOrder);
    if (target.singular && sortOrder !== 0) throw new MediaValidationError(`${slot} sort order must be zero`);
    const now = normalizedIso(nowValue, "now");
    const asset = await this.db.prepare(`
      SELECT id, owner_user_id, purpose, media_type, state, expires_at
      FROM media_assets
      WHERE id = ?1
    `).bind(mediaId).first<AssetRow>();
    if (!asset || asset.state !== "ready" || (asset.expires_at !== null && asset.expires_at <= now)) {
      throw new MediaValidationError("Media is not attachable");
    }
    return asset;
  }

  private async exists(sql: string, ...bindings: unknown[]): Promise<boolean> {
    return Boolean(await this.db.prepare(sql).bind(...bindings).first<{ present: number }>());
  }

  private async isLinkReadable(
    purpose: MediaPurpose,
    link: LinkRow,
    session: MediaSession | null,
    now: string,
  ): Promise<boolean> {
    if (!purposeAllowsLink(purpose, link.entity_type, link.slot)) return false;
    switch (link.entity_type) {
      case "site_config":
        return this.exists("SELECT 1 AS present FROM site_config WHERE id = ?1", link.entity_id);
      case "class_catalog":
        return this.exists("SELECT 1 AS present FROM class_catalog WHERE id = ?1", link.entity_id);
      case "member_profile":
        return this.exists(`
          SELECT 1 AS present
          FROM member_profiles profile
          INNER JOIN users user ON user.id = profile.user_id
          WHERE profile.user_id = ?1
            AND user.deleted_at IS NULL
            AND (user.is_active = 1 OR ?2 = 1)
        `, link.entity_id, session?.permissions.has("admin.users.view") === true ? 1 : 0);
      case "gallery_item":
        return this.exists(
          "SELECT 1 AS present FROM gallery_items WHERE id = ?1 AND type = 'image'",
          link.entity_id,
        );
      case "wiki_article":
        return this.exists("SELECT 1 AS present FROM wiki_articles WHERE id = ?1", link.entity_id);
      case "announcement": {
        const canManage = session !== null
          && ANNOUNCEMENT_MANAGE_PERMISSIONS.some((permission) => session.permissions.has(permission));
        return this.exists(`
          SELECT 1 AS present
          FROM announcements
          WHERE id = ?1 AND (?2 = 1 OR status IN ('published', 'archived'))
        `, link.entity_id, canManage ? 1 : 0);
      }
      case "event":
        return this.exists(`
          SELECT 1 AS present
          FROM events
          WHERE id = ?1 AND (
            ?2 = 1
            OR visible_at IS NULL
            OR (julianday(visible_at) IS NOT NULL AND julianday(visible_at) <= julianday(?3))
          )
        `, link.entity_id, session?.permissions.has("events.edit") === true ? 1 : 0, now);
      case "recurring_template":
        return session?.permissions.has("events.templates") === true
          && this.exists("SELECT 1 AS present FROM recurring_templates WHERE id = ?1", link.entity_id);
      case "storage_item":
        return session !== null && this.exists("SELECT 1 AS present FROM storage_items WHERE id = ?1", link.entity_id);
    }
  }
}
