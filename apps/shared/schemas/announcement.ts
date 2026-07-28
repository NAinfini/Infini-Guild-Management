import { z } from "zod";
import { LIMITS } from "../config/limits";
import { ANNOUNCEMENT_STATUSES } from "../constants/announcements";

const L = LIMITS.content;
const ANNOUNCEMENT_STAGING_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

export const announcementStagingIdSchema = z.string().regex(ANNOUNCEMENT_STAGING_ID_PATTERN);
export const announcementStagingTokenSchema = z.string().min(32).max(2048);

export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body_json: z.string(),
  pinned: z.boolean(),
  status: z.enum(ANNOUNCEMENT_STATUSES),
  publish_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  updated_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const announcementWriteSchema = z.object({
  title: z.string().min(L.announcementTitle.min).max(L.announcementTitle.max),
  body_json: z.string().min(L.announcementBody.min).max(L.announcementBody.max),
  pinned: z.boolean(),
  publish_at: z.string().datetime().optional(),
  status: z.enum(ANNOUNCEMENT_STATUSES),
});

export const createAnnouncementSchema = announcementWriteSchema.extend({
  pinned: z.boolean().default(false),
  status: z.enum(ANNOUNCEMENT_STATUSES).default("draft"),
  staging_token: announcementStagingTokenSchema.optional(),
});

export const updateAnnouncementSchema = announcementWriteSchema.partial().extend({
  archived_at: z.string().datetime().nullable().optional(),
});

export const announcementImageStagingResponseSchema = z.object({
  staging_id: announcementStagingIdSchema,
  staging_token: announcementStagingTokenSchema,
  expires_at: z.string().datetime(),
  keys: z.array(z.string()),
});

export type AnnouncementImageStagingResponse = z.infer<typeof announcementImageStagingResponseSchema>;
