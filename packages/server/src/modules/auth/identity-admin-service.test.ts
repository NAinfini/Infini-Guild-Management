import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import {
  PERMISSIONS,
  PERMISSION_ID,
  SITE_OWNER_LEVEL,
  SITE_OWNER_ROLE_ID,
  type Permission,
} from "@guild/shared/constants/roles";
import type { AccountProvisioningStore, AuthStore, ManagedUserTarget, RoleRecord } from "./auth-types";
import { IdentityAdminService } from "./identity-admin-service";
import { createInviteTokenCodec } from "./crypto";

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
const ownerRole: RoleRecord = {
  id: SITE_OWNER_ROLE_ID, name: "Site Owner", level: SITE_OWNER_LEVEL, color: "#d4af37",
  permissions: new Set(PERMISSIONS), assignedUserCount: 1, revisionToken: "owner-role-v1",
  createdAt: NOW, updatedAt: NOW,
};
const ownerTarget: ManagedUserTarget = {
  ...target,
  id: "owner-2",
  username: "Owner Two",
  roleId: SITE_OWNER_ROLE_ID,
  roleLevel: SITE_OWNER_LEVEL,
  rolePermissions: new Set(PERMISSIONS),
  roleRevisionToken: ownerRole.revisionToken,
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
      roleLevel: input.roleLevel ?? 900,
      permissions: input.permissions ?? [PERMISSION_ID.ADMIN_USERS_ROLE, PERMISSION_ID.ADMIN_USERS_ACTIVATE],
    }),
  });
}

function ownerContext(userId = "owner-1") {
  return context({ userId, roleId: SITE_OWNER_ROLE_ID, roleLevel: SITE_OWNER_LEVEL, permissions: PERMISSIONS });
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
  it("decodes a full invite code into an exact id lookup", async () => {
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
      exactId: "invite-123",
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
});

describe("IdentityAdminService guarded writes", () => {
  it("maps a stale target or destination role to a 409", async () => {
    const value = service({
      findManagedUsers: async () => [target],
      findRole: async () => destination,
      countActiveOwners: async () => 1,
      countActiveOwnersAmong: async () => 0,
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
});

describe("site-owner hierarchy", () => {
  it("does not let an admin promote itself to site owner", async () => {
    const adminTarget = { ...target, id: "admin", roleId: "admin", roleLevel: 900 };
    const value = service({ findManagedUsers: async () => [adminTarget], findRole: async () => ownerRole });
    await expect(value.updateUserRole(context(), "admin", SITE_OWNER_ROLE_ID))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("lets a site owner appoint a lower-level user as another owner", async () => {
    const setUsersRole = vi.fn(async () => "updated" as const);
    const value = service({
      findManagedUsers: async () => [target],
      findRole: async () => ownerRole,
      setUsersRole,
    });
    await expect(value.updateUserRole(ownerContext(), target.id, SITE_OWNER_ROLE_ID)).resolves.toEqual({ ok: true });
    expect(setUsersRole).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [target], destinationRole: ownerRole }),
      expect.anything(),
    );
  });

  it("lets an owner inspect an admin lock and reset another owner's lock", async () => {
    const adminTarget = { ...target, id: "admin-2", roleId: "admin", roleLevel: 900 };
    const resetUserLoginLock = vi.fn(async () => ({
      outcome: "updated" as const,
      previous: { failCount: 5, lockedUntil: "2026-08-09T12:01:00.000Z" },
    }));
    const value = service({
      findManagedUsers: async ([id]) => [id === ownerTarget.id ? ownerTarget : adminTarget],
      readLoginFailure: async () => ({ failCount: 4, lockedUntil: "2026-08-09T12:00:30.000Z" }),
      resetUserLoginLock,
    });
    await expect(value.getLoginLock(ownerContext(), adminTarget.id)).resolves.toEqual({
      failCount: 4,
      lockedUntil: "2026-08-09T12:00:30.000Z",
      isLocked: true,
      retryAfterSeconds: 30,
    });
    await expect(value.resetLoginLock(ownerContext(), ownerTarget.id)).resolves.toEqual({
      ok: true,
      failCount: 5,
      lockedUntil: "2026-08-09T12:01:00.000Z",
      isLocked: true,
      retryAfterSeconds: 60,
    });
    expect(resetUserLoginLock).toHaveBeenCalledOnce();
  });

  it("protects the last active owner but allows peer-owner deactivation when another remains", async () => {
    const setUsersActive = vi.fn(async () => "updated" as const);
    const last = service({
      findManagedUsers: async () => [{ ...ownerTarget, id: "owner-1" }],
      countActiveOwners: async () => 1,
      countActiveOwnersAmong: async () => 1,
      setUsersActive,
    });
    await expect(last.setUserActive(ownerContext(), "owner-1", false))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409, message: "At least one active site owner is required" });
    expect(setUsersActive).not.toHaveBeenCalled();

    const multiple = service({
      findManagedUsers: async () => [ownerTarget],
      countActiveOwners: async () => 2,
      countActiveOwnersAmong: async () => 1,
      setUsersActive,
    });
    await expect(multiple.setUserActive(ownerContext(), ownerTarget.id, false)).resolves.toEqual({ ok: true });
    expect(setUsersActive).toHaveBeenCalledOnce();
  });
});
