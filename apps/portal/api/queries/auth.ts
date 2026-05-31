import { apiRequest } from "../client";

export function verifyInvite(inviteCode: string): Promise<{ valid: boolean }> {
  return apiRequest<{ valid: boolean }>(`/api/auth/verify-invite/${encodeURIComponent(inviteCode)}`);
}

export function checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
  return apiRequest<{ available: boolean; reason?: string }>(
    `/api/auth/check-username?username=${encodeURIComponent(username)}`,
  );
}
