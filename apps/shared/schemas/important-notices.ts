import { z } from "zod";
import { LIMITS } from "../config/limits";
import { IMPORTANT_NOTICE_STATUSES } from "../constants/important-notices";
import { richTextDocumentStringSchema } from "./rich-text";

export { IMPORTANT_NOTICE_STATUSES };

const timestampSchema = z.string().datetime({ offset: true });
const titleSchema = z.string().trim().min(1).max(LIMITS.content.announcementTitle.max);
const bodySchema = richTextDocumentStringSchema(
  z.string().min(LIMITS.content.announcementBody.min).max(LIMITS.content.announcementBody.max),
);

export const importantNoticeSchema = z.object({
  id: z.string(),
  title: titleSchema,
  body_json: bodySchema,
  status: z.enum(IMPORTANT_NOTICE_STATUSES),
  publish_at: timestampSchema.nullable(),
  expires_at: timestampSchema.nullable(),
  publication_revision: z.number().int().nonnegative(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict();

export const createImportantNoticeSchema = z.object({
  title: titleSchema,
  body_json: bodySchema,
  status: z.enum(["draft", "scheduled"] as const).default("draft"),
  publish_at: timestampSchema.optional(),
  expires_at: timestampSchema.nullable().optional(),
}).strict();

export const updateImportantNoticeSchema = z.object({
  title: titleSchema.optional(),
  body_json: bodySchema.optional(),
  publish_at: timestampSchema.nullable().optional(),
  expires_at: timestampSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one important notice field is required",
});

export const importantNoticeActiveSchema = z.object({
  id: z.string(),
  title: titleSchema,
  body_json: bodySchema,
  published_at: timestampSchema,
  expires_at: timestampSchema.nullable(),
  publication_revision: z.number().int().positive(),
}).strict();

export const importantNoticeActiveResponseSchema = z.object({
  data: z.array(importantNoticeActiveSchema),
}).strict();

export const importantNoticeAcknowledgementSchema = z.object({
  notice_id: z.string(),
  publication_revision: z.number().int().positive(),
}).strict();

export const importantNoticeAcknowledgementsResponseSchema = z.object({
  data: z.array(importantNoticeAcknowledgementSchema),
}).strict();

export const acknowledgeImportantNoticeSchema = z.object({
  publication_revision: z.number().int().positive(),
}).strict();

export const importantNoticeAcknowledgementResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export const importantNoticeOkResponseSchema = z.object({
  ok: z.literal(true),
}).strict();
