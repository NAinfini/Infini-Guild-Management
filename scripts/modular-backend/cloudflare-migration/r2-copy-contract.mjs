export const R2_MIGRATION_VERSION = 1;
export const R2_MAX_OBJECT_BYTES = 32 * 1024 * 1024;
export const R2_SHA256_PATTERN = /^[0-9a-f]{64}$/;

const MEDIA_ID = /^[A-Za-z0-9_-]{21}$/;

export function parseR2Manifest(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`R2 media manifest is not valid JSON: ${error.message}`);
  }
  assertRecord(value, "R2 media manifest");
  assertKeys(value, ["version", "objects"], ["version", "objects"], "R2 media manifest");
  if (value.version !== R2_MIGRATION_VERSION) {
    throw new TypeError(`[unknown] R2 media manifest version ${value.version}`);
  }
  if (!Array.isArray(value.objects)) throw new TypeError("R2 media manifest objects must be an array");

  const targetKeys = new Set();
  const objects = value.objects.map((entry, index) => {
    const normalized = normalizeR2ManifestObject(entry, `R2 media manifest object ${index}`);
    if (targetKeys.has(normalized.targetKey)) {
      throw new TypeError(`[conflict] R2 media manifest object ${index} duplicates a target key`);
    }
    targetKeys.add(normalized.targetKey);
    return normalized;
  });
  return { version: R2_MIGRATION_VERSION, objects };
}

export function normalizeR2ManifestObject(entry, label = "R2 media manifest object") {
  assertRecord(entry, label);
  assertKeys(
    entry,
    ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType", "sha256", "width", "height", "sourceByteSize", "sourceContentType", "pretransformed"],
    ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType"],
    label,
  );
  if (typeof entry.mediaId !== "string" || !MEDIA_ID.test(entry.mediaId)) {
    throw new TypeError(`[unknown] ${label} has an invalid mediaId`);
  }
  if (entry.variant !== "full" && entry.variant !== "view") {
    throw new TypeError(`[unknown] ${label} has an invalid variant`);
  }
  if (!Number.isSafeInteger(entry.byteSize) || entry.byteSize < 1 || entry.byteSize > R2_MAX_OBJECT_BYTES) {
    throw new TypeError(`${label} byteSize must be between 1 and ${R2_MAX_OBJECT_BYTES}`);
  }
  if (entry.contentType !== "image/webp" && entry.contentType !== "audio/ogg") {
    throw new TypeError(`[unknown] ${label} has an unsupported contentType`);
  }
  if (entry.sha256 !== undefined && (typeof entry.sha256 !== "string" || !R2_SHA256_PATTERN.test(entry.sha256))) {
    throw new TypeError(`${label} sha256 must be 64 lowercase hexadecimal characters`);
  }
  const sourceByteSize = entry.sourceByteSize ?? entry.byteSize;
  const sourceContentType = entry.sourceContentType ?? entry.contentType;
  if (!Number.isSafeInteger(sourceByteSize) || sourceByteSize < 1 || sourceByteSize > R2_MAX_OBJECT_BYTES) {
    throw new TypeError(`${label} sourceByteSize must be between 1 and ${R2_MAX_OBJECT_BYTES}`);
  }
  if (typeof sourceContentType !== "string" || sourceContentType.length < 1 || sourceContentType.length > 128) {
    throw new TypeError(`${label} sourceContentType is invalid`);
  }
  if (entry.pretransformed !== undefined && entry.pretransformed !== true) {
    throw new TypeError(`${label} pretransformed must be true when present`);
  }

  assertSafeR2Key(entry.sourceKey, `${label} sourceKey`);
  if (entry.contentType === "audio/ogg" && !entry.sourceKey.endsWith(".ogg")) {
    throw new TypeError(`[unknown] ${label} audio source key must end in .ogg`);
  }
  const targetKey = entry.contentType === "image/webp"
    ? `media/${entry.mediaId}/${entry.variant}.webp`
    : `media/${entry.mediaId}/full.opus`;
  if (entry.contentType === "audio/ogg" && entry.variant !== "full") {
    throw new TypeError(`[unknown] ${label} maps audio to a non-full variant`);
  }
  if (entry.targetKey !== targetKey) {
    throw new TypeError(`[unknown] ${label} has a non-canonical target key`);
  }

  const dimensions = normalizeDimensions(entry, label);
  if (entry.pretransformed === true && (!entry.sha256 || dimensions.width === undefined || dimensions.height === undefined)) {
    throw new TypeError(`${label} pretransformed image requires sha256 and dimensions`);
  }
  return {
    mediaId: entry.mediaId,
    variant: entry.variant,
    sourceKey: entry.sourceKey,
    targetKey,
    byteSize: entry.byteSize,
    contentType: entry.contentType,
    ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
    ...dimensions,
    ...(entry.sourceByteSize === undefined ? {} : { sourceByteSize }),
    ...(entry.sourceContentType === undefined ? {} : { sourceContentType }),
    ...(entry.pretransformed === true ? { pretransformed: true } : {}),
  };
}

export function assertSafeR2Key(key, label = "R2 key") {
  if (
    typeof key !== "string"
    || key.length < 1
    || key.length > 1_024
    || key.startsWith("/")
    || key.endsWith("/")
    || key.includes("\\")
    || key.includes("\0")
    || key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`[unknown] ${label} is not a safe relative key`);
  }
}

export function readWebpDimensions(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 20 || fourCc(bytes, 0) !== "RIFF" || fourCc(bytes, 8) !== "WEBP") {
    throw new TypeError("[unknown] Image bytes are not WebP");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd > bytes.byteLength || riffEnd < 20) throw new TypeError("[conflict] WebP data is truncated");

  let canvas = null;
  let frame = null;
  let animated = false;
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const kind = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > riffEnd) throw new TypeError("[conflict] WebP chunk is truncated");
    if (kind === "VP8X") {
      if (size < 10) throw new TypeError("[conflict] WebP VP8X header is truncated");
      animated ||= (bytes[start] & 0x02) !== 0;
      canvas = { width: uint24(bytes, start + 4) + 1, height: uint24(bytes, start + 7) + 1 };
    } else if (kind === "VP8 ") {
      if (size < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
        throw new TypeError("[conflict] WebP VP8 frame header is invalid");
      }
      frame = {
        width: view.getUint16(start + 6, true) & 0x3fff,
        height: view.getUint16(start + 8, true) & 0x3fff,
      };
    } else if (kind === "VP8L") {
      if (size < 5 || bytes[start] !== 0x2f) throw new TypeError("[conflict] WebP VP8L frame header is invalid");
      frame = {
        width: 1 + (bytes[start + 1] | ((bytes[start + 2] & 0x3f) << 8)),
        height: 1 + (((bytes[start + 2] & 0xc0) >> 6) | (bytes[start + 3] << 2) | ((bytes[start + 4] & 0x0f) << 10)),
      };
    } else if (kind === "ANIM" || kind === "ANMF") {
      animated = true;
    }
    offset = end + (size & 1);
  }
  if (animated) throw new TypeError("[unknown] Animated WebP cannot be migrated as an image");
  const dimensions = canvas ?? frame;
  if (!dimensions || !frame || dimensions.width < 1 || dimensions.height < 1) {
    throw new TypeError("[unknown] WebP dimensions are missing or invalid");
  }
  return dimensions;
}

export function assertOggOpus(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 35 || fourCc(bytes, 0) !== "OggS") {
    throw new TypeError("[unknown] Audio bytes are not Ogg/Opus");
  }
  const payloadOffset = 27 + bytes[26];
  const signature = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64];
  if (
    payloadOffset + signature.length > bytes.byteLength
    || !signature.every((byte, index) => bytes[payloadOffset + index] === byte)
  ) {
    throw new TypeError("[unknown] Audio bytes are not Ogg/Opus");
  }
}

function normalizeDimensions(entry, label) {
  if (entry.contentType === "audio/ogg") {
    if ((entry.width !== undefined && entry.width !== null) || (entry.height !== undefined && entry.height !== null)) {
      throw new TypeError(`${label} audio dimensions must be null`);
    }
    return { width: null, height: null };
  }
  if (entry.width === undefined && entry.height === undefined) return {};
  if (
    !Number.isSafeInteger(entry.width)
    || entry.width < 1
    || !Number.isSafeInteger(entry.height)
    || entry.height < 1
  ) {
    throw new TypeError(`${label} image dimensions must be positive integers`);
  }
  return { width: entry.width, height: entry.height };
}

function fourCc(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function uint24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertKeys(value, allowed, required, label) {
  const keys = Object.keys(value);
  const unknown = keys.find((key) => !allowed.includes(key));
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (unknown) throw new TypeError(`[unknown] ${label} contains field ${unknown}`);
  if (missing) throw new TypeError(`${label} is missing field ${missing}`);
}
