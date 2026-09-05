import { describe, expect, it, vi } from "vitest";
import {
  createAuthorizationContext,
  createRequestContext,
  type DeferredTask,
  type DeferredTasks,
  type NotificationPublisher,
} from "@guild/kernel";
import {
  PERMISSIONS,
  PERMISSION_ID,
  type Permission,
} from "@guild/shared/constants/roles";
import type { AccountProvisioningStore, AuthStore, InviteRecord, ManagedUserTarget, RoleRecord } from "./auth-types";
import { IdentityAdminService } from "./identity-admin-service";
import { createPasswordHash } from "./crypto";
import type { AuditEventWrite } from "../audit/public.js";
import type { MembersStore } from "../members/public.js";
import { NotificationService } from "../notifications/public.js";

const NOW = "2026-08-09T12:00:00.000Z";
const target: ManagedUserTarget = {
  id: "target", displayName: "Target", loginName: "target-login", roleId: "member", roleLevel: 100,
  authRevision: 1,
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
  displayName: "Manager Two",
  loginName: "manager-two",
  roleId: "manager",
  roleLevel: 500,
  rolePermissions: new Set([PERMISSION_ID.ADMIN_ROLES_MANAGE]),
  roleRevisionToken: "manager-role-v1",
};
const invite: InviteRecord = {
  id: "invite-123",
  code: "A1B2C3D4E5",
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

function permissionFlags(enabled: readonly Permission[] = []): Record<Permission, boolean> {
  const enabledPermissions = new Set(enabled);
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission, enabledPermissions.has(permission)])) as Record<Permission, boolean>;
}

function service(
  store: Partial<AuthStore>,
  provisioning: Partial<AccountProvisioningStore> = {},
  memberProfiles: Partial<Pick<MembersStore, "getMemberTarget" | "findMissingClassIds">> = {},
  realtime: Readonly<{
    notifications?: NotificationPublisher;
    deferred?: DeferredTasks;
  }> = {},
) {
  return new IdentityAdminService({
    store: store as AuthStore,
    provisioning: provisioning as AccountProvisioningStore,
    memberProfiles: memberProfiles as Pick<MembersStore, "getMemberTarget" | "findMissingClassIds">,
    ...realtime,
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
      context({ permissions: [PERMISSION_ID.ADMIN_USERS_EDIT, PERMISSION_ID.ADMIN_USERS_ROLE] }),
      {
        loginName: "new-member",
        displayName: "New Member",
        roleId: destination.id,
        notes: "Initial officer note",
      },
    );
    expect(result).toMatchObject({ ok: true, displayName: "New Member", temporaryLoginName: "new-member" });
    expect(createManagedUser).toHaveBeenCalledOnce();
    expect(createManagedUser).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Initial officer note" }),
      expect.anything(),
    );
  });

  it.each([PERMISSION_ID.ADMIN_USERS_EDIT, PERMISSION_ID.ADMIN_USERS_ROLE])(
    "rejects member creation with only %s before provisioning or role lookup",
    async (permission) => {
      const findRole = vi.fn();
      const createManagedUser = vi.fn();
      const value = service({ findRole }, { createManagedUser });

      await expect(value.createMember(context({ permissions: [permission] }), {
        loginName: "new-member",
        displayName: "New Member",
        roleId: destination.id,
      })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(findRole).not.toHaveBeenCalled();
      expect(createManagedUser).not.toHaveBeenCalled();
    },
  );

  it("keeps role hierarchy and unheld-permission guards when creating members", async () => {
    const actor = context({
      roleId: "manager",
      roleLevel: 500,
      permissions: [PERMISSION_ID.ADMIN_USERS_EDIT, PERMISSION_ID.ADMIN_USERS_ROLE],
    });
    for (const role of [
      { ...destination, level: 501 },
      { ...destination, level: 500 },
      { ...destination, permissions: new Set<Permission>([PERMISSION_ID.ADMIN_ROLES_MANAGE]) },
    ]) {
      const createManagedUser = vi.fn();
      const value = service({ findRole: vi.fn().mockResolvedValue(role) }, { createManagedUser });

      await expect(value.createMember(actor, {
        loginName: "new-member",
        displayName: "New Member",
        roleId: role.id,
      })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(createManagedUser).not.toHaveBeenCalled();
    }
  });
});

describe("administrator member edit command", () => {
  it("uses one guarded write for profile, role, and lifecycle changes", async () => {
    const tasks: DeferredTask[] = [];
    const publish = vi.fn().mockResolvedValue(undefined);
    const updateManagedMember = vi.fn().mockResolvedValue("updated");
    const memberTarget = {
      userId: target.id,
      display_name: target.displayName,
      roleId: target.roleId,
      roleLevel: target.roleLevel,
      isActive: target.isActive,
      deletedAt: target.deletedAt,
      revisionToken: target.revisionToken,
      roleRevisionToken: target.roleRevisionToken,
      profileRevisionToken: "profile-v1",
    };
    const value = service({
      findManagedUsers: vi.fn().mockResolvedValue([target]),
      findRole: vi.fn(async (id: string) => id === target.roleId ? memberRole : destination),
      countActiveRoleManagers: vi.fn().mockResolvedValue(2),
      countActiveRoleManagersAmong: vi.fn().mockResolvedValue(0),
    }, { updateManagedMember }, {
      getMemberTarget: vi.fn().mockResolvedValue(memberTarget),
      findMissingClassIds: vi.fn().mockResolvedValue([]),
    }, {
      notifications: new NotificationService({ publish }),
      deferred: { defer: (task) => { tasks.push(task); } },
    });

    await value.updateMember(context({ permissions: [
      PERMISSION_ID.ADMIN_USERS_EDIT,
      PERMISSION_ID.ADMIN_USERS_ROLE,
      PERMISSION_ID.ADMIN_USERS_ACTIVATE,
    ] }), target.id, {
      expectedUserRevisionToken: "user-v1",
      expectedProfileRevisionToken: "profile-v1",
      displayName: "RenamedMember",
      profile: {
        power: 42,
        classes: ["guardian"],
        titleHtml: "<b>Officer</b>",
        bio: "Coordinates raids",
        availability: null,
        notes: "Private officer note",
      },
      roleId: destination.id,
      isActive: false,
    });

    expect(updateManagedMember).toHaveBeenCalledWith(expect.objectContaining({
      target,
      destinationRole: destination,
      active: false,
      displayName: "RenamedMember",
      profile: expect.objectContaining({
        titleHtml: "<b>Officer</b>",
      }),
    }), expect.objectContaining({
      subjectId: target.id,
      action: "update",
    }));
    expect(updateManagedMember).toHaveBeenCalledTimes(1);
    expect(updateManagedMember.mock.calls[0]![1].payload.changes).toContainEqual({
      field: "display_name",
      before: { type: "text", value: target.displayName },
      after: { type: "text", value: "RenamedMember" },
    });
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(publish).toHaveBeenCalledWith({
      type: "authorization_refresh",
      user_ids: [target.id],
    });
  });

  it("rejects an A/B stale composite member save before the atomic writer", async () => {
    const updateManagedMember = vi.fn();
    const currentTarget = { ...target, revisionToken: "user-v2" };
    const currentProfile = {
      userId: target.id,
      display_name: target.displayName,
      roleId: target.roleId,
      roleLevel: target.roleLevel,
      isActive: target.isActive,
      deletedAt: target.deletedAt,
      revisionToken: currentTarget.revisionToken,
      roleRevisionToken: target.roleRevisionToken,
      profileRevisionToken: "profile-v1",
    };
    const value = service({
      findManagedUsers: vi.fn().mockResolvedValue([currentTarget]),
    }, { updateManagedMember }, {
      getMemberTarget: vi.fn().mockResolvedValue(currentProfile),
      findMissingClassIds: vi.fn().mockResolvedValue([]),
    });

    await expect(value.updateMember(
      context({ permissions: [PERMISSION_ID.ADMIN_USERS_EDIT] }),
      target.id,
      {
        expectedUserRevisionToken: "user-v1",
        expectedProfileRevisionToken: "profile-v1",
        profile: { power: 42, classes: [], titleHtml: null, bio: "A draft", availability: null, notes: null },
      },
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(updateManagedMember).not.toHaveBeenCalled();
  });

  it("rejects reserved display names and maps duplicate names from the atomic writer to conflicts", async () => {
    const updateManagedMember = vi.fn().mockResolvedValue("display_name_taken");
    const memberTarget = {
      userId: target.id,
      display_name: target.displayName,
      roleId: target.roleId,
      roleLevel: target.roleLevel,
      isActive: target.isActive,
      deletedAt: target.deletedAt,
      revisionToken: target.revisionToken,
      roleRevisionToken: target.roleRevisionToken,
      profileRevisionToken: "profile-v1",
    };
    const value = service({
      findManagedUsers: vi.fn().mockResolvedValue([target]),
      countActiveRoleManagers: vi.fn().mockResolvedValue(2),
      countActiveRoleManagersAmong: vi.fn().mockResolvedValue(0),
    }, { updateManagedMember }, {
      getMemberTarget: vi.fn().mockResolvedValue(memberTarget),
    });
    const request = context({ permissions: [PERMISSION_ID.ADMIN_USERS_EDIT] });

    await expect(value.updateMember(request, target.id, {
      expectedUserRevisionToken: "user-v1",
      expectedProfileRevisionToken: "profile-v1",
      displayName: "systemtest_reserved",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(updateManagedMember).not.toHaveBeenCalled();

    await expect(value.updateMember(request, target.id, {
      expectedUserRevisionToken: "user-v1",
      expectedProfileRevisionToken: "profile-v1",
      displayName: "TakenName",
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(updateManagedMember).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "TakenName",
    }), expect.anything());
  });

  it("rejects a role field before the atomic writer when the actor cannot assign roles", async () => {
    const updateManagedMember = vi.fn();
    const value = service({
      findManagedUsers: vi.fn().mockResolvedValue([target]),
      findRole: vi.fn().mockResolvedValue(destination),
    }, { updateManagedMember });

    await expect(value.updateMember(
      context({ permissions: [PERMISSION_ID.ADMIN_USERS_EDIT] }),
      target.id,
      { expectedUserRevisionToken: "user-v1", expectedProfileRevisionToken: "profile-v1", roleId: destination.id },
    )).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(updateManagedMember).not.toHaveBeenCalled();
  });

  it("keeps the final active role manager before dispatching the composite command", async () => {
    const updateManagedMember = vi.fn();
    const value = service({
      findManagedUsers: vi.fn().mockResolvedValue([managerTarget]),
      findRole: vi.fn(async (id: string) => id === managerTarget.roleId ? {
        ...destination,
        id: managerTarget.roleId,
        permissions: new Set([PERMISSION_ID.ADMIN_ROLES_MANAGE]),
      } : memberRole),
      countActiveRoleManagers: vi.fn().mockResolvedValue(1),
      countActiveRoleManagersAmong: vi.fn().mockResolvedValue(1),
    }, { updateManagedMember }, {
      getMemberTarget: vi.fn().mockResolvedValue({
        userId: managerTarget.id,
        display_name: managerTarget.displayName,
        roleId: managerTarget.roleId,
        roleLevel: managerTarget.roleLevel,
        isActive: managerTarget.isActive,
        deletedAt: managerTarget.deletedAt,
        revisionToken: managerTarget.revisionToken,
        roleRevisionToken: managerTarget.roleRevisionToken,
        profileRevisionToken: "profile-v1",
      }),
      findMissingClassIds: vi.fn().mockResolvedValue([]),
    });

    await expect(value.updateMember(context({ permissions: [
      PERMISSION_ID.ADMIN_USERS_ROLE,
      PERMISSION_ID.ADMIN_USERS_ACTIVATE,
    ] }), managerTarget.id, {
      expectedUserRevisionToken: "user-v1",
      expectedProfileRevisionToken: "profile-v1",
      roleId: memberRole.id,
      isActive: false,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(updateManagedMember).not.toHaveBeenCalled();
  });
});

describe("administrator credential reset", () => {
  it("rejects an incorrect administrator password before reading or mutating the target", async () => {
    const findManagedUsers = vi.fn();
    const setTemporaryPassword = vi.fn();
    const value = service({
      findCredentialRecord: vi.fn(async () => ({
        loginName: "admin-login",
        passwordHash: await createPasswordHash("correct administrator password"),
        authRevision: 1,
      })),
      findManagedUsers,
      setTemporaryPassword,
    });

    await expect(value.resetPassword(
      context({ permissions: [PERMISSION_ID.ADMIN_USERS_PASSWORD] }),
      "target",
      "wrong administrator password",
    )).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(findManagedUsers).not.toHaveBeenCalled();
    expect(setTemporaryPassword).not.toHaveBeenCalled();
  });

  it("binds the reset to the same administrator credential revision that confirmed the password", async () => {
    const setTemporaryPassword = vi.fn().mockResolvedValue("updated");
    const value = service({
      findCredentialRecord: vi.fn(async () => ({
        loginName: "admin-login",
        passwordHash: await createPasswordHash("correct administrator password"),
        authRevision: 7,
      })),
      findManagedUsers: vi.fn(async () => [target]),
      setTemporaryPassword,
    });

    await expect(value.resetPassword(
      context({ permissions: [PERMISSION_ID.ADMIN_USERS_PASSWORD] }),
      target.id,
      "correct administrator password",
    )).resolves.toMatchObject({ ok: true });

    expect(setTemporaryPassword).toHaveBeenCalledWith(expect.objectContaining({
      target,
      actorUserId: "admin",
      expectedActorAuthRevision: 7,
    }));
  });
});

describe("invite codes", () => {
  it("creates one 10-character code, returns it in invite lists, and keeps it out of audit data", async () => {
    let storedInvite = invite;
    const createInvite = vi.fn(async (input: { id: string; code: string }, _audit: AuditEventWrite) => {
      storedInvite = { ...invite, id: input.id, code: input.code };
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

    expect(created.code).toMatch(/^[A-Z0-9]{10}$/);
    expect(listed.data[0]).toMatchObject({ code: created.code });
    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ code: created.code }),
      expect.anything(),
    );
    expect(JSON.stringify(createInvite.mock.calls[0]![1].payload)).not.toContain(created.code);
    expect(createInvite.mock.calls[0]![1].payload.context).toEqual([
      { field: "role_id", value: { type: "reference", value: { id: destination.id, label: destination.name } } },
      { field: "role_name", value: { type: "text", value: destination.name } },
      { field: "max_uses", value: { type: "number", value: 3 } },
      { field: "used_count", value: { type: "number", value: 0 } },
      { field: "expires_at", value: { type: "null", value: null } },
      { field: "status", value: { type: "code", value: "active" } },
    ]);
  });

  it("uses invite codes as a list lookup", async () => {
    const listInvites = vi.fn().mockResolvedValue({ data: [], nextCursor: null, total: 0 });
    const code = "A1B2C3D4E5";
    const value = service({ listInvites });

    await value.listInvites(
      context({ permissions: [PERMISSION_ID.ADMIN_INVITE_VIEW] }),
      { visibility: "active", limit: 50, search: code },
    );

    expect(listInvites).toHaveBeenCalledWith({
      visibility: "active",
      limit: 50,
      cursor: null,
      search: code.toLowerCase(),
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
      search: "not-a-valid-invite-code".repeat(6),
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(listInvites).toHaveBeenCalledTimes(1);
  });

  it("audits invite lifecycle state without exposing its code", async () => {
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
    expect(JSON.stringify(revokeAudit.payload)).not.toContain(invite.code);
    expect(deleteInvite.mock.calls[0]![1].payload.context.at(-1)).toEqual({
      field: "status",
      value: { type: "code", value: "active" },
    });
  });
});

describe("IdentityAdminService guarded writes", () => {
  it("returns role snapshots from committed writes without a post-commit role read", async () => {
    const created = { ...destination, id: "notice-editor", name: "Notice Editor", revisionToken: "role-create-revision" };
    const createFindRole = vi.fn().mockRejectedValue(new Error("post-commit role read failed"));
    const createRole = vi.fn().mockResolvedValue({ status: "created", role: created });
    const creator = service({ findRole: createFindRole, createRole });

    await expect(creator.createRole(
      context({ permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      { id: created.id, name: created.name, level: created.level },
    )).resolves.toEqual(created);
    expect(createFindRole).not.toHaveBeenCalled();

    const existing = { ...destination, revisionToken: "role-before-revision" };
    const updated = { ...existing, name: "Updated officer", revisionToken: "role-after-revision" };
    const updateFindRole = vi.fn().mockResolvedValueOnce(existing).mockRejectedValue(new Error("post-commit role read failed"));
    const updateRole = vi.fn().mockResolvedValue({ status: "updated", role: updated });
    const editor = service({ findRole: updateFindRole, updateRole });

    await expect(editor.updateRole(
      context({ permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      existing.id,
      { expectedRevisionToken: existing.revisionToken, name: updated.name },
    )).resolves.toEqual(updated);
    expect(updateFindRole).toHaveBeenCalledOnce();
  });

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

  it("rejects an A/B stale role editor before it can restore old permissions", async () => {
    const updateRole = vi.fn();
    const currentRole = { ...destination, revisionToken: "officer-v2" };
    const value = service({ findRole: vi.fn().mockResolvedValue(currentRole), updateRole });

    await expect(value.updateRole(
      context({ permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      currentRole.id,
      { expectedRevisionToken: "officer-v1", color: "#336699", permissions: {} as Record<Permission, boolean> },
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("lets a role manager restore an unheld notification permission on self, peer, and lower roles", async () => {
    const managerPermissions = new Set<Permission>([PERMISSION_ID.ADMIN_ROLES_MANAGE]);
    const roles = [
      {
        ...destination,
        id: "manager",
        name: "Manager",
        level: 500,
        permissions: managerPermissions,
        revisionToken: "manager-v1",
      },
      {
        ...destination,
        id: "peer-manager",
        name: "Peer Manager",
        level: 500,
        permissions: managerPermissions,
        revisionToken: "peer-manager-v1",
      },
      { ...destination, permissions: managerPermissions },
    ];

    for (const role of roles) {
      const updateRole = vi.fn().mockResolvedValue({ status: "updated", role });
      const value = service({ findRole: vi.fn().mockResolvedValue(role), updateRole });

      await expect(value.updateRole(
        context({ roleId: "manager", roleLevel: 500, permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
        role.id,
        {
          expectedRevisionToken: role.revisionToken,
          name: role.name,
          level: role.level,
          color: role.color,
          permissions: permissionFlags([
            PERMISSION_ID.ADMIN_ROLES_MANAGE,
            PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE,
          ]),
        },
      )).resolves.toEqual(role);
      expect(updateRole).toHaveBeenCalledWith(expect.objectContaining({
        id: role.id,
        permissionDelta: {
          add: [PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE],
          remove: [],
        },
      }), expect.anything());
    }
  });

  it("requires role management and rejects higher-role permission edits", async () => {
    const noManageFindRole = vi.fn();
    const noManage = service({ findRole: noManageFindRole });
    await expect(noManage.updateRole(
      context(),
      destination.id,
      { expectedRevisionToken: destination.revisionToken, permissions: permissionFlags() },
    )).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(noManageFindRole).not.toHaveBeenCalled();

    const higher = {
      ...destination,
      id: "higher-manager",
      level: 501,
      permissions: new Set<Permission>([PERMISSION_ID.ADMIN_ROLES_MANAGE]),
    };
    const updateRole = vi.fn();
    const value = service({ findRole: vi.fn().mockResolvedValue(higher), updateRole });
    await expect(value.updateRole(
      context({ roleId: "manager", roleLevel: 500, permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      higher.id,
      {
        expectedRevisionToken: higher.revisionToken,
        permissions: permissionFlags([
          PERMISSION_ID.ADMIN_ROLES_MANAGE,
          PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE,
        ]),
      },
    )).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("allows full peer-role edits and promotion of a lower role up to the actor's level", async () => {
    const peer = {
      ...destination,
      id: "peer-manager",
      name: "Peer Manager",
      level: 500,
      permissions: new Set<Permission>([PERMISSION_ID.ADMIN_ROLES_MANAGE]),
      revisionToken: "peer-manager-v1",
    };
    for (const input of [
      { name: "Renamed Peer" },
      { color: "#336699" },
      { level: 400 },
    ]) {
      const updateRole = vi.fn().mockResolvedValue({ status: "updated", role: peer });
      const value = service({ findRole: vi.fn().mockResolvedValue(peer), updateRole });
      await expect(value.updateRole(
        context({ roleId: "manager", roleLevel: 500, permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
        peer.id,
        { expectedRevisionToken: peer.revisionToken, ...input },
      )).resolves.toEqual(peer);
      expect(updateRole).toHaveBeenCalledWith(expect.objectContaining({ id: peer.id, ...input }), expect.anything());
    }

    const updateRole = vi.fn().mockResolvedValue({ status: "updated", role: destination });
    const value = service({ findRole: vi.fn().mockResolvedValue(destination), updateRole });
    await expect(value.updateRole(
      context({ roleId: "manager", roleLevel: 500, permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      destination.id,
      { expectedRevisionToken: destination.revisionToken, level: 500 },
    )).resolves.toEqual(destination);
    expect(updateRole).toHaveBeenCalledWith(expect.objectContaining({ level: 500 }), expect.anything());
  });

  it("rejects raising any role above the actor's level", async () => {
    const updateRole = vi.fn();
    const ownRole = {
      ...destination,
      id: "manager",
      name: "Manager",
      level: 500,
      permissions: new Set<Permission>([PERMISSION_ID.ADMIN_ROLES_MANAGE]),
      revisionToken: "manager-v1",
    };
    for (const role of [ownRole, { ...ownRole, id: "peer-manager" }, destination]) {
      const value = service({ findRole: vi.fn().mockResolvedValue(role), updateRole });
      await expect(value.updateRole(
        context({ roleId: "manager", roleLevel: 500, permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
        role.id,
        { expectedRevisionToken: role.revisionToken, level: 501 },
      )).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    }
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("keeps the last role manager guard when permissions are removed", async () => {
    const updateRole = vi.fn().mockResolvedValue({ status: "last_role_manager" });
    const managedRole = {
      ...adminRole,
      permissions: new Set<Permission>([PERMISSION_ID.ADMIN_ROLES_MANAGE]),
    };
    const value = service({ findRole: vi.fn().mockResolvedValue(managedRole), updateRole });

    await expect(value.updateRole(
      context({ permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      managedRole.id,
      {
        expectedRevisionToken: managedRole.revisionToken,
        permissions: permissionFlags(),
      },
    )).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "At least one active role manager is required",
    });
    expect(updateRole).toHaveBeenCalledOnce();
  });

  it("lets a role manager create a lower role with unheld permissions, but not an equal or higher role", async () => {
    const role = {
      ...destination,
      id: "notice-editor",
      name: "Notice Editor",
      level: 499,
      permissions: new Set<Permission>([PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE]),
    };
    const createRole = vi.fn().mockResolvedValue({ status: "created", role });
    const value = service({ findRole: vi.fn().mockResolvedValue(role), createRole });

    await expect(value.createRole(
      context({ roleId: "manager", roleLevel: 500, permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
      {
        id: role.id,
        name: role.name,
        level: role.level,
        permissions: permissionFlags([PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE]),
      },
    )).resolves.toEqual(role);
    expect(createRole).toHaveBeenCalledWith(expect.objectContaining({
      id: role.id,
      permissions: [PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE],
    }), expect.anything());

    for (const level of [500, 501]) {
      const rejectedCreate = vi.fn();
      const rejected = service({ createRole: rejectedCreate });
      await expect(rejected.createRole(
        context({ roleId: "manager", roleLevel: 500, permissions: [PERMISSION_ID.ADMIN_ROLES_MANAGE] }),
        { id: `blocked-${level}`, name: "Blocked", level, permissions: permissionFlags() },
      )).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(rejectedCreate).not.toHaveBeenCalled();
    }
  });

  it("lets role viewers and role managers read the role catalog", async () => {
    for (const permission of [PERMISSION_ID.ADMIN_ROLES_VIEW, PERMISSION_ID.ADMIN_ROLES_MANAGE]) {
      const listRoles = vi.fn().mockResolvedValue([destination]);
      const value = service({ listRoles });
      await expect(value.listRoles(context({ permissions: [permission] }))).resolves.toEqual([destination]);
      expect(listRoles).toHaveBeenCalledOnce();
    }

    const listRoles = vi.fn();
    const value = service({ listRoles });
    await expect(value.listRoles(context())).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(listRoles).not.toHaveBeenCalled();
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
