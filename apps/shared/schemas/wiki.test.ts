import { describe, expect, it } from "vitest";
import {
  createWikiArticleSchema,
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
});
