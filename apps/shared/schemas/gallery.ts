import { z } from "zod";
import { LIMITS } from "../config/limits";
import { isAllowedGalleryVideoUrl } from "../utils/video";
import { mediaIdSchema } from "./media";

const galleryItemBaseSchema = z.object({
  id: z.string(),
  title: z.string().min(LIMITS.content.galleryTitle.min).max(LIMITS.content.galleryTitle.max),
  description: z.string().max(LIMITS.content.galleryDescription.max).nullable(),
  uploaded_by: z.string(),
  uploaded_by_name: z.string().nullable().optional(),
  like_count: z.number().int().nonnegative(),
  liked_by_viewer: z.boolean(),
  created_at: z.string(),
  // An opaque per-item precondition used for concurrent writes.
  revision_token: z.string().min(1).max(200),
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
    title: z.string().trim().min(LIMITS.content.galleryTitle.min).max(LIMITS.content.galleryTitle.max),
    description: z.string().trim().max(LIMITS.content.galleryDescription.max).optional().nullable(),
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

export const updateGalleryItemSchema = z.object({
  title: z.string().trim().min(LIMITS.content.galleryTitle.min).max(LIMITS.content.galleryTitle.max),
  description: z.string().trim().max(LIMITS.content.galleryDescription.max).optional().nullable(),
}).strict();

export const galleryLikeResponseSchema = z.object({
  liked: z.boolean(),
  like_count: z.number().int().nonnegative(),
});

export function galleryItemEtag(
  record: Pick<z.infer<typeof galleryItemSchema>, "id" | "revision_token">,
): string {
  return `"gallery-${record.id}-${record.revision_token}"`;
}

