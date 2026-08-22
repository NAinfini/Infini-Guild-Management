import { MEDIA_CONTRACT, type MediaEntityType, type MediaPurpose, type MediaVariant } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { AppError, type BlobMetadata, type BlobRange, type BlobStore, type RequestContext, type ScheduledJobBacklog } from "@guild/kernel";
import { nanoid } from "nanoid";
import type { AuditEventWrite } from "../audit/public.js";
import { validateImagePair, validateOggOpus } from "./media-validation";

const STAGED_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_GC_BATCH = 50;

export type MediaVariantReservation = Readonly<{
  variant: MediaVariant;
  objectKey: string;
  contentType: "image/webp" | "audio/ogg";
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
}>;

export type MediaReservation = Readonly<{
  id: string;
  ownerUserId: string;
  purpose: MediaPurpose;
  mediaType: "image" | "audio";
  originalName: string | null;
  expiresAt: string;
  createdAt: string;
  variants: readonly MediaVariantReservation[];
}>;

export type MediaReadFacts = Readonly<{
  objectKey: string;
  byteSize: number;
  contentType: "image/webp" | "audio/ogg";
  sha256: string;
  ownerUserId: string | null;
  entityTypes: readonly MediaEntityType[];
  audience: "public" | "authenticated" | "private";
}>;

export type MediaReadResult = Readonly<{
  object: NonNullable<Awaited<ReturnType<BlobStore["get"]>>>;
  audience: MediaReadFacts["audience"];
}>;

export type MediaHeadResult = Readonly<{
  metadata: BlobMetadata;
  audience: MediaReadFacts["audience"];
}>;

export type MediaRangeRequest =
  | Readonly<{ kind: "closed"; offset: number; length: number }>
  | Readonly<{ kind: "open"; offset: number }>
  | Readonly<{ kind: "suffix"; length: number }>;

export class MediaRangeError extends RangeError {
  constructor(readonly total: number) {
    super("Requested byte range is not satisfiable");
    this.name = "MediaRangeError";
  }
}

export type ClaimedMediaDeletion = Readonly<{
  mediaId: string;
  claimToken: string;
  objectKeys: readonly string[];
}>;

export type MediaGarbageCollectionAuditFactory = (mediaId: string) => AuditEventWrite;

export interface MediaStore {
  reserveUploads(inputs: readonly MediaReservation[]): Promise<void>;
  markStaged(mediaIds: readonly string[], stagedAt: string): Promise<void>;
  markDeleting(mediaIds: readonly string[], at: string): Promise<void>;
  describeRead(mediaId: string, variant: MediaVariant, now: string): Promise<MediaReadFacts | null>;
  claimGarbage(before: string, limit: number): Promise<readonly ClaimedMediaDeletion[]>;
  inspectGarbageBacklog(before: string): Promise<ScheduledJobBacklog>;
  finalizeDeletion(mediaId: string, claimToken: string, audit: AuditEventWrite): Promise<void>;
}

export type ImageUpload = Readonly<{ full: Uint8Array; view: Uint8Array }>;
export type AudioUpload = Readonly<{ full: Uint8Array; originalName: string }>;

type PendingUpload = Readonly<{
  reservation: MediaReservation;
  data: ReadonlyMap<MediaVariant, Uint8Array>;
}>;

export class MediaService {
  constructor(
    private readonly store: MediaStore,
    private readonly blobs: BlobStore,
  ) {}

  async uploadImages(
    context: RequestContext,
    purpose: Exclude<MediaPurpose, "member_audio">,
    uploads: readonly ImageUpload[],
    maxBytes: number,
  ): Promise<readonly string[]> {
    const actor = context.authorization.requireAuthenticated();
    if (uploads.length < 1 || uploads.length > 50) throw validation("Image upload count must be between 1 and 50");

    const pending: PendingUpload[] = [];
    for (const upload of uploads) {
      const dimensions = validateImagePair(upload.full, upload.view, maxBytes);
      const mediaId = nanoid();
      const variants: MediaVariantReservation[] = [];
      for (const [variant, bytes, size] of ([
        ["full", upload.full, dimensions.full],
        ["view", upload.view, dimensions.view],
      ] as const)) {
        variants.push({
          variant,
          objectKey: `media/${mediaId}/${variant}.webp`,
          contentType: "image/webp",
          byteSize: bytes.byteLength,
          sha256: await sha256(bytes),
          width: size.width,
          height: size.height,
        });
      }
      pending.push({
        reservation: {
          id: mediaId,
          ownerUserId: actor.userId,
          purpose,
          mediaType: "image",
          originalName: null,
          expiresAt: new Date(Date.parse(context.now) + STAGED_TTL_MS).toISOString(),
          createdAt: context.now,
          variants,
        },
        data: new Map<MediaVariant, Uint8Array>([["full", upload.full], ["view", upload.view]]),
      });
    }
    await this.persistUploads(context, pending);
    return pending.map(({ reservation }) => reservation.id);
  }

  async uploadAudio(
    context: RequestContext,
    upload: AudioUpload,
    maxBytes: number,
  ): Promise<string> {
    const actor = context.authorization.requireAuthenticated();
    const originalName = upload.originalName.trim();
    if (!originalName || originalName.length > 255) throw validation("Audio name must be between 1 and 255 characters");
    validateOggOpus(upload.full, maxBytes);
    const mediaId = nanoid();
    const digest = await sha256(upload.full);
    await this.persistUploads(context, [{
      reservation: {
        id: mediaId,
        ownerUserId: actor.userId,
        purpose: "member_audio",
        mediaType: "audio",
        originalName,
        expiresAt: new Date(Date.parse(context.now) + STAGED_TTL_MS).toISOString(),
        createdAt: context.now,
        variants: [{
          variant: "full",
          objectKey: `media/${mediaId}/full.opus`,
          contentType: "audio/ogg",
          byteSize: upload.full.byteLength,
          sha256: digest,
          width: null,
          height: null,
        }],
      },
      data: new Map([["full", upload.full]]),
    }]);
    return mediaId;
  }

  async read(
    context: RequestContext,
    mediaId: string,
    variant: MediaVariant,
    requestedRange?: MediaRangeRequest,
  ): Promise<MediaReadResult> {
    const facts = await this.store.describeRead(mediaId, variant, context.now);
    if (!facts) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Media not found" });
    assertCanRead(context, facts);
    const range = requestedRange ? resolveRange(requestedRange, facts.byteSize) : undefined;
    const object = await this.blobs.get(facts.objectKey, range);
    if (!object) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Media object not found" });
    if (!matchesManifest(object.metadata, facts) || !matchesRange(object, range, facts.byteSize)) {
      await object.body.cancel().catch(() => undefined);
      throw integrityError();
    }
    return { object, audience: facts.audience };
  }

  async head(
    context: RequestContext,
    mediaId: string,
    variant: MediaVariant,
  ): Promise<MediaHeadResult> {
    const facts = await this.store.describeRead(mediaId, variant, context.now);
    if (!facts) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Media not found" });
    assertCanRead(context, facts);
    const metadata = await this.blobs.head(facts.objectKey);
    if (!metadata) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Media object not found" });
    if (!matchesManifest(metadata, facts)) throw integrityError();
    return { metadata, audience: facts.audience };
  }

  async collectGarbage(
    _context: RequestContext,
    before: string,
    createAudit: MediaGarbageCollectionAuditFactory,
  ): Promise<Readonly<{ deleted: number }>> {
    const claims = await this.store.claimGarbage(before, MAX_GC_BATCH);
    let deleted = 0;
    const failures: Array<Readonly<{ mediaId: string; error: unknown }>> = [];
    for (const claim of claims) {
      try {
        await this.blobs.delete([...claim.objectKeys]);
        await this.store.finalizeDeletion(
          claim.mediaId,
          claim.claimToken,
          createAudit(claim.mediaId),
        );
        deleted += 1;
      } catch (error) {
        failures.push({ mediaId: claim.mediaId, error });
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map(({ mediaId, error }) => new Error(`Media ${mediaId} deletion failed`, { cause: error })),
        `Media garbage collection deleted ${deleted} item(s) and failed ${failures.length}: ${failures.map(({ mediaId }) => mediaId).join(", ")}`,
      );
    }
    return { deleted };
  }

  inspectGarbageBacklog(before: string): Promise<ScheduledJobBacklog> {
    return this.store.inspectGarbageBacklog(before);
  }

  private async persistUploads(
    context: RequestContext,
    pending: readonly PendingUpload[],
  ): Promise<void> {
    const reservations = pending.map(({ reservation }) => reservation);
    await this.store.reserveUploads(reservations);
    try {
      for (const { reservation, data } of pending) {
        for (const variant of reservation.variants) {
          const bytes = data.get(variant.variant);
          if (!bytes) throw new Error(`Missing ${variant.variant} upload bytes`);
          await this.blobs.putIfAbsent(variant.objectKey, {
            body: bytesToStream(bytes),
            size: variant.byteSize,
            contentType: variant.contentType,
            sha256: variant.sha256,
          });
        }
      }
      await this.store.markStaged(reservations.map(({ id }) => id), context.now);
    } catch (cause) {
      let uploadFailure = cause;
      try {
        await this.store.markDeleting(reservations.map(({ id }) => id), context.now);
      } catch (cleanupError) {
        uploadFailure = new AggregateError(
          [cause, cleanupError],
          "Media upload failed and reservations could not be marked for deletion",
        );
      }
      throw new AppError({
        code: "UPSTREAM_ERROR",
        status: 503,
        message: "Media upload could not be completed",
        cause: uploadFailure,
      });
    }
  }
}

function resolveRange(requested: MediaRangeRequest, total: number): BlobRange {
  const offset = requested.kind === "suffix" ? Math.max(0, total - requested.length) : requested.offset;
  if (offset >= total) throw new MediaRangeError(total);
  const requestedLength = requested.kind === "open" ? total - offset : requested.length;
  return { offset, length: Math.min(requestedLength, total - offset) };
}

function matchesManifest(metadata: BlobMetadata, facts: MediaReadFacts): boolean {
  return metadata.key === facts.objectKey
    && metadata.size === facts.byteSize
    && metadata.contentType === facts.contentType
    && metadata.sha256 === facts.sha256;
}

function matchesRange(
  object: NonNullable<Awaited<ReturnType<BlobStore["get"]>>>,
  requested: BlobRange | undefined,
  total: number,
): boolean {
  if (!requested) return object.range === undefined;
  return object.range?.offset === requested.offset
    && object.range.length === requested.length
    && object.range.total === total;
}

function integrityError(): AppError {
  return new AppError({
    code: "UPSTREAM_ERROR",
    status: 503,
    message: "Media object failed integrity validation",
  });
}

function assertCanRead(context: RequestContext, facts: MediaReadFacts): void {
  if (facts.audience === "public") return;
  const actor = context.authorization.actor;
  if (!actor) throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
  if (facts.audience === "authenticated") return;
  if (facts.ownerUserId === actor.userId) return;

  const hasTarget = (entityType: MediaEntityType) => facts.entityTypes.includes(entityType);
  const allowed = (hasTarget("member_profile") && context.authorization.has(PERMISSION_ID.ADMIN_USERS_VIEW))
    || (hasTarget("event") && context.authorization.has(PERMISSION_ID.EVENTS_EDIT))
    || (hasTarget("recurring_template") && context.authorization.has(PERMISSION_ID.EVENTS_TEMPLATES))
    || (hasTarget("announcement") && [
      PERMISSION_ID.ANNOUNCEMENTS_CREATE,
      PERMISSION_ID.ANNOUNCEMENTS_EDIT,
      PERMISSION_ID.ANNOUNCEMENTS_ARCHIVE,
      PERMISSION_ID.ANNOUNCEMENTS_DELETE,
    ].some((permission) => context.authorization.has(permission)))
    || (hasTarget("wiki_article") && [
      PERMISSION_ID.WIKI_ARTICLES_EDIT,
      PERMISSION_ID.WIKI_ARTICLES_ARCHIVE,
      PERMISSION_ID.WIKI_ARTICLES_DELETE,
    ].some((permission) => context.authorization.has(permission)));
  if (!allowed) throw new AppError({ code: "FORBIDDEN", status: 403, message: "Media access denied" });
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function mediaPurposeSupportsTarget(
  purpose: MediaPurpose,
  entityType: MediaEntityType,
  slot: string,
): boolean {
  return MEDIA_CONTRACT.some((entry) => entry.purpose === purpose
    && entry.targets.some((target) => target.entityType === entityType && target.slot === slot));
}
