import { describe, expect, it } from "vitest";
import { findRichTextProblem } from "@guild/shared";
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

  it("rejects cross-origin images instead of storing a tracking request", () => {
    const source = `https://cdn.example/api/media/${MEDIA_ID}/view`;
    expect(() => canonicalizeRichTextMedia(
      JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: source } }] }),
      "https://guild.example",
    )).toThrow(/uploaded site media/i);
  });

  it.each([
    `/api/media/${MEDIA_ID}/full`,
    `/api/media/${MEDIA_ID}/view?tracking=1`,
    "/unmanaged/image.png",
  ])("rejects an unmanaged image source: %s", (source) => {
    expect(() => canonicalizeRichTextMedia(
      JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: source } }] }),
      "https://guild.example",
    )).toThrow(/uploaded site media/i);
  });

  it("returns reader-safe canonical link attributes", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "External guide",
          marks: [{
            type: "link",
            attrs: {
              href: "https://external.example/guide",
              target: "_self",
              rel: null,
              class: null,
            },
          }],
        }],
      }, {
        type: "paragraph",
        content: [{
          type: "text",
          text: "Internal guide",
          marks: [{
            type: "link",
            attrs: {
              href: "/wiki/guide",
              target: "_self",
              rel: "noopener noreferrer",
              class: null,
            },
          }],
        }],
      }],
    });

    const canonical = canonicalizeRichTextMedia(body, "https://guild.example/wiki/new");
    const document = JSON.parse(canonical) as {
      content: Array<{ content: Array<{ marks: Array<{ attrs: Record<string, unknown> }> }> }>;
    };

    expect(document.content[0]?.content[0]?.marks[0]?.attrs).toMatchObject({
      target: "_blank",
      rel: "noopener noreferrer",
      class: null,
    });
    expect(document.content[1]?.content[0]?.marks[0]?.attrs).toMatchObject({
      target: "_self",
      rel: null,
      class: null,
    });
    expect(findRichTextProblem(document)).toBeNull();
  });

  it.each(["opener", "noopener opener", "noreferrer opener"])(
    "rejects a hand-crafted link rel containing %s before persistence",
    (rel) => {
      expect(() => canonicalizeRichTextMedia(JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{
            type: "text",
            text: "Unsafe",
            marks: [{ type: "link", attrs: { href: "https://external.example", rel } }],
          }],
        }],
      }), "https://guild.example")).toThrow(/attr "rel"/i);
    },
  );
});
