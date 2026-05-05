import { z } from "zod";
import { PERMISSIONS } from "../constants/roles";

const usernameSchema = z.string().min(1).max(50).regex(/^[a-zA-Z0-9_一-鿿]+$/);
const permissionKeySchema = z.enum(PERMISSIONS);

export const inviteLinkSchema = z.object({
  id: z.string(),
  code: z.string(),
  created_by: z.string(),
  max_uses: z.number().int().positive(),
  used_count: z.number().int().min(0),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string(),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
});

export const inviteLinkStatsSchema = z.object({
  id: z.string(),
  used_count: z.number().int().min(0),
  max_uses: z.number().int().positive(),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
});

export const createInviteLinkSchema = z.object({
  max_uses: z.number().int().positive(),
  expires_at: z.string().datetime().optional(),
});

export const auditLogSchema = z.object({
  id: z.string(),
  entity_type: z.string(),
  action: z.string(),
  actor_id: z.string(),
  entity_id: z.string(),
  diff_title: z.string().nullable(),
  detail_text: z.string().nullable(),
  created_at: z.string(),
});


export const batchRoleChangeSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
  new_role: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/),
});

export const batchDeactivateSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
});

export const createAdminMemberSchema = z.object({
  username: usernameSchema,
});

export const rolePermissionsSchema = z.record(permissionKeySchema, z.boolean());

export const adminRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int().min(1).max(3),
  color: z.string().nullable(),
  is_builtin: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  permissions: rolePermissionsSchema,
  assigned_user_count: z.number().int().min(0),
});

export const createRoleSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  name: z.string().min(1).max(80),
  level: z.number().int().min(1).max(3),
  color: z.string().min(1).max(32).nullable().optional(),
  permissions: rolePermissionsSchema.optional(),
});

export const updateRoleSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    level: z.number().int().min(1).max(3).optional(),
    color: z.string().min(1).max(32).nullable().optional(),
    permissions: rolePermissionsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one role field is required",
  });

export const analyticsSettingsSchema = z.object({
  reference_duration_minutes: z.number().positive().optional(),
  modifier_weights: z.record(z.string(), z.number()).optional(),
});
