import { z } from "zod";
import { isAllowedGalleryVideoUrl } from "../utils/video";
import { mediaIdSchema } from "./media";

const galleryItemBaseSchema = z.object({
  id: z.string(),
  caption: z.string().max(200).nullable(),
  uploaded_by: z.string(),
  uploaded_by_name: z.string().nullable().optional(),
  created_at: z.string(),
});

export const galleryItemSchema = z.discriminatedUnion("type", [
  galleryItemBaseSchema.extend({
    type: z.literal("image"),
    media_id: mediaIdSchema,
    url: z.null(),
  }),
  galleryItemBaseSchema.extend({
    type: z.literal("video"),
    media_id: z.null(),
    url: z.string().url(),
  }),
]);

export const createGalleryItemSchema = z
  .object({
    type: z.literal("video"),
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

