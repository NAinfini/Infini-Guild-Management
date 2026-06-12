import type { Context } from "hono";
import type { Bindings } from "../index";

const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  "image/jpeg": [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  "image/webp": [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }],
  "image/gif": [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  "image/avif": [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, { offset: 8, bytes: [0x61, 0x76, 0x69, 0x66] }],
  "audio/ogg": [{ offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53] }],
  "audio/webm": [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
  "audio/mp4": [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  "audio/mpeg": [{ offset: 0, bytes: [0xFF, 0xFB] }, { offset: 0, bytes: [0xFF, 0xF3] }, { offset: 0, bytes: [0xFF, 0xF2] }, { offset: 0, bytes: [0x49, 0x44, 0x33] }],
  "audio/wav": [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] }],
};

export type UploadByteValidationResult =
  | { ok: true; contentType: string }
  | { ok: false; message: string };

export function validateMagicBytes(buffer: ArrayBuffer, declaredType: string): boolean {
  if (declaredType === "image/svg+xml") return isSvg(buffer);
  const signatures = MAGIC_BYTES[declaredType];
  if (!signatures) return true;
  const view = new Uint8Array(buffer);
  return signatures.every(({ offset, bytes }) => {
    if (view.length < offset + bytes.length) return false;
    return bytes.every((b, i) => view[offset + i] === b);
  });
}

export function detectContentTypeFromBytes(buffer: ArrayBuffer): string | null {
  if (isSvg(buffer)) return "image/svg+xml";
  const view = new Uint8Array(buffer);
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    const match = signatures.every(({ offset, bytes }) => {
      if (view.length < offset + bytes.length) return false;
      return bytes.every((b, i) => view[offset + i] === b);
    });
    if (match) return mime;
  }
  return null;
}

function isSvg(buffer: ArrayBuffer): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 512));
  const normalized = text.replace(/^\uFEFF/, "").trimStart();
  const withoutDeclaration = normalized.replace(/^<\?xml\b[^>]*\?>/i, "").trimStart();
  return /^<svg(\s|>)/i.test(withoutDeclaration);
}

export function validateUploadBytes(
  buffer: ArrayBuffer,
  declaredType: string,
  allowedTypes: ReadonlySet<string>,
): UploadByteValidationResult {
  if (!allowedTypes.has(declaredType)) {
    return { ok: false, message: `Unsupported file type: ${declaredType}` };
  }

  const detectedType = detectContentTypeFromBytes(buffer);
  if (!detectedType) {
    return { ok: false, message: `File bytes do not match declared type: ${declaredType}` };
  }

  if (detectedType !== declaredType) {
    return { ok: false, message: `File bytes do not match declared type: ${declaredType}` };
  }

  return { ok: true, contentType: detectedType };
}

function getMediaBucket(c: Context): R2Bucket {
  const env = c.env as Bindings;
  return env.MEDIA;
}

function normalizeContentType(file: File, fallbackContentType: string): string {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }
  return fallbackContentType;
}

function sanitizeFilename(file: File, fallbackExt: string): string {
  const raw = file.name || `file${fallbackExt}`;
  const sanitized = raw.replace(/[^a-zA-Z0-9._\-()]/g, "_").slice(0, 80);
  const dot = sanitized.lastIndexOf(".");
  const base = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  const ext = dot > 0 ? sanitized.slice(dot) : fallbackExt;
  return `${base}_${Date.now()}${ext}`;
}

export async function storeProfileImage(c: Context, userId: string, file: File): Promise<string> {
  const name = sanitizeFilename(file, ".webp");
  const key = `members/${userId}/images/${name}`;
  const buffer = await file.arrayBuffer();
  const validation = validateUploadBytes(buffer, normalizeContentType(file, "application/octet-stream"), new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]));
  if (!validation.ok) throw new Error(validation.message);
  await getMediaBucket(c).put(key, buffer, {
    httpMetadata: { contentType: validation.contentType },
  });
  return key;
}

export async function storeSiteLogo(c: Context, file: File): Promise<string> {
  const name = sanitizeFilename(file, ".webp");
  const key = `site/logo/${name}`;
  const buffer = await file.arrayBuffer();
  const validation = validateUploadBytes(buffer, normalizeContentType(file, "application/octet-stream"), new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]));
  if (!validation.ok) throw new Error(validation.message);
  await getMediaBucket(c).put(key, buffer, {
    httpMetadata: { contentType: validation.contentType },
  });
  return key;
}

export async function storeProfileAudio(c: Context, userId: string, file: File): Promise<string> {
  const name = sanitizeFilename(file, ".opus");
  const key = `members/${userId}/audio/${name}`;
  const buffer = await file.arrayBuffer();
  const validation = validateUploadBytes(buffer, normalizeContentType(file, "audio/ogg"), new Set(["audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"]));
  if (!validation.ok) throw new Error(validation.message);
  await getMediaBucket(c).put(key, buffer, {
    httpMetadata: { contentType: validation.contentType },
  });
  return key;
}

export async function deleteMediaObject(c: Context, key: string): Promise<void> {
  if (!key) {
    return;
  }
  await getMediaBucket(c).delete(key);
}
