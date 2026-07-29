import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { hasPortalRoot } = require("./smoke-key-pages.cjs") as {
  hasPortalRoot: (html: string) => boolean;
};

describe("hasPortalRoot", () => {
  it.each([
    '<div id="root"></div>',
    '<div id="root" style="min-height: 100vh"></div>',
    "<div class='app' id='root' data-ready></div>",
    '<DIV data-ready id="root"></DIV>',
  ])("accepts a valid React root container: %s", (html) => {
    expect(hasPortalRoot(html)).toBe(true);
  });

  it.each([
    "<main id=\"root\"></main>",
    "<div id=\"not-root\"></div>",
    "<div></div>",
  ])("rejects HTML without the expected div root: %s", (html) => {
    expect(hasPortalRoot(html)).toBe(false);
  });
});
