import type { AdminRole, User } from "@guild/shared";
import { describe, expect, it } from "vitest";
import {
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
    expect(canManageUserByRoleLevel({ role_level: 199 } as User, actor)).toBe(true);
    expect(canManageUserByRoleLevel({ role_level: 200 } as User, actor)).toBe(false);
    expect(canManageUserByRoleLevel({ role_level: 201 } as User, actor)).toBe(false);
    expect(canManageUserByRoleLevel({ role_level: 1 } as User, null)).toBe(false);
  });
});
