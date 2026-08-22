import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import {
  PERMISSIONS,
  PERMISSION_ID,
  type Permission,
} from "@guild/shared/constants/roles";
import type { AccountProvisioningStore, AuthStore, InviteRecord, ManagedUserTarget, RoleRecord } from "./auth-types";
import { IdentityAdminService } from "./identity-admin-service";
import { createInviteTokenCodec, digestToken } from "./crypto";
import type { AuditEventWrite } from "../audit/public.js";

const NOW = "2026-08-09T12:00:00.000Z";
const target: ManagedUserTarget = {
  id: "target", username: "Target", roleId: "member", roleLevel: 100,
  rolePermissions: new Set(), isActive: true, deletedAt: null,
  revisionToken: "user-v1", roleRevisionToken: "member-v1",
};
const destination: RoleRecord = {
  id: "officer", name: "Officer", level: 200, color: null,
  permissions: new Set(), assignedUserCount: 0, revisionToken: "officer-v1",
  createdAt: NOW, updatedAt: NOW,
};
const memberRole: RoleRecord = {
  ...destination,
  id: "member",
  name: "Member",
  level: 100,
  revisionToken: "member-v1",
};
const adminRole: RoleRecord = {
  id: "admin", name: "Admin", level: 1_000, color: "red",
  permissions: new Set(PERMISSIONS), assignedUserCount: 1, revisionToken: "admin-role-v1",
  createdAt: NOW, updatedAt: NOW,
};
const managerTarget: ManagedUserTarget = {
  ...target,
  id: "manager-2",
  username: "Manager Two",
  roleId: "manager",
  roleLevel: 500,
  rolePermissions: new Set([PERMISSION_ID.ADMIN_ROLES_MANAGE]),
  roleRevisionToken: "manager-role-v1",
};
const invite: InviteRecord = {
  id: "invite-123",
  createdBy: "admin",
  roleId: destination.id,
  roleName: destination.name,
  roleColor: destination.color,
  roleLevel: destination.level,
  maxUses: 3,
  usedCount: 0,
  expiresAt: null,
  createdAt: NOW,
  revokedAt: null,
};

function context(input: Readonly<{
  userId?: string;
  roleId?: string;
  roleLevel?: number;
  permissions?: readonly Permission[];
}> = {}) {
  return createRequestContext({
    requestId: "request-1", now: NOW,
    authorization: createAuthorizationContext({
      userId: input.userId ?? "admin",
      sessionId: "session",
      roleId: input.roleId ?? "admin",
      roleLevel: input.roleLevel ?? 1_000,
      permissions: input.permissions ?? [PERMISSION_ID.ADMIN_USERS_ROLE, PERMISSION_ID.ADMIN_USERS_ACTIVATE],
    }),
  });
}

function service(
  store: Partial<AuthStore>,
  provisioning: Partial<AccountProvisioningStore> = {},
) {
  return new IdentityAdminService({
    store: store as AuthStore,
    provisioning: provisioning as AccountProvisioningStore,
    inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
  });
}

describe("account provisioning boundary", () => {
  it("uses the explicit provisioning store for administrator-created members", async () => {
    const createManagedUser = vi.fn().mockResolvedValue("created");
    const value = service(
      { findRole: vi.fn().mockResolvedValue(destination) },
      { createManagedUser },
    );
    const result = await value.createMember(
      context({ permissions: [PERMISSION_ID.ADMIN_USERS_EDIT] }),
      { username: "New Member", roleId: destination.id },
    );
    expect(result).toMatchObject({ ok: true, username: "New Member" });
    expect(createManagedUser).toHaveBeenCalledOnce();
  });
});

describe("invite search", () => {
  it("creates and relists one stable ten-character public code", async () => {
    let storedInvite = invite;
    const createInvite = vi.fn(async (input: { id: string }, _audit: AuditEventWrite) => {
      storedInvite = { ...invite, id: input.id };
      return storedInvite;
    });
    const listInvites = vi.fn(async () => ({ data: [storedInvite], nextCursor: null, total: 1 }));
    const value = service({
      findRole: vi.fn(async () => destination),
      createInvite,
      listInvites,
    });
    const request = context({ permissions: [PERMISSION_ID.ADMIN_INVITE_MANAGE, PERMISSION_ID.ADMIN_INVITE_VIEW] });

    const created = await value.createInvite(request, {
      roleId: destination.id,
      maxUses: 3,
      expiresAt: null,
    });
    const listed = await value.listInvites(request, { visibility: "active", limit: 50 });

    expect(created.code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(listed.data[0]?.code).toBe(created.code);
    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ tokenDigest: await digestToken(created.code) }),
      expect.anything(),
    );
    expect(createInvite.mock.calls[0]![1].payload.context).toEqual([
      { field: "role_id", value: { type: "reference", value: { id: destination.id, label: destination.name } } },
      { field: "role_name", value: { type: "text", value: destination.name } },
      { field: "max_uses", value: { type: "number", value: 3 } },
      { field: "used_count", value: { type: "number", value: 0 } },
      { field: "expires_at", value: { type: "null", value: null } },
      { field: "status", value: { type: "code", value: "active" } },
    ]);
  });

  it("uses a full invite code digest for an exact indexed lookup", async () => {
    const listInvites = vi.fn().mockResolvedValue({ data: [], nextCursor: null, total: 0 });
    const inviteTokens = createInviteTokenCodec("0123456789abcdef0123456789abcdef");
    const code = await inviteTokens.encode("invite-123");
    const value = service({ listInvites });

    await value.listInvites(
      context({ permissions: [PERMISSION_ID.ADMIN_INVITE_VIEW] }),
      { visibility: "active", limit: 50, search: code },
    );

    expect(listInvites).toHaveBeenCalledWith({
      visibility: "active",
      limit: 50,
      cursor: null,
      search: "",
      exactTokenDigest: await digestToken(code),
      now: NOW,
    });
  });

  it("keeps short text as portable LIKE search and rejects invalid long text", async () => {
    const listInvites = vi.fn().mockResolvedValue({ data: [], nextCursor: null, total: 0 });
    const value = service({ listInvites });
    const request = context({ permissions: [PERMISSION_ID.ADMIN_INVITE_VIEW] });

    await value.listInvites(request, { visibility: "active", limit: 50, search: " Member " });
    expect(listInvites).toHaveBeenLastCalledWith(expect.objectContaining({ search: "member" }));

    await expect(value.listInvites(request, {
      visibility: "active",
      limit: 50,
      search: "not-a-valid-code".repeat(6),
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(listInvites).toHaveBeenCalledTimes(1);
  });

  it("audits invite lifecycle state without exposing the public code", async () => {
    const revokeInvite = vi.fn().mockResolvedValue(true);
    const deleteInvite = vi.fn().mockResolvedValue(true);
    const value = service({
      findInvite: vi.fn().mockResolvedValue(invite),
      revokeInvite,
      deleteInvite,
    });
    const request = context({ permissions: [PERMISSION_ID.ADMIN_INVITE_MANAGE] });

    await value.revokeInvite(request, invite.id);
    await value.deleteInvite(request, invite.id);

    const revokeAudit = revokeInvite.mock.calls[0]![2];
    expect(revokeAudit.payload.changes).toEqual([{
      field: "status",
      before: { type: "code", value: "active" },
      after: { type: "code", value: "revoked" },
    }]);
    expect(revokeAudit.payload.context.map(({ field }: { field: string }) => field))
      .toEqual(["role_id", "role_name", "max_uses", "used_count", "expires_at"]);
    const publicCode = await createInviteTokenCodec("0123456789abcdef0123456789abcdef").encode(invite.id);
    expect(JSON.stringify(revokeAudit.payload)).not.toContain(publicCode);
    expect(deleteInvite.mock.calls[0]![1].payload.context.at(-1)).toEqual({
      field: "status",
      value: { type: "code", value: "active" },
    });
  });
});

describe("IdentityAdminService guarded writes", () => {
  it("maps a stale target or destination role to a 409", async () => {
    const value = service({
      findManagedUsers: async () => [target],
      findRole: async () => destination,
      countActiveRoleManagers: async () => 1,
      countActiveRoleManagersAmong: async () => 0,
      setUsersRole: async () => "conflict",
    });
    await expect(value.updateUserRole(context(), target.id, destination.id))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("keeps batch lifecycle policy aligned with the single-user path", async () => {
    const value = service({ findManagedUsers: async () => [{ ...target, deletedAt: NOW }] });
    await expect(value.batchReactivate(context(), [target.id]))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("stores both role names in a single-user role change", async () => {
    const setUsersRole = vi.fn().mockResolvedValue("updated");
    const value = service({
      findManagedUsers: vi.fn().mockResolvedValue([target]),
      findRole: vi.fn(async (id: string) => id === memberRole.id ? memberRole : destination),
      countActiveRoleManagers: vi.fn().mockResolvedValue(1),
      countActiveRoleManagersAmong: vi.fn().mockResolvedValue(0),
      setUsersRole,
    });

    await value.updateUserRole(context(), target.id, destination.id);
    expect(setUsersRole.mock.calls[0]![1].payload.changes).toEqual([{
      field: "role_id",
      before: { type: "reference", value: { id: memberRole.id, label: memberRole.name } },
      after: { type: "reference", value: { id: destination.id, label: destination.name } },
    }]);
  });

  it("keeps the safe role snapshot when deleting a role", async () => {
    const deleteRole = vi.fn().mockResolvedValue("deleted");
    const role = {
      ...destination,
      color: "#336699",
      permissions: new Set<Permission>([PERMISSION_ID.ADMIN_INVITE_VIEW]),
    };
    const value = service({ findRole: vi.fn().mockResolvedValue(role), deleteRole });

    await value.deleteRole(
      context({ permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      role.id,
    );

    expect(deleteRole.mock.calls[0]![1].payload.context).toEqual([
      { field: "level", value: { type: "number", value: role.level } },
      { field: "color", value: { type: "text", value: role.color } },
      { field: "permissions", value: { type: "list", value: [
        { type: "code", value: PERMISSION_ID.ADMIN_INVITE_VIEW },
      ] } },
      { field: "assigned_user_count", value: { type: "number", value: role.assignedUserCount } },
    ]);
  });
});

describe("dynamic role hierarchy", () => {
  it("allows assigning the actor's exact role to a lower-level user", async () => {
    const setUsersRole = vi.fn(async () => "updated" as const);
    const value = service({
      findManagedUsers: async () => [target],
      findRole: async () => adminRole,
      setUsersRole,
    });
    await expect(value.updateUserRole(context({ permissions: PERMISSIONS }), target.id, adminRole.id))
      .resolves.toEqual({ ok: true });
    expect(setUsersRole).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [target], destinationRole: adminRole }),
      expect.anything(),
    );
  });

  it("rejects a different role at the actor's level and every same-level user target", async () => {
    const peerRole = { ...adminRole, id: "peer-admin", name: "Peer Admin" };
    const value = service({
      findManagedUsers: async () => [{ ...target, id: "peer", roleId: "peer-admin", roleLevel: 1_000 }],
      findRole: async () => peerRole,
    });
    await expect(value.updateUserRole(context(), "peer", peerRole.id))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("protects the last active role manager but allows removal when another remains", async () => {
    const setUsersActive = vi.fn(async () => "updated" as const);
    const last = service({
      findManagedUsers: async () => [managerTarget],
      countActiveRoleManagers: async () => 1,
      countActiveRoleManagersAmong: async () => 1,
      setUsersActive,
    });
    await expect(last.setUserActive(context(), managerTarget.id, false))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409, message: "At least one active role manager is required" });
    expect(setUsersActive).not.toHaveBeenCalled();

    const multiple = service({
      findManagedUsers: async () => [managerTarget],
      countActiveRoleManagers: async () => 2,
      countActiveRoleManagersAmong: async () => 1,
      setUsersActive,
    });
    await expect(multiple.setUserActive(context(), managerTarget.id, false)).resolves.toEqual({ ok: true });
    expect(setUsersActive).toHaveBeenCalledOnce();
  });
});
