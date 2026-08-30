import type { BlobRead } from "@guild/kernel";
import { describe, expect, it } from "vitest";
import { presentMedia } from "./media-presenter.js";

describe("presentMedia", () => {
  it.each(["authenticated", "private"] as const)(
    "marks every %s response private and non-storable",
    async (audience) => {
      const responses = await Promise.all([
        presentMedia(new Request("https://guild.test/media"), blobRead(), mediaFacts(audience)),
        presentMedia(new Request("https://guild.test/media", { method: "HEAD" }), blobRead(), mediaFacts(audience)),
        presentMedia(new Request("https://guild.test/media"), blobRead(true), mediaFacts(audience)),
        presentMedia(new Request("https://guild.test/media"), blobRead(), mediaFacts(audience), "guild-guide.pdf"),
        presentMedia(new Request("https://guild.test/media", {
          headers: { "If-None-Match": '"media-etag"' },
        }), blobRead(), mediaFacts(audience)),
      ]);

      expect(responses.map((response) => response.headers.get("Cache-Control")))
        .toEqual(Array.from({ length: responses.length }, () => "private, no-store"));
      expect(responses.at(-1)?.status).toBe(304);
    },
  );

  it("caches public full responses for one hour and never stores public ranges", async () => {
    const facts = mediaFacts("public", ["announcement"]);
    const full = await presentMedia(new Request("https://guild.test/media"), blobRead(), facts);
    const range = await presentMedia(new Request("https://guild.test/media"), blobRead(true), facts);

    expect(full.headers.get("Cache-Control")).toBe("public, max-age=3600, s-maxage=60, must-revalidate");
    expect(range.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each(["site_config", "class_catalog"] as const)(
    "marks public %s media immutable because replacements receive a new media ID",
    async (entityType) => {
      const response = await presentMedia(
        new Request("https://guild.test/media"),
        blobRead(),
        mediaFacts("public", [entityType]),
      );

      expect(response.headers.get("Cache-Control"))
        .toBe("public, max-age=31536000, s-maxage=60, immutable");
    },
  );
});

function mediaFacts(
  audience: "public" | "authenticated" | "private",
  entityTypes: readonly ("announcement" | "site_config" | "class_catalog")[] = [],
) {
  return { audience, entityTypes };
}

function blobRead(ranged = false): BlobRead {
  const bytes = new TextEncoder().encode("media");
  return {
    metadata: {
      key: "media/media-1/view.webp",
      size: bytes.byteLength,
      contentType: "image/webp",
      sha256: "digest",
      etag: "media-etag",
      lastModified: "2026-08-09T12:00:00.000Z",
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    ...(ranged ? { range: { offset: 0, length: 3, total: bytes.byteLength } } : {}),
  };
}
