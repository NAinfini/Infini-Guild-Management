import {
  adminRoleSchema,
  inviteLinkSchema,
  permissionSetToRecord,
} from "@guild/shared";
import type { InviteRecord, RoleRecord } from "@guild/server/modules/auth";

function inviteWire(invite: InviteRecord) {
  return {
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
  };
}

export function presentInvite(invite: InviteRecord) {
  return inviteLinkSchema.parse(inviteWire(invite));
}

export function presentInvitePage(page: Readonly<{
  data: readonly InviteRecord[];
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
    revision_token: role.revisionToken,
  });
}
