import type { ClassCatalogItem, ClassVectorIconId } from "@guild/shared";
import { create } from "zustand";

const LEGACY_COLOR = "#8C94A3";

type ClassCatalogState = {
  items: ClassCatalogItem[];
  setItems: (items: ClassCatalogItem[]) => void;
};

export const useClassCatalogStore = create<ClassCatalogState>((set) => ({
  items: [],
  setItems: (items) => set({ items: [...items].sort(compareClassCatalogItems) }),
}));

export type ResolvedClassCatalogItem = ClassCatalogItem & { legacy: boolean };

export function compareClassCatalogItems(
  left: Pick<ClassCatalogItem, "sort_order" | "label">,
  right: Pick<ClassCatalogItem, "sort_order" | "label">,
): number {
  return left.sort_order - right.sort_order || left.label.localeCompare(right.label);
}

export function resolveClassCatalogItem(
  id: string | null | undefined,
  items: readonly ClassCatalogItem[],
): ResolvedClassCatalogItem {
  const existing = id ? items.find((item) => item.id === id) : undefined;
  if (existing) return { ...existing, legacy: false };
  const fallbackId = id || "unknown";
  return {
    id: fallbackId,
    label: id || "-",
    color: LEGACY_COLOR,
    icon_type: "vector",
    vector_icon: "sword" satisfies ClassVectorIconId,
    icon_key: null,
    sort_order: 100_000,
    created_at: "",
    updated_at: "",
    legacy: true,
  };
}

export function buildClassOptions(
  items: readonly ClassCatalogItem[],
  legacyIds: readonly string[] = [],
): Array<{ value: string; label: string }> {
  const options = items.map((item) => ({ value: item.id, label: item.label }));
  const known = new Set(items.map((item) => item.id));
  for (const id of legacyIds) {
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
