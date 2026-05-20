import { z } from "zod";
import { isAllowedGalleryVideoUrl } from "../utils/video";
import { GALLERY_ITEM_TYPES } from "../constants/gallery";

export const galleryItemSchema = z.object({
  id: z.string(),
  type: z.enum(GALLERY_ITEM_TYPES),
  url: z.string(),
  caption: z.string().max(200).nullable(),
  uploaded_by: z.string(),
  uploaded_by_name: z.string().nullable().optional(),
  created_at: z.string(),
});

export const createGalleryItemSchema = z
  .object({
    type: z.enum(GALLERY_ITEM_TYPES),
    url: z.string().url("url must be a valid URL"),
    caption: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "video" && !isAllowedGalleryVideoUrl(data.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Video URL must be from an allowed host (YouTube, Bilibili, Vimeo, TikTok)",
      });
    }
  });

