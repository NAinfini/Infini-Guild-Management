import { z } from "zod";
import { LIMITS } from "../config/limits";
import { roleIdSchema, roleMetadataSchema } from "./role";

const L = LIMITS.content;

const usernameSchema = z.string().min(L.username.min).max(L.username.max).regex(/^[a-zA-Z0-9_一-鿿]+$/);

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(L.password.max),
});

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
