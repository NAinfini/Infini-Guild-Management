import { getMediaViewDimensions } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { AppError } from "@guild/kernel";

export type ImageDimensions = Readonly<{ width: number; height: number }>;

export type ValidatedAnnouncementAttachment = Readonly<{
  originalName: string;
  contentType: "application/octet-stream";
  objectExtension: "bin";
}>;

function invalidMedia(message: string): never {
  throw new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function uint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

export function readWebPDimensions(bytes: Uint8Array): ImageDimensions {
  if (bytes.byteLength < 20 || fourCc(bytes, 0) !== "RIFF" || fourCc(bytes, 8) !== "WEBP") {
    return invalidMedia("Image bytes must be WebP");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd > bytes.byteLength || riffEnd < 20) return invalidMedia("WebP data is truncated");
  if (riffEnd !== bytes.byteLength) return invalidMedia("WebP data has trailing bytes");

  let canvas: ImageDimensions | null = null;
  let frame: ImageDimensions | null = null;
  let animated = false;
  let offset = 12;
  for (; offset + 8 <= riffEnd;) {
    const kind = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > riffEnd) return invalidMedia("WebP chunk is truncated");

    if (kind === "VP8X") {
      if (size < 10) return invalidMedia("WebP VP8X header is truncated");
      animated ||= (bytes[start]! & 0x02) !== 0;
      canvas = { width: uint24(bytes, start + 4) + 1, height: uint24(bytes, start + 7) + 1 };
    } else if (kind === "VP8 ") {
      if (size <= 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
        return invalidMedia("WebP VP8 frame header is invalid");
      }
      frame = {
        width: view.getUint16(start + 6, true) & 0x3fff,
        height: view.getUint16(start + 8, true) & 0x3fff,
      };
    } else if (kind === "VP8L") {
      if (size <= 5 || bytes[start] !== 0x2f) return invalidMedia("WebP VP8L frame header is invalid");
      frame = {
        width: 1 + (bytes[start + 1]! | ((bytes[start + 2]! & 0x3f) << 8)),
        height: 1 + (((bytes[start + 2]! & 0xc0) >> 6) | (bytes[start + 3]! << 2) | ((bytes[start + 4]! & 0x0f) << 10)),
      };
    } else if (kind === "ANIM" || kind === "ANMF") {
      animated = true;
    }
    offset = end + (size & 1);
  }

  if (offset !== riffEnd) return invalidMedia("WebP chunk table is invalid");

  if (animated) return invalidMedia("Animated images must be uploaded as video");
  const dimensions = canvas ?? frame;
  if (!dimensions || !frame || dimensions.width < 1 || dimensions.height < 1) {
    return invalidMedia("WebP dimensions are missing or invalid");
  }
  assertImageDimensions(dimensions);
  assertImageDimensions(frame);
  return dimensions;
}

export function validateImagePair(full: Uint8Array, view: Uint8Array, maxBytes: number): Readonly<{
  full: ImageDimensions;
  view: ImageDimensions;
}> {
  assertByteLimit(full, maxBytes);
  assertByteLimit(view, maxBytes);
  const fullDimensions = readWebPDimensions(full);
  const viewDimensions = readWebPDimensions(view);
  const expected = getMediaViewDimensions(fullDimensions.width, fullDimensions.height);
  if (viewDimensions.width !== expected.width || viewDimensions.height !== expected.height) {
    return invalidMedia("View dimensions do not match the required contain size");
  }
  return { full: fullDimensions, view: viewDimensions };
}

export function validateOggOpus(bytes: Uint8Array, maxBytes: number): void {
  assertByteLimit(bytes, maxBytes);
  if (bytes.byteLength < 35 || fourCc(bytes, 0) !== "OggS") return invalidMedia("Audio bytes must be Ogg/Opus");
  const payloadOffset = 27 + bytes[26]!;
  const signature = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64];
  if (payloadOffset + signature.length > bytes.byteLength || !signature.every((byte, index) => bytes[payloadOffset + index] === byte)) {
    return invalidMedia("Audio bytes must be Ogg/Opus");
  }
}

export function validateAnnouncementAttachment(
  input: Readonly<{ bytes: Uint8Array; originalName: string; contentType: string }>,
  maxBytes: number,
): ValidatedAnnouncementAttachment {
  assertByteLimit(input.bytes, maxBytes);
  const originalName = input.originalName.normalize("NFC").trim();
  if (
    originalName.length < 1
    || originalName.length > 255
    || originalName === "."
    || originalName === ".."
    || /[\\/\u0000-\u001f\u007f]/.test(originalName)
  ) {
    return invalidMedia("Attachment name is invalid");
  }
  return {
    originalName,
    contentType: "application/octet-stream",
    objectExtension: "bin",
  };
}

function assertByteLimit(bytes: Uint8Array, maxBytes: number): void {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    invalidMedia(`Media variant must contain between 1 and ${maxBytes} bytes`);
  }
}

function assertImageDimensions(dimensions: ImageDimensions): void {
  const { maxEdge, maxPixels } = LIMITS.media.fullImageBounds;
  if (
    dimensions.width > maxEdge
    || dimensions.height > maxEdge
    || dimensions.width * dimensions.height > maxPixels
  ) {
    invalidMedia(`Image dimensions must not exceed ${maxEdge}px per edge or ${maxPixels} pixels`);
  }
}
