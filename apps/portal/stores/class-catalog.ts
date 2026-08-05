import type { ClassCatalogItem, ClassVectorIconId } from "@guild/shared";
import { create } from "zustand";

const FALLBACK_COLOR = "#8C94A3";

type ClassCatalogState = {
  items: ClassCatalogItem[];
  setItems: (items: ClassCatalogItem[]) => void;
};

export const useClassCatalogStore = create<ClassCatalogState>((set) => ({
  items: [],
  setItems: (items) => set({ items: [...items].sort(compareClassCatalogItems) }),
}));

export function compareClassCatalogItems(
  left: Pick<ClassCatalogItem, "sort_order" | "label">,
  right: Pick<ClassCatalogItem, "sort_order" | "label">,
): number {
  return left.sort_order - right.sort_order || left.label.localeCompare(right.label);
}

export function resolveClassCatalogItem(
  id: string | null | undefined,
  items: readonly ClassCatalogItem[],
): ClassCatalogItem {
  const existing = id ? items.find((item) => item.id === id) : undefined;
  if (existing) return existing;
  const fallbackId = id || "unknown";
  return {
    id: fallbackId,
    label: id || "-",
    color: FALLBACK_COLOR,
    icon_type: "vector",
    vector_icon: "sword" satisfies ClassVectorIconId,
    icon_key: null,
    sort_order: 100_000,
    created_at: "",
    updated_at: "",
  };
}

// Catalog entries may be deleted while profiles and historical rosters still
// reference their stable IDs. Keep those values visible without treating them
// as selectable catalog entries for new records.
export function buildClassOptions(
  items: readonly ClassCatalogItem[],
  preservedIds: readonly string[] = [],
): Array<{ value: string; label: string }> {
  const options = items.map((item) => ({ value: item.id, label: item.label }));
  const known = new Set(items.map((item) => item.id));
  for (const id of preservedIds) {
    if (id && !known.has(id)) {
      known.add(id);
      options.push({ value: id, label: id });
    }
  }
  return options;
}

export function resolveClassIconUrl(key: string): string {
  if (typeof window === "undefined") {
    return `/api/classes/icon?key=${encodeURIComponent(key)}`;
  }
  const url = new URL("/api/classes/icon", window.location.origin);
  url.searchParams.set("key", key);
  return url.toString();
}
