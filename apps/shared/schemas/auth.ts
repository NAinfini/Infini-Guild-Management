import { z } from "zod";

const usernameSchema = z.string().min(1).max(50).regex(/^[a-zA-Z0-9_一-鿿]+$/);

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});

export const registerSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
    confirmNewPassword: z.string().min(8).max(128),
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Passwords do not match",
  });

export const changeUsernameSchema = z.object({
  currentPassword: z.string().min(1),
  newUsername: usernameSchema,
});
