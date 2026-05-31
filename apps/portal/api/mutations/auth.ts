import { apiRequest } from "../client";
import type { MemberProfile, User } from "@guild/shared";

export type AuthSessionResponse = { user: User; profile: MemberProfile };
export type LoginPayload = {
  username: string;
  password: string;
  stay_logged_in?: boolean;
};
export type RegisterPayload = {
  username: string;
  password: string;
  confirmPassword: string;
};

export function login(payload: LoginPayload): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>("/api/auth/login", {
    method: "POST",
    bodyJson: payload,
  });
}

export function logout(): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/logout", {
    method: "POST",
  });
}

export async function register(inviteCode: string, payload: RegisterPayload): Promise<AuthSessionResponse> {
  await apiRequest<{ user: User }>(`/api/auth/register/${inviteCode}`, {
    method: "POST",
    bodyJson: payload,
  });
  return apiRequest<AuthSessionResponse>("/api/auth/me");
}
