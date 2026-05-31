export const GALLERY_ITEM_TYPES = ["image", "video"] as const;
export type GalleryItemType = (typeof GALLERY_ITEM_TYPES)[number];
