import { z } from "zod";
import { CLASS_NAMES } from "../constants/classes";
import { PERMISSIONS } from "../constants/roles";

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
  title_html: z.string().max(2000).nullable(),
  bio: z.string().max(2000).nullable(),
  images: z.array(z.string()).max(10),
  audio_key: z.string().nullable(),
  video_urls: z.array(z.string().url()).max(10),
  availability: z.record(z.string(), z.unknown()).nullable(),
  vacation_start: z.string().nullable(),
  vacation_end: z.string().nullable(),
  notes: z.string().max(2000).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const updateProfileSchema = memberProfileSchema
  .pick({
    power: true,
    classes: true,
    title_html: true,
    bio: true,
    images: true,
    audio_key: true,
    video_urls: true,
    availability: true,
    vacation_start: true,
    vacation_end: true,
  })
  .partial();

export const adminUpdateProfileSchema = updateProfileSchema.extend({
  role: z.string().min(1).max(80).optional(),
  is_active: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
