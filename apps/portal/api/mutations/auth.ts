import {
  accountSecurityResponseSchema,
  authSessionResponseSchema,
  changeLoginNameSchema,
  changePasswordSchema,
  completePasswordResetSchema,
  linkedOAuthProviderSchema,
  loginSchema,
  registerSchema,
  removeEmailSchema,
  requestEmailVerificationSchema,
  resendEmailVerificationSchema,
  verifyEmailSchema,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type LoginPayload = z.input<typeof loginSchema>;
export type RegisterPayload = z.input<typeof registerSchema>;
export type AccountSecurity = z.infer<typeof accountSecurityResponseSchema>;
export type OAuthProvider = z.infer<typeof linkedOAuthProviderSchema>;

export function login(payload: LoginPayload): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>("/api/auth/login", { method: "POST", bodyJson: loginSchema.parse(payload) });
}

export function logout(): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export function register(inviteCode: string, payload: RegisterPayload): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>(`/api/auth/register/${encodeURIComponent(inviteCode)}`, {
    method: "POST",
    bodyJson: registerSchema.parse(payload),
  });
}

export function getAccountSecurity(): Promise<AccountSecurity> {
  return apiRequest<AccountSecurity>("/api/auth/security");
}

export function changePassword(payload: z.input<typeof changePasswordSchema>): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/security/password", {
    method: "PATCH",
    bodyJson: changePasswordSchema.parse(payload),
  });
}

export function changeLoginName(payload: z.input<typeof changeLoginNameSchema>): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/security/login-name", {
    method: "PATCH",
    bodyJson: changeLoginNameSchema.parse(payload),
  });
}

export function completePasswordReset(payload: z.input<typeof completePasswordResetSchema>): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>("/api/auth/complete-password-reset", {
    method: "POST",
    bodyJson: completePasswordResetSchema.parse(payload),
  });
}

export function startOAuth(provider: OAuthProvider, currentPassword?: string): Promise<{ authorization_url: string }> {
  return apiRequest<{ authorization_url: string }>(`/api/auth/oauth/${provider}/start`, {
    method: "POST",
    bodyJson: currentPassword ? { current_password: currentPassword } : {},
  });
}

export function unlinkOAuth(provider: OAuthProvider, currentPassword: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/auth/security/oauth/${provider}`, {
    method: "DELETE",
    bodyJson: { current_password: currentPassword },
  });
}

export function requestEmailVerification(payload: z.input<typeof requestEmailVerificationSchema>): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/security/email", {
    method: "POST",
    bodyJson: requestEmailVerificationSchema.parse(payload),
  });
}

export function resendEmailVerification(payload: z.input<typeof resendEmailVerificationSchema>): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/security/email/resend", {
    method: "POST",
    bodyJson: resendEmailVerificationSchema.parse(payload),
  });
}

export function verifyEmail(token: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/security/email/verify", {
    method: "POST",
    bodyJson: verifyEmailSchema.parse({ token }),
  });
}

export function removeEmail(currentPassword: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/security/email", {
    method: "DELETE",
    bodyJson: removeEmailSchema.parse({ current_password: currentPassword }),
  });
}
