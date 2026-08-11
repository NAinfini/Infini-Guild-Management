import { describe, expect, it } from "vitest";
import { canonicalizeRichTextMedia, extractRichTextMediaIds } from "./rich-text-media";

const MEDIA_ID = "123456789012345678901";

describe("rich-text media contract", () => {
  it("stores same-origin browser URLs as deployment-neutral paths", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [{ type: "image", attrs: { src: `https://guild.example/api/media/${MEDIA_ID}/view` } }],
    });

    const canonical = canonicalizeRichTextMedia(body, "https://guild.example/wiki/new");
    expect(canonical).toContain(`/api/media/${MEDIA_ID}/view`);
    expect(canonical).not.toContain("https://guild.example");
    expect(extractRichTextMediaIds(canonical)).toEqual([MEDIA_ID]);
  });

  it("does not claim cross-origin media URLs", () => {
    const source = `https://cdn.example/api/media/${MEDIA_ID}/view`;
    const canonical = canonicalizeRichTextMedia(
      JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: source } }] }),
      "https://guild.example",
    );

    expect(canonical).toContain(source);
    expect(extractRichTextMediaIds(canonical)).toEqual([]);
  });
});
