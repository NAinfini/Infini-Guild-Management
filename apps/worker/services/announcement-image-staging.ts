import { nanoid } from "nanoid";
import { rethrowAfterUploadFailure } from "./media-upload-compensation";
import { buildAnnouncementImageKey } from "./media-keys";
import { err, ok, type ServiceResult } from "./result";

export const ANNOUNCEMENT_IMAGE_LEASE_TTL_SECONDS = 24 * 60 * 60;
const STAGING_PURPOSE = "announcement-image-staging";
const STAGING_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

export type AnnouncementImageStagingPayload = {
  version: 1;
  purpose: typeof STAGING_PURPOSE;
  announcement_id: string;
  actor_id: string;
  exp: number;
};

export type AnnouncementImageStagingDeps = {
  media: R2Bucket;
  rawDb: D1Database;
  signingSecret: string;
  now?: () => Date;
  generateId?: () => string;
};

type StagedFile = { data: ArrayBuffer; contentType: string };

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function base64UrlEncode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const binary = atob(`${normalized}${padding}`);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(new TextEncoder().encode(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signAnnouncementImageStagingToken(secret: string, payload: AnnouncementImageStagingPayload): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), toArrayBuffer(new TextEncoder().encode(encodedPayload)));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyAnnouncementImageStagingToken(secret: string, token: string, actorId: string, now = new Date()): Promise<AnnouncementImageStagingPayload | null> {
  const [encodedPayload, encodedSignature, ...rest] = token.split(".");
  if (!encodedPayload || !encodedSignature || rest.length > 0) return null;
  const signature = base64UrlDecode(encodedSignature);
  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!signature || !payloadBytes) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), toArrayBuffer(signature), toArrayBuffer(new TextEncoder().encode(encodedPayload)));
  if (!valid) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    if (parsed.version !== 1 || parsed.purpose !== STAGING_PURPOSE || typeof parsed.announcement_id !== "string" || !STAGING_ID_PATTERN.test(parsed.announcement_id) || typeof parsed.actor_id !== "string" || parsed.actor_id !== actorId || typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp) || parsed.exp <= Math.floor(now.getTime() / 1000)) return null;
    return parsed as AnnouncementImageStagingPayload;
  } catch {
    return null;
  }
}

export class AnnouncementImageStagingService {
  constructor(private readonly deps: AnnouncementImageStagingDeps) {}

  async stage(actorId: string, files: readonly StagedFile[], existingToken?: string, quota?: number): Promise<ServiceResult<{ staging_id: string; staging_token: string; expires_at: string; keys: string[] }>> {
    const now = this.deps.now?.() ?? new Date();
    const payload = existingToken ? await verifyAnnouncementImageStagingToken(this.deps.signingSecret, existingToken, actorId, now) : null;
    if (existingToken && !payload) return err("FORBIDDEN", "Invalid, expired, or unauthorized staging token");
    const stagingId = payload?.announcement_id ?? this.deps.generateId?.() ?? nanoid();
    if (!STAGING_ID_PATTERN.test(stagingId)) return err("SERVER_ERROR", "Invalid generated staging id");
    const existing = await this.deps.rawDb.prepare("SELECT id FROM announcements WHERE id = ?1").bind(stagingId).first<{ id: string }>();
    if (existing) return err("CONFLICT", "Announcement already exists");
    if (quota !== undefined) {
      const objects = await this.deps.media.list({ prefix: `announcement/${stagingId}/images/`, limit: quota });
      if (objects.objects.length + files.length > quota) return err("VALIDATION_ERROR", `Announcement image quota is ${quota}`);
    }
    const expiresAt = payload?.exp ?? Math.floor(now.getTime() / 1000) + ANNOUNCEMENT_IMAGE_LEASE_TTL_SECONDS;
    const expiresAtIso = new Date(expiresAt * 1000).toISOString();
    const stagingToken = existingToken ?? await signAnnouncementImageStagingToken(this.deps.signingSecret, { version: 1, purpose: STAGING_PURPOSE, announcement_id: stagingId, actor_id: actorId, exp: expiresAt });
    const keys: string[] = [];
    try {
      for (const file of files) {
        const key = buildAnnouncementImageKey(stagingId, file.contentType);
        keys.push(key);
        await this.deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType } });
      }
      if (keys.length > 0) {
        await this.deps.rawDb.batch(keys.map((key) => this.deps.rawDb
          .prepare(
            `INSERT INTO media_upload_leases
               (media_key, owner_user_id, entity_type, entity_id, expires_at, created_at)
             VALUES (?1, ?2, 'announcement', ?3, ?4, ?5)`,
          )
          .bind(key, actorId, stagingId, expiresAtIso, now.toISOString())));
      }
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (key) => this.deps.media.delete(key),
        keys,
      );
    }
    return ok({ staging_id: stagingId, staging_token: stagingToken, expires_at: expiresAtIso, keys });
  }
}
