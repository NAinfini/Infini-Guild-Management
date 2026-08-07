import { z } from "zod";
import { LIMITS } from "../config/limits";
import { PERMISSIONS } from "../constants/roles";
import { isAllowedVideoUrl } from "../utils/video";
import { classIdSchema } from "./class-catalog";
import { roleMetadataSchema } from "./role";

const L = LIMITS.content;
const permissionKeySchema = z.enum(PERMISSIONS);

// Write-side only. `z.string().url()` accepts `javascript:` and `data:`, so the
// host allowlist has to be enforced here and not just in the profile form —
// these URLs are later rendered as anchor hrefs and video embeds.
const writableVideoUrlSchema = z
  .string()
  .url()
  .refine(isAllowedVideoUrl, {
    message: "Video URL must be from an allowed host (YouTube, Bilibili, Vimeo, TikTok, Douyin)",
  });

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.string().min(1),
  permissions: z.record(permissionKeySchema, z.boolean()),
  is_active: z.boolean(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).extend(roleMetadataSchema.shape);

export const memberProfileSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  power: z.number().min(0),
  classes: z
    .array(classIdSchema)
    .max(20)
    .refine((values) => new Set(values).size === values.length, {
      message: "Classes must be unique",
    }),
  title_html: z.string().max(L.profileTitleHtml.max).nullable(),
  bio: z.string().max(L.profileBio.max).nullable(),
  avatar_key: z.string().nullable(),
  images: z.array(z.string()).max(L.profileImages.max),
  audio_key: z.string().nullable(),
  video_urls: z.array(z.string().url()).max(L.profileVideoUrls.max),
  availability: z.record(z.string(), z.unknown()).nullable(),
  vacation_start: z.string().nullable(),
  vacation_end: z.string().nullable(),
  notes: z.string().max(L.profileNotes.max).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// `avatar_key` and `audio_key` are deliberately absent: they are owned by the
// dedicated upload/delete endpoints. Accepting them here let any member point
// their profile at an arbitrary R2 key and then have the server delete it.
// `images` stays writable for reorder/remove, but UserService.updateProfile
// rejects keys that are not already on the target profile.
export const updateProfileSchema = memberProfileSchema
  .pick({
    power: true,
    classes: true,
    title_html: true,
    bio: true,
    images: true,
    availability: true,
  })
  .partial()
  .extend({
    video_urls: z.array(writableVideoUrlSchema).max(L.profileVideoUrls.max).optional(),
  });

// `role` and `is_active` are not accepted here: they live in
// PATCH /api/admin/users/:id/role and the activate/deactivate endpoints.
// Declaring them made the request look successful while the values were dropped.
export const adminUpdateProfileSchema = updateProfileSchema.extend({
  notes: z.string().max(L.profileNotes.max).nullable().optional(),
});

export const deleteProfileImagesSchema = z.object({
  keys: z.array(z.string().min(1)).min(L.profileImagesDeleteBatch.min).max(L.profileImagesDeleteBatch.max),
});
