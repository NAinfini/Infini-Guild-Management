export const STORAGE_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;

export type StorageRarity = (typeof STORAGE_RARITIES)[number];
