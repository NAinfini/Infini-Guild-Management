import type { ClassCatalogItem } from "@guild/shared";
import { describe, expect, it } from "vitest";
import {
  buildClassOptions,
  compareClassCatalogItems,
  resolveClassCatalogItem,
  useClassCatalogStore,
} from "./class-catalog";

type VectorClassCatalogItem = Extract<ClassCatalogItem, { icon_type: "vector" }>;

const item = (
  overrides: Partial<VectorClassCatalogItem> = {},
): VectorClassCatalogItem => ({
  id: "warden",
  label: "Warden",
  color: "#61B8AA",
  icon_type: "vector",
  vector_icon: "shield",
  icon_media_id: null,
  sort_order: 20,
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("class catalog store helpers", () => {
  it("starts empty until the D1-backed catalog is loaded", () => {
    expect(useClassCatalogStore.getState().items).toEqual([]);
  });

  it("resolves catalog labels, colors, and icons by stable id", () => {
    expect(resolveClassCatalogItem("warden", [item()])).toMatchObject({
      id: "warden",
      label: "Warden",
      color: "#61B8AA",
      vector_icon: "shield",
    });
  });

  it("keeps referenced values visible after their catalog entry is deleted", () => {
    const resolved = resolveClassCatalogItem("retired-class", [item()]);
    expect(resolved).toMatchObject({
      id: "retired-class",
      label: "retired-class",
    });
    expect(buildClassOptions([item()], ["retired-class", "retired-class"])).toEqual([
      { value: "warden", label: "Warden" },
      { value: "retired-class", label: "retired-class" },
    ]);
  });

  it("sorts by explicit order and then by label", () => {
    const values = [
      item({ id: "z", label: "Zephyr", sort_order: 10 }),
      item({ id: "a", label: "Aegis", sort_order: 10 }),
      item({ id: "m", label: "Mender", sort_order: 0 }),
    ];

    expect(values.sort(compareClassCatalogItems).map(({ id }) => id)).toEqual(["m", "a", "z"]);
  });
});
