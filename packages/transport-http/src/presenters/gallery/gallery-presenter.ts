import { galleryItemSchema, galleryLikeResponseSchema, type CursorResponse, type GalleryItem } from "@guild/shared";
import { z } from "zod";

const galleryPageSchema = z.object({
  data: z.array(galleryItemSchema),
  next_cursor: z.string().nullable(),
});
const galleryUploadSchema = z.object({ data: z.array(galleryItemSchema) });
const okSchema = z.object({ ok: z.literal(true) });
const batchDeleteSchema = okSchema.extend({ deleted: z.number().int().nonnegative() });

export function presentGalleryPage(value: unknown): CursorResponse<GalleryItem> {
  return galleryPageSchema.parse(value);
}

export function presentGalleryItem(value: unknown): GalleryItem {
  return galleryItemSchema.parse(value);
}

export function presentGalleryUpload(value: unknown): { data: GalleryItem[] } {
  return galleryUploadSchema.parse(value);
}

export function presentGalleryOk(value: unknown): { ok: true } {
  return okSchema.parse(value);
}

export function presentGalleryBatchDelete(value: unknown): { ok: true; deleted: number } {
  return batchDeleteSchema.parse(value);
}

export function presentGalleryLike(value: unknown): { liked: boolean; like_count: number } {
  return galleryLikeResponseSchema.parse(value);
}
