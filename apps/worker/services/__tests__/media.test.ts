import { describe, expect, it, vi } from "vitest";
import {
  ClassIconUploadValidationError,
  captureUploadValidation,
  detectContentTypeFromBytes,
  storeClassIcon,
  validateMagicBytes,
  validateUploadBytes,
} from "../media";

/**
 * 造一页 Ogg：页头固定 27 字节，第 27 字节是分段表长度，分段表之后才是负载。
 * `segmentCount` 可调，用来验证负载偏移是算出来的而不是写死 28。
 */
function oggPage(payload: string, segmentCount = 1): ArrayBuffer {
  const payloadBytes = new TextEncoder().encode(payload);
  const page = new Uint8Array(27 + segmentCount + payloadBytes.length);
  page.set([0x4F, 0x67, 0x67, 0x53], 0);
  page[26] = segmentCount;
  page.set(payloadBytes, 27 + segmentCount);
  return page.buffer;
}

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

  it("accepts an Ogg page whose first payload is OpusHead", () => {
    expect(validateUploadBytes(oggPage("OpusHead"), "audio/ogg", new Set(["audio/ogg"]))).toEqual({
      ok: true,
      contentType: "audio/ogg",
    });
  });

  it("rejects Ogg/Vorbis even though the container signature matches", () => {
    /*
     * "OggS" 装得下 Vorbis 也装得下 Opus。只比容器的话，一个 Vorbis 文件
     * 就这么进了库，而这条路只允许 Opus——所以这里必须往里再读一页。
     */
    expect(validateUploadBytes(oggPage("\x01vorbis"), "audio/ogg", new Set(["audio/ogg"]))).toEqual({
      ok: false,
      message: "Unsupported audio codec: audio/ogg must contain Opus",
    });
  });

  it("rejects a bare Ogg header with no payload at all", () => {
    const truncated = new Uint8Array([0x4F, 0x67, 0x67, 0x53, 0x00]).buffer;

    expect(validateUploadBytes(truncated, "audio/ogg", new Set(["audio/ogg"]))).toEqual({
      ok: false,
      message: "Unsupported audio codec: audio/ogg must contain Opus",
    });
  });

  it("finds the payload when the segment table is longer than one byte", () => {
    /* 偏移写死 28 的话这一条会挂：分段表长度不是 1，负载就不在 28 上。 */
    expect(validateUploadBytes(oggPage("OpusHead", 3), "audio/ogg", new Set(["audio/ogg"]))).toEqual({
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

describe("class icon storage", () => {
  const validWebP = () => new File([
    new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]),
  ], "class.webp", { type: "image/webp" });

  it("stores only validated WebP bytes under the isolated class icon prefix", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const context = { env: { MEDIA: { put } } };

    const key = await storeClassIcon(
      context as never,
      "storm/caller",
      validWebP(),
    );

    expect(key).toMatch(/^class-icons\/storm%2Fcaller\/.+\.webp$/);
    expect(put).toHaveBeenCalledWith(
      key,
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: "image/webp" } },
    );
  });

  it("rejects a non-WebP declaration before writing to R2", async () => {
    const put = vi.fn();
    const context = { env: { MEDIA: { put } } };
    const png = new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], "class.png", {
      type: "image/png",
    });

    await expect(storeClassIcon(context as never, "storm", png)).rejects.toBeInstanceOf(
      ClassIconUploadValidationError,
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("does not classify an R2 outage as a file validation failure", async () => {
    const storageError = new Error("R2 unavailable");
    const put = vi.fn().mockRejectedValue(storageError);
    const context = { env: { MEDIA: { put } } };

    await expect(storeClassIcon(context as never, "storm", validWebP())).rejects.toBe(
      storageError,
    );
  });
});
