import { z } from "zod";
import { LIMITS } from "../config/limits";

export const roleIdSchema = z
  .string()
  .min(1)
  .max(LIMITS.content.roleName.max)
  .regex(/^[a-z0-9_-]+$/);

export const roleMetadataSchema = z.object({
  role_name: z.string().min(1).max(LIMITS.content.roleName.max),
  role_color: z.string().nullable(),
  role_level: z.number().int().min(1).max(1_000),
});

export const roleAssignmentSchema = z.object({
  role: roleIdSchema,
}).strict();
