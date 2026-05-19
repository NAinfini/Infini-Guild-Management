import { describe, expect, it } from "vitest";
import { validateMagicBytes } from "../media";

describe("media magic-byte validation", () => {
  it("rejects files whose bytes do not match the declared image type", () => {
    const fakePng = new TextEncoder().encode("<script>alert(1)</script>").buffer;

    expect(validateMagicBytes(fakePng, "image/png")).toBe(false);
  });

  it("accepts valid png signatures", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).buffer;

    expect(validateMagicBytes(pngHeader, "image/png")).toBe(true);
  });
});
