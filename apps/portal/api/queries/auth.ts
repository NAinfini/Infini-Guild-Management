import { apiRequest } from "../client";

export function verifyInvite(inviteCode: string): Promise<{ valid: boolean }> {
  return apiRequest<{ valid: boolean }>(`/api/auth/verify-invite/${encodeURIComponent(inviteCode)}`);
}
