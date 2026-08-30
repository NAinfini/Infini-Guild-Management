import { describe, expect, it } from "vitest";
import { readWebPDimensions } from "./media-validation.js";

const ONE_PIXEL_WEBP = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

function realWebP(): Uint8Array {
  return Uint8Array.from(atob(ONE_PIXEL_WEBP), (value) => value.charCodeAt(0));
}

function withLosslessDimensions(width: number, height: number): Uint8Array {
  const bytes = realWebP();
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes[21] = encodedWidth & 0xff;
  bytes[22] = ((encodedWidth >> 8) & 0x3f) | ((encodedHeight & 0x03) << 6);
  bytes[23] = (encodedHeight >> 2) & 0xff;
  bytes[24] = (bytes[24]! & 0xf0) | ((encodedHeight >> 10) & 0x0f);
  return bytes;
}

describe("WebP validation", () => {
  it("accepts a complete, structurally valid WebP", () => {
    expect(readWebPDimensions(realWebP())).toEqual({ width: 1, height: 1 });
  });

  it("rejects bytes outside the declared RIFF container", () => {
    const valid = realWebP();
    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);

    expect(() => readWebPDimensions(trailing)).toThrow(/trailing bytes/);
  });

  it("rejects a lossless header without compressed image data", () => {
    const headerOnly = new Uint8Array(26);
    headerOnly.set(new TextEncoder().encode("RIFF"), 0);
    new DataView(headerOnly.buffer).setUint32(4, headerOnly.byteLength - 8, true);
    headerOnly.set(new TextEncoder().encode("WEBPVP8L"), 8);
    new DataView(headerOnly.buffer).setUint32(16, 5, true);
    headerOnly[20] = 0x2f;

    expect(() => readWebPDimensions(headerOnly)).toThrow(/VP8L frame header is invalid/);
  });

  it("rejects an oversized edge and total decoded pixel budget", () => {
    expect(() => readWebPDimensions(withLosslessDimensions(8193, 1))).toThrow(/Image dimensions/);
    expect(() => readWebPDimensions(withLosslessDimensions(8000, 6000))).toThrow(/Image dimensions/);
  });
});
