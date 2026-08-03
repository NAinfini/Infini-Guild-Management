import type { Context } from "hono";
import type { Bindings } from "../index";
import { LIMITS } from "@guild/shared/config/limits";
import { err, ok, type ServiceResult } from "./result";
import {
  buildClassIconKey,
  buildMemberAudioKey,
  buildMemberImageKey,
  buildSiteLogoKey,
} from "./media-keys";

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

/*
 * 头像和站点 Logo 跟图库、Wiki、公告那几条路走同一份名单（WebP 加 GIF 例外），
 * 不再自己抄一遍——原先这里各写各的 new Set(...)，收紧一次要记得改五个地方。
 *
 * SVG 不在名单上，而且不该加：SVG 能内嵌 <script>，当作用户内容原样发出去是个
 * XSS 面。客户端不把它栅格化（那会丢矢量），但服务端照旧不收。
 */
const STORED_IMAGE_TYPES: ReadonlySet<string> = new Set(LIMITS.media.allowedImageTypes);

/** 语音只存 Ogg/Opus。容器之外的编码校验在 validateUploadBytes 里。 */
const STORED_AUDIO_TYPES: ReadonlySet<string> = new Set(["audio/ogg"]);

export type UploadByteValidationResult =
  | { ok: true; contentType: string }
  | { ok: false; message: string };

export class ClassIconUploadValidationError extends Error {
  override readonly name = "ClassIconUploadValidationError";
}

const UPLOAD_VALIDATION_ERROR_PREFIXES = [
  "File bytes do not match declared type:",
  "Unsupported file type:",
  "Unsupported audio codec:",
];

export async function captureUploadValidation<T>(operation: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    if (
      error instanceof Error
      && UPLOAD_VALIDATION_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))
    ) {
      return err("VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}

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

/*
 * 容器认得出来不等于编码认得出来：Ogg 装 Vorbis 和装 Opus，前四个字节都是 "OggS"。
 * 只按容器放行的话，一个 Ogg/Vorbis 文件就这么进了库，而这条路只允许 Opus。
 *
 * Ogg 页头固定 27 字节，第 27 字节是分段表长度，分段表之后才是负载；Opus 流的
 * 第一页负载以 "OpusHead" 开头。偏移按分段表长度算出来，不写死 28——
 * 写死的话，分段表长度不是 1 的文件会被误判。
 */
function isOggOpus(buffer: ArrayBuffer): boolean {
  const view = new Uint8Array(buffer);
  if (view.length < 27) return false;
  const payloadOffset = 27 + (view[26] ?? 0);
  const marker = [0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64];
  if (view.length < payloadOffset + marker.length) return false;
  return marker.every((byte, index) => view[payloadOffset + index] === byte);
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

  /*
   * 到这里只证明了容器对得上。Ogg 还要再看一眼里面是不是 Opus——理由见 isOggOpus。
   * 单独一条错误信息：报「字节和声明的类型对不上」会把人往文件损坏的方向引，
   * 而真实原因是编码不对，重新导出一次就能解决。
   */
  if (declaredType === "audio/ogg" && !isOggOpus(buffer)) {
    return { ok: false, message: "Unsupported audio codec: audio/ogg must contain Opus" };
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

export async function storeProfileImage(c: Context, userId: string, file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const validation = validateUploadBytes(buffer, normalizeContentType(file, "application/octet-stream"), STORED_IMAGE_TYPES);
  if (!validation.ok) throw new Error(validation.message);
  const key = buildMemberImageKey(userId, validation.contentType);
  await getMediaBucket(c).put(key, buffer, {
    httpMetadata: { contentType: validation.contentType },
  });
  return key;
}

export async function storeSiteLogo(c: Context, file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const validation = validateUploadBytes(buffer, normalizeContentType(file, "application/octet-stream"), STORED_IMAGE_TYPES);
  if (!validation.ok) throw new Error(validation.message);
  const key = buildSiteLogoKey(validation.contentType);
  await getMediaBucket(c).put(key, buffer, {
    httpMetadata: { contentType: validation.contentType },
  });
  return key;
}

export async function storeClassIcon(c: Context, classId: string, file: File): Promise<string> {
  if (file.size > LIMITS.media.maxFileSize.classIcon) {
    throw new ClassIconUploadValidationError(
      `Class icon exceeds ${LIMITS.media.maxFileSize.classIcon} byte limit`,
    );
  }
  if (file.type !== "image/webp") {
    throw new ClassIconUploadValidationError(
      "Class icons must be converted to WebP before upload",
    );
  }

  const buffer = await file.arrayBuffer();
  const validation = validateUploadBytes(buffer, file.type, new Set(["image/webp"]));
  if (!validation.ok) throw new ClassIconUploadValidationError(validation.message);

  const key = buildClassIconKey(classId, validation.contentType);
  await getMediaBucket(c).put(key, buffer, {
    httpMetadata: { contentType: validation.contentType },
  });
  return key;
}

export async function storeProfileAudio(c: Context, userId: string, file: File): Promise<string> {
  /* 落库一律是 Ogg/Opus，扩展名跟着容器写 .ogg——以前兜底写 .opus，
     可存进去的字节是 WebM 或 Ogg，名字和内容对不上。 */
  const buffer = await file.arrayBuffer();
  const validation = validateUploadBytes(buffer, normalizeContentType(file, "audio/ogg"), STORED_AUDIO_TYPES);
  if (!validation.ok) throw new Error(validation.message);
  const key = buildMemberAudioKey(userId, validation.contentType);
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
