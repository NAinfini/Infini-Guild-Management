import { z } from "zod";
import { PERMISSIONS } from "../constants/roles";
import { AUDIT_ENTITY_TYPES, AUDIT_ACTIONS } from "../constants/audit";
import { LIMITS } from "../config/limits";
import { roleIdSchema, roleMetadataSchema } from "./role";
import { siteAnalyticsModifierWeightsSchema } from "./site-config";
import { jsonObjectSchema } from "./json";

const L_admin = LIMITS.content;
const usernameSchema = z.string().min(L_admin.username.min).max(L_admin.username.max).regex(/^[a-zA-Z0-9_一-鿿]+$/);
const permissionKeySchema = z.enum(PERMISSIONS);
const colorSchema = z.string().min(1).max(32).regex(/^[a-zA-Z0-9#()., %]+$/);

export const inviteLinkSchema = z.object({
  id: z.string(),
  code: z.string(),
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

export const auditLogSchema = z.object({
  id: z.string(),
  entity_type: z.enum(AUDIT_ENTITY_TYPES),
  action: z.enum(AUDIT_ACTIONS),
  actor_id: z.string(),
  actor_username: z.string().nullable().optional(),
  entity_id: z.string(),
  diff_title: z.string().nullable(),
  detail: jsonObjectSchema.nullable(),
  created_at: z.string(),
});


export const batchRoleChangeSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
  new_role: roleIdSchema,
});

export const batchDeactivateSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
});

export const createAdminMemberSchema = z.object({
  username: usernameSchema,
  role_id: roleIdSchema,
}).strict();

export const adminUserLifecycleSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export const resetAdminPasswordSchema = z.object({
  temporary_password: z.string().min(L_admin.password.min).max(L_admin.password.max).optional(),
}).strict();

export const createAdminMemberResponseSchema = z.object({
  ok: z.literal(true),
  user_id: z.string(),
  username: z.string(),
  temporary_password: z.string(),
}).strict();

export const loginLockStateSchema = z.object({
  fail_count: z.number().int().min(0),
  locked_until: z.string().datetime({ offset: true }).nullable(),
  is_locked: z.boolean(),
  retry_after_seconds: z.number().int().min(0),
}).strict();

export const resetLoginLockResponseSchema = loginLockStateSchema.extend({
  ok: z.literal(true),
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
    name: z.string().min(1).max(80).optional(),
    level: z.number().int().min(1).max(1_000).optional(),
    color: colorSchema.nullable().optional(),
    permissions: rolePermissionsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one role field is required",
  });

export const analyticsSettingsSchema = z.object({
  reference_duration_minutes: z.number().positive().max(LIMITS.analytics.referenceDurationMinutes.max).optional(),
  modifier_weights: siteAnalyticsModifierWeightsSchema.partial().optional(),
}).strict();
