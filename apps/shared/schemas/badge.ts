import { z } from "zod";

const badgeColorSchema = z.string().regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/);

export const memberBadgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  label_html: z.string(),
  color: badgeColorSchema,
  description: z.string().nullable(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createMemberBadgeSchema = z.object({
  name: z.string().min(1).max(80),
  label_html: z.string().min(1).max(2000),
  color: badgeColorSchema.default("#3b82f6"),
  description: z.string().max(500).optional(),
  sort_order: z.number().int().default(0),
});

export const updateMemberBadgeSchema = createMemberBadgeSchema.partial();

export const badgeAssignmentSchema = z.object({
  badge_id: z.string(),
  user_id: z.string(),
  username: z.string().nullable().optional(),
  assigned_by: z.string(),
  assigned_by_username: z.string().nullable().optional(),
  assigned_at: z.string(),
});

export const assignBadgeSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(100),
});

export const unassignBadgeSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(100),
});

export const userBadgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  label_html: z.string(),
  color: badgeColorSchema,
});
