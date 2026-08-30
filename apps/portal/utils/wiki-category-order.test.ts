import { describe, expect, it } from "vitest";
import type { WikiCategoryDraft } from "@portal/types/wiki";
import { reorderCategoryDrafts } from "./wiki-category-order";

function draft(id: string, sortOrder: number): WikiCategoryDraft {
  return { id, name: id, slug: id, sort_order: sortOrder };
}

describe("reorderCategoryDrafts", () => {
  it("moves categories in one flat sequence and normalizes sort order", () => {
    const result = reorderCategoryDrafts(
      [draft("a", 4), draft("b", 9), draft("c", 12)],
      "c",
      "a",
    );

    expect(result.map((item) => [item.id, item.sort_order])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("preserves identity for a no-op or unknown target", () => {
    const drafts = [draft("a", 0), draft("b", 1)];
    expect(reorderCategoryDrafts(drafts, "a", "a")).toBe(drafts);
    expect(reorderCategoryDrafts(drafts, "a", "missing")).toBe(drafts);
  });
});
