import {
  adminRoleSchema,
  inviteLinkSchema,
  loginLockStateSchema,
  permissionSetToRecord,
  resetLoginLockResponseSchema,
} from "@guild/shared";
import type { InviteRecord, LoginLockState, RoleRecord } from "@guild/server/modules/auth";

type InviteWithCode = InviteRecord & Readonly<{ code: string }>;

export function presentInvite(invite: InviteWithCode) {
  return inviteLinkSchema.parse({
    id: invite.id,
    code: invite.code,
    created_by: invite.createdBy,
    role_id: invite.roleId,
    role_name: invite.roleName,
    role_color: invite.roleColor,
    role_level: invite.roleLevel,
    max_uses: invite.maxUses,
    used_count: invite.usedCount,
    expires_at: invite.expiresAt,
    created_at: invite.createdAt,
    revoked_at: invite.revokedAt,
  });
}

export function presentInvitePage(page: Readonly<{
  data: readonly InviteWithCode[];
  nextCursor: string | null;
  total: number;
}>) {
  return {
    data: page.data.map(presentInvite),
    next_cursor: page.nextCursor,
    total: page.total,
  };
}

export function presentRole(role: RoleRecord) {
  return adminRoleSchema.parse({
    id: role.id,
    name: role.name,
    level: role.level,
    color: role.color,
    permissions: permissionSetToRecord(role.permissions),
    assigned_user_count: role.assignedUserCount,
    created_at: role.createdAt,
    updated_at: role.updatedAt,
  });
}

export function presentLoginLock(state: LoginLockState) {
  return loginLockStateSchema.parse({
    fail_count: state.failCount,
    locked_until: state.lockedUntil,
    is_locked: state.isLocked,
    retry_after_seconds: state.retryAfterSeconds,
  });
}

export function presentResetLoginLock(state: LoginLockState & { ok: true }) {
  return resetLoginLockResponseSchema.parse({ ok: true, ...presentLoginLock(state) });
}
