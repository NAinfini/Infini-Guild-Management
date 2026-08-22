import { z } from "zod";
import { LIMITS } from "../config/limits";
import { roleIdSchema, roleMetadataSchema } from "./role";
import { memberProfileSchema, userSchema } from "./user";

const L = LIMITS.content;

const usernameSchema = z.string().min(L.username.min).max(L.username.max).regex(/^[a-zA-Z0-9_一-鿿]+$/);

export const INVITE_CODE_LENGTH = 10;
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{10}$/;
export const inviteCodeSchema = z.string().length(INVITE_CODE_LENGTH).regex(INVITE_CODE_PATTERN);

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(L.password.max),
  stay_logged_in: z.boolean().optional(),
}).strict();

export const registerSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(L.password.min).max(L.password.max),
    confirmPassword: z.string().min(L.password.min).max(L.password.max),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(L.password.min).max(L.password.max),
    confirmNewPassword: z.string().min(L.password.min).max(L.password.max),
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Passwords do not match",
  });

export const changeUsernameSchema = z.object({
  currentPassword: z.string().min(1),
  newUsername: usernameSchema,
});

export const verifyInviteResponseSchema = z.discriminatedUnion("valid", [
  z.object({ valid: z.literal(false) }),
  z.object({
    valid: z.literal(true),
    role_id: roleIdSchema,
  }).extend(roleMetadataSchema.shape),
]);

export const usernameAvailabilityResponseSchema = z.object({
  available: z.boolean(),
  reason: z.enum(["invalid_format", "reserved_prefix", "already_taken"]).optional(),
}).strict();

export const authSessionResponseSchema = z.object({
  user: userSchema,
  profile: memberProfileSchema,
}).strict();

export const logoutResponseSchema = z.object({ ok: z.literal(true) }).strict();

export const loginLockErrorDetailsSchema = z.object({
  retry_after_seconds: z.number().int().positive(),
  locked_until: z.string().datetime({ offset: true }),
}).strict();

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
