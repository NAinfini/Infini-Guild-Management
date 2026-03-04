import { z } from "zod";
import { CLASS_NAMES } from "../constants/classes";
import { ROLES } from "../constants/roles";

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.enum(ROLES),
  is_active: z.boolean(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const memberProfileSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  wechat_name: z.string().nullable(),
  power: z.number().int().min(0),
  classes: z.array(z.enum(CLASS_NAMES)),
  title_html: z.string().nullable(),
  bio: z.string().nullable(),
  images: z.array(z.string()).max(10),
  audio_key: z.string().nullable(),
  video_urls: z.array(z.string().url()).max(10),
  availability: z.record(z.unknown()).nullable(),
  vacation_start: z.string().nullable(),
  vacation_end: z.string().nullable(),
  discord_id: z.string().nullable(),
  discord_reminder_opt_out: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const updateProfileSchema = memberProfileSchema
  .pick({
    wechat_name: true,
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
    discord_reminder_opt_out: true,
  })
  .partial();

export const adminUpdateProfileSchema = updateProfileSchema.extend({
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
