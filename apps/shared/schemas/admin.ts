import { z } from "zod";

export const inviteLinkSchema = z.object({
  id: z.string(),
  code: z.string(),
  created_by: z.string(),
  max_uses: z.number().int().positive(),
  used_count: z.number().int().min(0),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  revoked_at: z.string().nullable(),
});

export const inviteLinkStatsSchema = z.object({
  id: z.string(),
  used_count: z.number().int().min(0),
  max_uses: z.number().int().positive(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
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

export const auditLogQuerySchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().min(1).max(100).default(20),
  filters: z.object({
    date_range: z.object({
      start_at: z.string().datetime(),
      end_at: z.string().datetime(),
    }),
    entity_type: z.string().optional(),
    actor_id: z.string().optional(),
    search: z.string().optional(),
  }),
});

export const batchRoleChangeSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
  new_role: z.enum(["member", "moderator"]),
});

export const batchDeactivateSchema = z.object({
  user_ids: z.array(z.string()).min(1).max(50),
});
