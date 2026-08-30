import { z } from "zod";
import { PERMISSIONS } from "../constants/roles";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AUDIT_FIELDS } from "../constants/audit";
import { LIMITS } from "../config/limits";
import { roleIdSchema, roleMetadataSchema } from "./role";
import { siteAnalyticsModifierWeightsSchema } from "./site-config";
import { identityNameSchema, inviteCodeSchema } from "./auth";
import { adminUpdateProfileSchema } from "./user";

const L_admin = LIMITS.content;
const permissionKeySchema = z.enum(PERMISSIONS);
const colorSchema = z.string().min(1).max(32).regex(/^[a-zA-Z0-9#()., %]+$/);

export const inviteLinkSchema = z.object({
  id: z.string(),
  code: inviteCodeSchema,
  created_by: z.string(),
  role_id: roleIdSchema,
  max_uses: z.number().int().positive(),
  used_count: z.number().int().min(0),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string(),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
}).extend(roleMetadataSchema.shape);

export const inviteLinkStatsSchema = z.object({
  id: z.string(),
  used_count: z.number().int().min(0),
  max_uses: z.number().int().positive(),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
});

export const createInviteLinkSchema = z.object({
  role_id: roleIdSchema,
  max_uses: z.number().int().positive(),
  expires_at: z.string().datetime().optional(),
});

const auditReferenceSchema = z.object({
  id: z.string().min(1).max(512),
  label: z.string().min(1).max(200).nullable(),
}).strict();

export const auditScalarValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: z.string().max(16_384) }).strict(),
  z.object({ type: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ type: z.literal("datetime"), value: z.string().datetime({ offset: true }) }).strict(),
  z.object({ type: z.literal("code"), value: z.string().max(32_768) }).strict(),
  z.object({ type: z.literal("reference"), value: auditReferenceSchema }).strict(),
  z.object({ type: z.literal("null"), value: z.null() }).strict(),
]);

export const auditValueSchema = z.union([
  auditScalarValueSchema,
  z.object({ type: z.literal("list"), value: z.array(auditScalarValueSchema).max(100) }).strict(),
]);

export const auditChangeSchema = z.object({
  field: z.enum(AUDIT_FIELDS),
  before: auditValueSchema,
  after: auditValueSchema,
}).strict();

export const auditContextSchema = z.object({
  field: z.enum(AUDIT_FIELDS),
  value: auditValueSchema,
}).strict();

export const auditPayloadV2Schema = z.object({
  schema_version: z.literal(2),
  changes: z.array(auditChangeSchema).max(100),
  context: z.array(auditContextSchema).max(100),
}).strict();

export const auditActorSchema = z.object({
  kind: z.enum(["user", "system"]),
  id: z.string().min(1).max(512),
  label: z.string().min(1).max(200).nullable(),
}).strict();

export const auditSubjectSchema = z.object({
  type: z.enum(AUDIT_ENTITY_TYPES),
  id: z.string().min(1).max(512),
  label: z.string().min(1).max(200).nullable(),
}).strict();

export const auditEventSchema = z.object({
  event_id: z.string().min(1).max(128),
  request_id: z.string().min(1).max(512),
  actor: auditActorSchema,
  subject: auditSubjectSchema,
  action: z.enum(AUDIT_ACTIONS),
  payload: auditPayloadV2Schema,
  occurred_at: z.string().datetime({ offset: true }),
}).strict();

export const auditEventCursorResponseSchema = z.object({
  data: z.array(auditEventSchema),
  next_cursor: z.string().max(512).nullable(),
}).strict();


export const batchRoleChangeSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
  new_role: roleIdSchema,
});

export const batchDeactivateSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
});

export const createAdminMemberSchema = z.object({
  login_name: identityNameSchema,
  display_name: identityNameSchema,
  role_id: roleIdSchema,
  notes: z.string().max(L_admin.profileNotes.max).nullable().optional(),
}).strict();

const adminMemberProfileEditSchema = adminUpdateProfileSchema.pick({
  power: true,
  classes: true,
  title_html: true,
  bio: true,
  availability: true,
  notes: true,
}).required().strict();

const revisionTokenSchema = z.string().min(1).max(200);

export const updateAdminMemberSchema = z.object({
  expected_user_revision_token: revisionTokenSchema,
  expected_profile_revision_token: revisionTokenSchema,
  display_name: identityNameSchema.optional(),
  profile: adminMemberProfileEditSchema.optional(),
  role_id: roleIdSchema.optional(),
  is_active: z.boolean().optional(),
}).strict().refine(({
  expected_user_revision_token: _userRevisionToken,
  expected_profile_revision_token: _profileRevisionToken,
  ...changes
}) => Object.keys(changes).length > 0, {
  message: "At least one member field is required",
});

export const updateAdminMemberResponseSchema = z.object({
  ok: z.literal(true),
  user_revision_token: revisionTokenSchema,
  profile_revision_token: revisionTokenSchema,
}).strict();

export const adminUserLifecycleSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export const resetAdminPasswordSchema = z.object({
  current_password: z.string().min(1).max(L_admin.password.max),
}).strict();

export const createAdminMemberResponseSchema = z.object({
  ok: z.literal(true),
  user_id: z.string(),
  display_name: z.string(),
  temporary_login_name: identityNameSchema,
  temporary_password: z.string(),
}).strict();

export const resetAdminPasswordResponseSchema = z.object({
  ok: z.literal(true),
  temporary_login_name: identityNameSchema,
  temporary_password: z.string(),
}).strict();

export const adminBatchMutationResponseSchema = z.object({
  ok: z.literal(true),
  updated: z.number().int().min(0),
}).strict();

export const rolePermissionsSchema = z.record(permissionKeySchema, z.boolean());

export const adminRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int().min(1).max(1_000),
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  revision_token: revisionTokenSchema,
  permissions: rolePermissionsSchema,
  assigned_user_count: z.number().int().min(0),
});

export const createRoleSchema = z.object({
  id: roleIdSchema.min(2).optional(),
  name: z.string().min(1).max(80),
  level: z.number().int().min(1).max(1_000),
  color: colorSchema.nullable().optional(),
  permissions: rolePermissionsSchema.optional(),
});

export const updateRoleSchema = z
  .object({
    expected_revision_token: revisionTokenSchema,
    name: z.string().min(1).max(80).optional(),
    level: z.number().int().min(1).max(1_000).optional(),
    color: colorSchema.nullable().optional(),
    permissions: rolePermissionsSchema.optional(),
  })
  .refine(({ expected_revision_token: _revisionToken, ...changes }) => Object.keys(changes).length > 0, {
    message: "At least one role field is required",
  });

export const analyticsSettingsSchema = z.object({
  reference_duration_minutes: z.number().positive().max(LIMITS.analytics.referenceDurationMinutes.max).optional(),
  modifier_weights: siteAnalyticsModifierWeightsSchema.partial().optional(),
}).strict();
