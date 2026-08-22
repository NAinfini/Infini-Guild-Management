// @vitest-environment node
import type { ClassCatalogItem } from "@guild/shared";
import { describe, expect, it } from "vitest";
import {
  buildClassOptions,
  compareClassCatalogItems,
  compareClassTags,
  resolveClassCatalogItem,
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

describe("class catalog helpers", () => {
  it("resolves catalog labels, colors, and icons by stable id", () => {
    expect(resolveClassCatalogItem("warden", [item()])).toMatchObject({
      id: "warden",
      label: "Warden",
      color: "#61B8AA",
      vector_icon: "shield",
    });
  });

  it("uses an explicit empty-class placeholder only when no class was selected", () => {
    expect(resolveClassCatalogItem(null, [item()])).toMatchObject({ id: "", label: "-" });
    expect(resolveClassCatalogItem(undefined, [item()])).toMatchObject({ id: "", label: "-" });
  });

  it("renders a class id missing from the catalog as a visible degraded item", () => {
    expect(resolveClassCatalogItem("missing-class", [item()])).toMatchObject({
      id: "missing-class",
      label: "missing-class",
      icon_type: "vector",
    });
    expect(buildClassOptions([item()])).toEqual([{ value: "warden", label: "Warden" }]);
  });

  it("sorts catalog items by explicit order and then by label", () => {
    const values = [
      item({ id: "z", label: "Zephyr", sort_order: 10 }),
      item({ id: "a", label: "Aegis", sort_order: 10 }),
      item({ id: "m", label: "Mender", sort_order: 0 }),
    ];

    expect(values.sort(compareClassCatalogItems).map(({ id }) => id)).toEqual(["m", "a", "z"]);
  });

  it("sorts class tags by explicit order and then by label", () => {
    const values = [
      { sort_order: 10, label: "Vanguard" },
      { sort_order: 10, label: "Backline" },
      { sort_order: 0, label: "Reserve" },
    ];

    expect(values.sort(compareClassTags).map(({ label }) => label)).toEqual([
      "Reserve",
      "Backline",
      "Vanguard",
    ]);
  });
});
