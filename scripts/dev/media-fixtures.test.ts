import { describe, expect, it } from "vitest";
import { validateImagePair, validateOggOpus } from "@guild/server/modules/media";
import { MEDIA_PURPOSES } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import {
  DEVELOPMENT_MEDIA_ASSETS,
  DEVELOPMENT_MEDIA_OBJECTS,
  readDevelopmentMediaObjectBytes,
} from "./media-fixtures.mjs";

describe("development media fixtures", () => {
  it("covers every canonical media purpose", () => {
    expect(new Set(DEVELOPMENT_MEDIA_ASSETS.map((asset) => asset.purpose)))
      .toEqual(new Set(MEDIA_PURPOSES));
  });

  it("contains valid static WebP full/view pairs with manifest dimensions", async () => {
    const imagePairs = new Map<string, { full?: (typeof DEVELOPMENT_MEDIA_OBJECTS)[number]; view?: (typeof DEVELOPMENT_MEDIA_OBJECTS)[number] }>();
    for (const object of DEVELOPMENT_MEDIA_OBJECTS) {
      if (object.contentType !== "image/webp") continue;
      const pair = imagePairs.get(object.filename) ?? {};
      if (object.variant === "full") pair.full = object;
      else if (object.variant === "view") pair.view = object;
      imagePairs.set(object.filename, pair);
    }

    for (const [filename, pair] of imagePairs) {
      const full = pair.full;
      const view = pair.view;
      if (!full || !view) throw new Error(`Image fixture pair is incomplete: ${filename}`);
      const dimensions = validateImagePair(
        await readDevelopmentMediaObjectBytes(full),
        await readDevelopmentMediaObjectBytes(view),
        LIMITS.media.maxFileSize.classIcon,
      );
      expect(dimensions).toEqual({
        full: { width: full.width, height: full.height },
        view: { width: view.width, height: view.height },
      });
    }
  });

  it("contains a static Ogg/Opus fixture", async () => {
    const audio = DEVELOPMENT_MEDIA_OBJECTS.find((object) => object.contentType === "audio/ogg");
    if (!audio) throw new Error("Development audio fixture is missing");
    const bytes = await readDevelopmentMediaObjectBytes(audio);
    expect(() => validateOggOpus(
      bytes,
      LIMITS.media.maxFileSize.profileAudio,
    )).not.toThrow();
  });

  it("contains a PDF fixture for announcement attachments", async () => {
    const attachment = DEVELOPMENT_MEDIA_ASSETS.find(
      (asset) => asset.purpose === "announcement_attachment",
    );
    if (!attachment) throw new Error("Development announcement attachment fixture is missing");
    const full = attachment.variants.find((variant: { variant: string }) => variant.variant === "full");
    if (!full) throw new Error("Development announcement attachment full variant is missing");

    expect(attachment.originalName).toMatch(/\.pdf$/i);
    expect(full.contentType).toBe("application/pdf");
    expect(Buffer.from(await readDevelopmentMediaObjectBytes(full)).subarray(0, 5).toString("ascii"))
      .toBe("%PDF-");
  });
});
