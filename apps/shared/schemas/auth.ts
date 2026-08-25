import { z } from "zod";
import { LIMITS } from "../config/limits";
import { roleIdSchema, roleMetadataSchema } from "./role";
import { memberProfileSchema, userSchema } from "./user";
import { identityNameSchema } from "./identity";

export { identityNameSchema } from "./identity";

const L = LIMITS.content;

export const INVITE_CODE_LENGTH = 10;
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{10}$/;
export const inviteCodeSchema = z.string().length(INVITE_CODE_LENGTH).regex(INVITE_CODE_PATTERN);

export const loginSchema = z.object({
  login_name: identityNameSchema,
  password: z.string().min(1).max(L.password.max),
  stay_logged_in: z.boolean().optional(),
}).strict();

export const registerSchema = z
  .object({
    login_name: identityNameSchema,
    display_name: identityNameSchema,
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

export const changeLoginNameSchema = z.object({
  currentPassword: z.string().min(1),
  login_name: identityNameSchema,
}).strict();

export const verifyInviteResponseSchema = z.discriminatedUnion("valid", [
  z.object({ valid: z.literal(false) }),
  z.object({
    valid: z.literal(true),
    role_id: roleIdSchema,
  }).extend(roleMetadataSchema.shape),
]);

export const authSessionResponseSchema = z.object({
  user: userSchema,
  profile: memberProfileSchema,
  session_scope: z.enum(["normal", "password_change"]),
}).strict();

export const logoutResponseSchema = z.object({ ok: z.literal(true) }).strict();

export const linkedOAuthProviderSchema = z.enum(["google", "discord", "kook", "wechat"]);

export const accountSecurityResponseSchema = z.object({
  login_name: identityNameSchema,
  display_name: identityNameSchema,
  oauth_providers: z.array(linkedOAuthProviderSchema),
  email: z.string().email().nullable(),
  email_available: z.boolean(),
}).strict();

export const oauthStartSchema = z.object({
  current_password: z.string().min(1).optional(),
}).strict();

export const completePasswordResetSchema = z.object({
  login_name: identityNameSchema,
  new_password: z.string().min(L.password.min).max(L.password.max),
  confirm_new_password: z.string().min(L.password.min).max(L.password.max),
}).strict().refine((value) => value.new_password === value.confirm_new_password, {
  path: ["confirm_new_password"],
  message: "Passwords do not match",
});

export const requestEmailVerificationSchema = z.object({
  current_password: z.string().min(1),
  email: z.string().trim().email().max(320),
}).strict();

export const resendEmailVerificationSchema = z.object({ current_password: z.string().min(1) }).strict();
export const verifyEmailSchema = z.object({ token: z.string().min(32).max(512) }).strict();
export const removeEmailSchema = z.object({ current_password: z.string().min(1) }).strict();

export const loginLockErrorDetailsSchema = z.object({
  retry_after_seconds: z.number().int().positive(),
  locked_until: z.string().datetime({ offset: true }),
}).strict();

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
