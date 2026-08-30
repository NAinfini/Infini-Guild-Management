import { describe, expect, it } from "vitest";
import {
  batchUpdateWikiCategoriesSchema,
  createWikiArticleSchema,
  deleteWikiCategorySchema,
  wikiArticleEtag,
  wikiCategoryCatalogSchema,
  wikiRevisionListQuerySchema,
} from "./wiki";

const base = {
  title: "Guide",
  category_id: "category-1",
  sort_order: 0,
  pinned: false,
};

describe("wiki request contracts", () => {
  it("accepts TipTap documents and rejects test-only shorthand", () => {
    expect(createWikiArticleSchema.safeParse({
      ...base,
      body_json: JSON.stringify({ type: "doc", content: [] }),
    }).success).toBe(true);
    expect(createWikiArticleSchema.safeParse({
      ...base,
      body_json: JSON.stringify({ content: "system test" }),
    }).success).toBe(false);
    expect(createWikiArticleSchema.safeParse({
      ...base,
      body_json: JSON.stringify({ content: "system test", forged: true }),
    }).success).toBe(false);
  });

  it("defaults revision pages to 50 and rejects larger pages", () => {
    expect(wikiRevisionListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(wikiRevisionListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it("requires a category collection revision for batch edits and exposes it with the catalog", () => {
    expect(batchUpdateWikiCategoriesSchema.safeParse({
      updates: [{ id: "category-1", name: "Guides" }],
    }).success).toBe(false);
    expect(batchUpdateWikiCategoriesSchema.parse({
      expected_revision_token: "category-state-1",
      updates: [{ id: "category-1", name: "Guides" }],
    })).toMatchObject({ expected_revision_token: "category-state-1" });
    expect(wikiCategoryCatalogSchema.parse({
      categories: [],
      revision_token: "category-state-1",
    })).toEqual({ categories: [], revision_token: "category-state-1" });
  });

  it("requires the confirmation-open category revision for deletion", () => {
    expect(deleteWikiCategorySchema.safeParse({}).success).toBe(false);
    expect(deleteWikiCategorySchema.parse({
      expected_revision_token: "category-state-1",
    })).toEqual({ expected_revision_token: "category-state-1" });
  });

  it("uses one article revision ETag formula", () => {
    expect(wikiArticleEtag({ id: "article-1", updated_at: "2026-08-09T12:00:00.000Z" }))
      .toBe('"wiki-article-1-2026-08-09T12:00:00.000Z"');
  });
});
