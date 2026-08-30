import { describe, expect, it } from "vitest";
import { createContentExcerpt } from "./tiptap-text";

describe("createContentExcerpt", () => {
  it("collapses rendered whitespace and caps preview text", () => {
    const excerpt = createContentExcerpt(`  First line\n\nSecond\tline ${"x".repeat(300)}  `);

    expect(excerpt).toHaveLength(280);
    expect(excerpt).toMatch(/^First line Second line x+/);
    expect(excerpt).not.toMatch(/\s{2,}/);
  });
});
