import { z } from "zod";
import { LIMITS } from "../config/limits";
import { ANNOUNCEMENT_STATUSES } from "../constants/announcements";
import { richTextDocumentStringSchema } from "./rich-text";
import { mediaIdSchema } from "./media";

const L = LIMITS.content;
const announcementRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
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

export const announcementAuthorSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  avatar_media_id: mediaIdSchema.nullable(),
});

export const announcementAttachmentSchema = z.object({
  media_id: mediaIdSchema,
  name: z.string().min(1).max(255),
  content_type: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  byte_size: z.number().int().positive(),
});

export const announcementSummarySchema = announcementRecordSchema.extend({
  author: announcementAuthorSchema,
});

export const announcementSchema = announcementSummarySchema.extend({
  body_json: z.string(),
  attachments: z.array(announcementAttachmentSchema),
});

const announcementWriteSchema = z.object({
  title: z.string().min(L.announcementTitle.min).max(L.announcementTitle.max),
  body_json: richTextDocumentStringSchema(
    z.string().min(L.announcementBody.min).max(L.announcementBody.max),
  ),
  pinned: z.boolean(),
  publish_at: z.string().datetime().optional(),
  status: z.enum(ANNOUNCEMENT_STATUSES),
});

export const createAnnouncementSchema = announcementWriteSchema.extend({
  pinned: z.boolean().default(false),
  status: z.enum(ANNOUNCEMENT_STATUSES).default("draft"),
  attachment_media_ids: z.array(mediaIdSchema).max(LIMITS.media.configurableQuotaMax).default([]),
});

export const updateAnnouncementSchema = announcementWriteSchema.partial().extend({
  publish_at: z.string().datetime().nullable().optional(),
  archived_at: z.string().datetime().nullable().optional(),
  attachment_media_ids: z.array(mediaIdSchema).max(LIMITS.media.configurableQuotaMax).optional(),
});

export const announcementImageUploadResponseSchema = z.object({
  expires_at: z.string().datetime(),
  media_ids: z.array(mediaIdSchema),
});

export type AnnouncementImageUploadResponse = z.infer<typeof announcementImageUploadResponseSchema>;

export const announcementAttachmentUploadResponseSchema = z.object({
  expires_at: z.string().datetime(),
  attachment: announcementAttachmentSchema,
});

export type AnnouncementAttachmentUploadResponse = z.infer<typeof announcementAttachmentUploadResponseSchema>;
