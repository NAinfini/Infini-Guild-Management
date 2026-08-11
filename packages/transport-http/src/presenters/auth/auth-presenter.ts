import {
  authSessionResponseSchema,
  permissionSetToRecord,
  userSchema,
  verifyInviteResponseSchema,
  type MemberProfile,
  type User,
} from "@guild/shared";
import type { AuthUserRecord } from "@guild/server/modules/auth";

export function presentAuthUser(user: AuthUserRecord): User {
  return userSchema.parse({
    id: user.id,
    username: user.username,
    role: user.roleId,
    role_name: user.roleName,
    role_color: user.roleColor,
    role_level: user.roleLevel,
    permissions: permissionSetToRecord(user.permissions),
    is_active: user.isActive,
    deleted_at: user.deletedAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
}

export function presentAuthSession(input: Readonly<{ user: AuthUserRecord; profile: MemberProfile }>) {
  return authSessionResponseSchema.parse({
    user: presentAuthUser(input.user),
    profile: input.profile,
  });
}

export function presentInviteVerification(input: Readonly<{
  valid: boolean;
  roleId?: string;
  roleName?: string;
  roleColor?: string | null;
  roleLevel?: number;
}>) {
  return input.valid
    ? verifyInviteResponseSchema.parse({
        valid: true,
        role_id: input.roleId,
        role_name: input.roleName,
        role_color: input.roleColor,
        role_level: input.roleLevel,
      })
    : { valid: false as const };
}
