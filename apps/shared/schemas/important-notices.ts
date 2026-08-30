import { z } from "zod";
import { LIMITS } from "../config/limits";
import {
  IMPORTANT_NOTICE_AUDIENCE_SCOPES,
  IMPORTANT_NOTICE_STATUSES,
} from "../constants/important-notices";
import { richTextDocumentStringSchema } from "./rich-text";
import { roleIdSchema } from "./role";

export { IMPORTANT_NOTICE_AUDIENCE_SCOPES, IMPORTANT_NOTICE_STATUSES };

const timestampSchema = z.string().datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const titleSchema = z.string().trim().min(1).max(LIMITS.content.announcementTitle.max);
const bodySchema = richTextDocumentStringSchema(
  z.string().min(LIMITS.content.announcementBody.min).max(LIMITS.content.announcementBody.max),
);
const audienceScopeSchema = z.enum(IMPORTANT_NOTICE_AUDIENCE_SCOPES);
const audienceRoleIdsSchema = z.array(roleIdSchema).max(100).superRefine((roleIds, context) => {
  if (new Set(roleIds).size !== roleIds.length) {
    context.addIssue({ code: "custom", message: "Audience role IDs must be unique" });
  }
});

function audienceIsConsistent(
  value: Readonly<{ audience_scope: "all" | "roles"; audience_role_ids: readonly string[] }>,
): boolean {
  return value.audience_scope === "all"
    ? value.audience_role_ids.length === 0
    : value.audience_role_ids.length > 0;
}

const deliveryFields = {
  requires_acknowledgement: z.boolean(),
  audience_scope: audienceScopeSchema,
  audience_role_ids: audienceRoleIdsSchema,
} as const;

export const importantNoticeSchema = z.object({
  id: z.string(),
  title: titleSchema,
  body_json: bodySchema,
  status: z.enum(IMPORTANT_NOTICE_STATUSES),
  publish_at: timestampSchema.nullable(),
  expires_at: timestampSchema.nullable(),
  publication_revision: z.number().int().nonnegative(),
  ...deliveryFields,
  revision_token: z.string().min(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict().refine((value) => value.audience_scope !== "all" || value.audience_role_ids.length === 0, {
  message: "All-member notices cannot contain audience roles",
});

export const createImportantNoticeSchema = z.object({
  title: titleSchema,
  body_json: bodySchema,
  status: z.enum(["draft", "scheduled"] as const).default("draft"),
  publish_at: timestampSchema.optional(),
  expires_at: timestampSchema.nullable().optional(),
  requires_acknowledgement: z.boolean().default(false),
  audience_scope: audienceScopeSchema.default("all"),
  audience_role_ids: audienceRoleIdsSchema.default([]),
}).strict().refine(audienceIsConsistent, { message: "Important notice audience is invalid" });

export const updateImportantNoticeSchema = z.object({
  expected_revision_token: z.string().min(1),
  title: titleSchema.optional(),
  body_json: bodySchema.optional(),
  publish_at: timestampSchema.nullable().optional(),
  expires_at: timestampSchema.nullable().optional(),
  requires_acknowledgement: z.boolean().optional(),
  audience_scope: audienceScopeSchema.optional(),
  audience_role_ids: audienceRoleIdsSchema.optional(),
}).strict()
  .refine((value) => Object.keys(value).some((key) => key !== "expected_revision_token"), {
    message: "At least one important notice field is required",
  })
  .refine((value) => (value.audience_scope === undefined) === (value.audience_role_ids === undefined), {
    message: "Audience scope and role IDs must be updated together",
  })
  .refine((value) => value.audience_scope === undefined || audienceIsConsistent({
    audience_scope: value.audience_scope,
    audience_role_ids: value.audience_role_ids ?? [],
  }), { message: "Important notice audience is invalid" });

export const importantNoticeActiveSchema = z.object({
  id: z.string(),
  title: titleSchema,
  body_json: bodySchema,
  published_at: timestampSchema,
  expires_at: timestampSchema.nullable(),
  requires_acknowledgement: z.boolean(),
  read_at: timestampSchema.nullable(),
  acknowledged_at: timestampSchema.nullable(),
}).strict();

export const importantNoticeActiveResponseSchema = z.object({
  data: z.array(importantNoticeActiveSchema),
}).strict();

export const importantNoticeAcknowledgementResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export const markImportantNoticesReadSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  all: z.literal(true).optional(),
}).strict().refine((value) => (value.all === true) !== (value.ids !== undefined), {
  message: "Provide either notice IDs or all",
});

export const importantNoticeReadResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
}).strict();

export const importantNoticeAudienceRoleSchema = z.object({
  id: roleIdSchema,
  name: z.string().min(1).max(LIMITS.content.roleName.max),
  color: z.string().nullable(),
  level: z.number().int().min(1).max(1_000),
}).strict();

export const importantNoticeAudienceRolesResponseSchema = z.object({
  data: z.array(importantNoticeAudienceRoleSchema),
}).strict();

export const importantNoticeOkResponseSchema = z.object({
  ok: z.literal(true),
}).strict();
