import { z } from "zod";
import { isAllowedGalleryVideoUrl } from "../utils/video";

export const galleryItemSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "video"]),
  url: z.string(),
  caption: z.string().max(200).nullable(),
  uploaded_by: z.string(),
  uploaded_by_name: z.string().nullable().optional(),
  like_count: z.number().int().nonnegative().optional(),
  comment_count: z.number().int().nonnegative().optional(),
  is_liked: z.boolean().optional(),
  created_at: z.string(),
});

export const createGalleryItemSchema = z
  .object({
    type: z.enum(["image", "video"]),
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

export const galleryCommentSchema = z.object({
  id: z.string(),
  gallery_item_id: z.string(),
  user_id: z.string(),
  username: z.string().nullable().optional(),
  body: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createGalleryCommentSchema = z.object({
  body: z.string().min(1).max(500),
});

export const updateGalleryCommentSchema = z.object({
  body: z.string().min(1).max(500),
});
