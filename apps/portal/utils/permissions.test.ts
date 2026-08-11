import {
  PERMISSIONS,
  SITE_OWNER_LEVEL,
  SITE_OWNER_ROLE_ID,
  type AdminRole,
  type User,
} from "@guild/shared";
import { describe, expect, it } from "vitest";
import {
  canPreviewRole,
  canManageUserByRoleLevel,
  getAdminCapabilities,
  isRoleAssignableToUser,
  userCanAccessAdmin,
} from "./permissions";

describe("class administration permission contract", () => {
  it("grants the admin workspace from admin.classes.manage", () => {
    const roles = [{
      id: "class-admin",
      permissions: { "admin.classes.manage": true },
    }] as unknown as AdminRole[];

    expect(getAdminCapabilities(roles, "class-admin")).toMatchObject({
      canAccessAdmin: true,
      canManageClasses: true,
    });
  });

  it("recognizes the same permission on the current session before roles load", () => {
    const user = {
      permissions: { "admin.classes.manage": true },
    } as unknown as User;

    expect(userCanAccessAdmin(user)).toBe(true);
  });
});

describe("role authority rules", () => {
  const actor = {
    id: "officer-1",
    role: "officer",
    role_level: 200,
    permissions: {
      "admin.users.role": true,
      "admin.invite.manage": true,
      "admin.audit.view": false,
    },
  } as unknown as User;

  const role = {
    id: "raid-lead",
    level: 100,
    permissions: {
      "admin.users.role": true,
      "admin.invite.manage": false,
    },
  } as unknown as AdminRole;

  it("requires a lower role whose every granted permission the actor also has", () => {
    expect(isRoleAssignableToUser(role, actor)).toBe(true);
    expect(isRoleAssignableToUser({ ...role, level: 200 }, actor)).toBe(false);
    expect(isRoleAssignableToUser({ ...role, level: 201 }, actor)).toBe(false);
    expect(isRoleAssignableToUser({
      ...role,
      permissions: { ...role.permissions, "admin.audit.view": true },
    }, actor)).toBe(false);
    expect(isRoleAssignableToUser(role, null)).toBe(false);
  });

  it("allows member operations only below the actor's role level", () => {
    expect(canManageUserByRoleLevel({ id: "lower", role_level: 199 } as User, actor)).toBe(true);
    expect(canManageUserByRoleLevel({ id: "peer", role_level: 200 } as User, actor)).toBe(false);
    expect(canManageUserByRoleLevel({ id: "higher", role_level: 201 } as User, actor)).toBe(false);
    expect(canManageUserByRoleLevel({ role_level: 1 } as User, null)).toBe(false);
  });

  it("matches the server's site-owner peer and assignment exception", () => {
    const ownerPermissions = Object.fromEntries(
      PERMISSIONS.map((permission) => [permission, true]),
    ) as User["permissions"];
    const owner = {
      id: "owner-1",
      role: SITE_OWNER_ROLE_ID,
      role_level: SITE_OWNER_LEVEL,
      permissions: ownerPermissions,
    } as User;
    const ownerRole = {
      id: SITE_OWNER_ROLE_ID,
      level: SITE_OWNER_LEVEL,
      permissions: ownerPermissions,
    } as AdminRole;

    expect(canManageUserByRoleLevel({
      id: "owner-2",
      role: SITE_OWNER_ROLE_ID,
      role_level: SITE_OWNER_LEVEL,
    } as User, owner)).toBe(true);
    expect(canManageUserByRoleLevel(owner, owner)).toBe(false);
    expect(isRoleAssignableToUser(ownerRole, owner)).toBe(true);
  });

  it("does not offer Viewing As roles above the actual session role", () => {
    expect(canPreviewRole({ level: 199 } as AdminRole, actor)).toBe(true);
    expect(canPreviewRole({ level: 200 } as AdminRole, actor)).toBe(true);
    expect(canPreviewRole({ level: 201 } as AdminRole, actor)).toBe(false);
    expect(canPreviewRole({ level: 1 } as AdminRole, null)).toBe(false);
  });
});
