import {
  announcementImageUploadResponseSchema,
  announcementAttachmentUploadResponseSchema,
  announcementSchema,
  announcementSummarySchema,
  mediaIdsResponseSchema,
  type Announcement,
  type AnnouncementSummary,
  type PaginatedResponse,
} from "@guild/shared";
import { z } from "zod";

const announcementPageSchema = z.object({
  data: z.array(announcementSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
});
const okSchema = z.object({ ok: z.literal(true) });

export function presentAnnouncement(value: unknown): Announcement {
  return announcementSchema.parse(value);
}

export function presentAnnouncementPage(value: unknown): PaginatedResponse<AnnouncementSummary> {
  return announcementPageSchema.parse(value);
}

export function presentAnnouncementPendingImages(value: unknown) {
  return announcementImageUploadResponseSchema.parse(value);
}

export function presentAnnouncementPendingAttachment(value: unknown) {
  return announcementAttachmentUploadResponseSchema.parse(value);
}

export function presentAnnouncementMediaIds(value: unknown): { media_ids: string[] } {
  return mediaIdsResponseSchema.parse(value);
}

export function presentAnnouncementOk(value: unknown): { ok: true } {
  return okSchema.parse(value);
}
