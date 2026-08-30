import { describe, expect, it } from "vitest";
import {
  classCatalogItemSchema,
  createClassCatalogItemSchema,
  reorderClassCatalogSchema,
  updateClassCatalogItemSchema,
} from "./class-catalog";

describe("class catalog schemas", () => {
  it("accepts a flat vector class and rejects category fields entirely", () => {
    const value = createClassCatalogItemSchema.parse({
      label: "Stormcaller",
      color: "#65A9D8",
      vector_icon: "bolt",
    });

    expect(value).toEqual({
      label: "Stormcaller",
      color: "#65A9D8",
      vector_icon: "bolt",
    });
    expect(createClassCatalogItemSchema.safeParse({
      ...value,
      category: "dps",
    }).success).toBe(false);
  });

  it("requires image rows to point at an uploaded icon", () => {
    const parsed = classCatalogItemSchema.safeParse({
      id: "storm",
      label: "Storm",
      color: "#65A9D8",
      icon_type: "image",
      vector_icon: "bolt",
      icon_media_id: null,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });

  it("requires a record revision for every update and a collection token for a full reorder", () => {
    expect(createClassCatalogItemSchema.safeParse({
      label: "Storm",
      color: "teal",
      vector_icon: "not-in-the-library",
    }).success).toBe(false);
    expect(updateClassCatalogItemSchema.safeParse({}).success).toBe(false);
    expect(updateClassCatalogItemSchema.safeParse({ label: "Storm" }).success).toBe(false);
    expect(updateClassCatalogItemSchema.parse({
      label: "Storm", expected_updated_at: "2026-01-01T00:00:00.000Z",
    })).toMatchObject({ expected_updated_at: "2026-01-01T00:00:00.000Z" });
    expect(reorderClassCatalogSchema.safeParse({ order: ["storm"] }).success).toBe(false);
    expect(reorderClassCatalogSchema.parse({ order: ["storm"], expected_revision_token: "[]" }))
      .toMatchObject({ expected_revision_token: "[]" });
  });
});
