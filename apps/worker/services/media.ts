import type { Context } from "hono";
import { nanoid } from "nanoid";
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

export async function storeProfileImage(c: Context, userId: string, file: File): Promise<string> {
  const key = `members/${userId}/images/${Date.now()}_${nanoid()}`;
  await getMediaBucket(c).put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: normalizeContentType(file, "application/octet-stream") },
  });
  return key;
}

export async function storeProfileAudio(c: Context, userId: string, file: File): Promise<string> {
  const key = `members/${userId}/audio/${Date.now()}_${nanoid()}`;
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
