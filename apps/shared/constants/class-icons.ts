export const CLASS_VECTOR_ICON_IDS = [
  "sword",
  "swords",
  "shield",
  "heartbeat",
  "heart",
  "bolt",
  "zap",
  "flame",
  "target",
  "target-arrow",
  "crown",
  "trophy",
  "hammer",
  "gauntlet",
  "boot",
  "pendant",
  "rings",
  "sparkles",
  "sparkles-2",
  "user",
  "users",
  "user-circle",
  "friends",
  "world",
  "cloud",
  "moon",
  "sun",
  "flag",
  "gift",
  "dice",
  "wrench",
  "book",
  "palette",
] as const;

export type ClassVectorIconId = (typeof CLASS_VECTOR_ICON_IDS)[number];

export type DefaultClassCatalogSeed = {
  id: string;
  label: string;
  color: string;
  vector_icon: ClassVectorIconId;
  sort_order: number;
};

/**
 * Existing profile rows store these names as their class IDs. Keeping the same
 * values in the catalog makes the migration additive: no member data rewrite
 * and no temporary split-brain between the JSON and lookup tables.
 */
export const DEFAULT_CLASS_CATALOG: readonly DefaultClassCatalogSeed[] = [
  { id: "鸣金虹", label: "鸣金虹", color: "#6EA8FE", vector_icon: "sword", sort_order: 0 },
  { id: "鸣金影", label: "鸣金影", color: "#79A7F2", vector_icon: "target-arrow", sort_order: 10 },
  { id: "牵丝玉", label: "牵丝玉", color: "#58C7A6", vector_icon: "sparkles", sort_order: 20 },
  { id: "牵丝霖", label: "牵丝霖", color: "#54C39B", vector_icon: "heartbeat", sort_order: 30 },
  { id: "牵丝翊", label: "牵丝翊", color: "#62BEA7", vector_icon: "pendant", sort_order: 40 },
  { id: "破竹风", label: "破竹风", color: "#A78BFA", vector_icon: "bolt", sort_order: 50 },
  { id: "破竹尘", label: "破竹尘", color: "#9B8AE8", vector_icon: "shield", sort_order: 60 },
  { id: "破竹鸢", label: "破竹鸢", color: "#B18CF1", vector_icon: "target", sort_order: 70 },
  { id: "裂石威", label: "裂石威", color: "#E27676", vector_icon: "shield", sort_order: 80 },
  { id: "裂石钧", label: "裂石钧", color: "#DB7770", vector_icon: "hammer", sort_order: 90 },
] as const;
