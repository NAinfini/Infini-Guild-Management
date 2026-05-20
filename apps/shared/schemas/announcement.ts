import { z } from "zod";
import { LIMITS } from "../config/limits";
import { ANNOUNCEMENT_STATUSES } from "../constants/announcements";

const L = LIMITS.content;

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

export const createAnnouncementSchema = z.object({
  title: z.string().min(L.announcementTitle.min).max(L.announcementTitle.max),
  body_json: z.string().min(L.announcementBody.min).max(L.announcementBody.max),
  pinned: z.boolean().default(false),
  publish_at: z.string().datetime().optional(),
  status: z.enum(ANNOUNCEMENT_STATUSES).default("draft"),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial().extend({
  archived_at: z.string().datetime().nullable().optional(),
});
