import { describe, expect, it } from "vitest";
import {
  classCatalogItemSchema,
  createClassCatalogItemSchema,
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

  it("rejects unknown vectors, malformed colors, and empty updates", () => {
    expect(createClassCatalogItemSchema.safeParse({
      label: "Storm",
      color: "teal",
      vector_icon: "not-in-the-library",
    }).success).toBe(false);
    expect(updateClassCatalogItemSchema.safeParse({}).success).toBe(false);
  });
});
