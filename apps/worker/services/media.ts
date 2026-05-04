import type { Context } from "hono";
import type { Bindings } from "../index";

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
  await getMediaBucket(c).put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: normalizeContentType(file, "application/octet-stream") },
  });
  return key;
}

export async function storeProfileAudio(c: Context, userId: string, file: File): Promise<string> {
  const name = sanitizeFilename(file, ".opus");
  const key = `members/${userId}/audio/${name}`;
  await getMediaBucket(c).put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: normalizeContentType(file, "audio/ogg") },
  });
  return key;
}

export async function deleteMediaObject(c: Context, key: string): Promise<void> {
  if (!key) {
    return;
  }
  await getMediaBucket(c).delete(key);
}
