import { describe, expect, it } from "vitest";
import {
  captureUploadValidation,
  detectContentTypeFromBytes,
  validateMagicBytes,
  validateUploadBytes,
} from "../media";

describe("media magic-byte validation", () => {
  it("rejects files whose bytes do not match the declared image type", () => {
    const fakePng = new TextEncoder().encode("<script>alert(1)</script>").buffer;

    expect(validateMagicBytes(fakePng, "image/png")).toBe(false);
  });

  it("accepts valid png signatures", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).buffer;

    expect(validateMagicBytes(pngHeader, "image/png")).toBe(true);
  });

  it("detects webp by RIFF and WEBP signatures", () => {
    const webpHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]).buffer;

    expect(detectContentTypeFromBytes(webpHeader)).toBe("image/webp");
  });

  it("rejects mismatched declared MIME types", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).buffer;

    expect(validateUploadBytes(pngHeader, "image/jpeg", new Set(["image/jpeg", "image/png"]))).toEqual({
      ok: false,
      message: "File bytes do not match declared type: image/jpeg",
    });
  });

  it("rejects unknown declared MIME types even when bytes are not recognized", () => {
    const bytes = new TextEncoder().encode("not media").buffer;

    expect(validateUploadBytes(bytes, "application/octet-stream", new Set(["image/jpeg", "image/png"]))).toEqual({
      ok: false,
      message: "Unsupported file type: application/octet-stream",
    });
  });

  it("accepts valid audio signatures and normalizes content type", () => {
    const oggHeader = new Uint8Array([0x4F, 0x67, 0x67, 0x53, 0x00]).buffer;

    expect(validateUploadBytes(oggHeader, "audio/ogg", new Set(["audio/ogg"]))).toEqual({
      ok: true,
      contentType: "audio/ogg",
    });
  });

  it("accepts AVIF image signatures when AVIF is allowed", () => {
    const avifHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ]).buffer;

    expect(validateUploadBytes(avifHeader, "image/avif", new Set(["image/avif"]))).toEqual({
      ok: true,
      contentType: "image/avif",
    });
  });

  it("accepts SVG files with XML declarations and leading whitespace", () => {
    const svg = new TextEncoder().encode('  <?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>').buffer;

    expect(validateUploadBytes(svg, "image/svg+xml", new Set(["image/svg+xml"]))).toEqual({
      ok: true,
      contentType: "image/svg+xml",
    });
  });

  it("maps upload validation failures to service validation errors", async () => {
    await expect(captureUploadValidation(async () => {
      throw new Error("Unsupported file type: text/plain");
    })).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Unsupported file type: text/plain",
    });
  });

  it("does not hide unrelated storage failures", async () => {
    await expect(captureUploadValidation(async () => {
      throw new Error("R2 unavailable");
    })).rejects.toThrow("R2 unavailable");
  });
});
