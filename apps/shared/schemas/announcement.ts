import { z } from "zod";

export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body_json: z.string(),
  pinned: z.boolean(),
  pinned_at: z.string().nullable(),
  status: z.enum(["draft", "scheduled", "published", "archived"]),
  publish_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body_json: z.string().min(1).max(500000),
  pinned: z.boolean().default(false),
  publish_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  status: z.enum(["draft", "scheduled", "published", "archived"]).default("draft"),
  notify_discord: z.boolean().optional().default(false),
  notify_wechat: z.boolean().optional().default(false),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial().extend({
  archived_at: z.string().datetime().nullable().optional(),
});
