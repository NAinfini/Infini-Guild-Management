import { z } from "zod";
import { LIMITS } from "../config/limits";
import { CLASS_NAMES } from "../constants/classes";
import { PERMISSIONS } from "../constants/roles";

const L = LIMITS.content;
const permissionKeySchema = z.enum(PERMISSIONS);

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.string().min(1),
  permissions: z.record(permissionKeySchema, z.boolean()),
  is_active: z.boolean(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const memberProfileSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  power: z.number().min(0),
  classes: z.array(z.enum(CLASS_NAMES)),
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

export const updateProfileSchema = memberProfileSchema
  .pick({
    power: true,
    classes: true,
    title_html: true,
    bio: true,
    avatar_key: true,
    images: true,
    audio_key: true,
    video_urls: true,
    availability: true,
  })
  .partial();

export const adminUpdateProfileSchema = updateProfileSchema.extend({
  role: z.string().min(1).max(L.roleName.max).optional(),
  is_active: z.boolean().optional(),
  notes: z.string().max(L.profileNotes.max).nullable().optional(),
});

export const deleteProfileImagesSchema = z.object({
  keys: z.array(z.string().min(1)).min(L.profileImagesDeleteBatch.min).max(L.profileImagesDeleteBatch.max),
});
