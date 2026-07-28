import type { InviteLink } from "@guild/shared";

export type InviteStatus = "revoked" | "fullyUsed" | "expired" | "active";

export function resolveInviteStatus(
  invite: Pick<InviteLink, "revoked_at" | "used_count" | "max_uses" | "expires_at">,
  now = Date.now(),
): InviteStatus {
  if (invite.revoked_at) return "revoked";
  if (invite.used_count >= invite.max_uses) return "fullyUsed";
  if (invite.expires_at && Date.parse(invite.expires_at) <= now) return "expired";
  return "active";
}
