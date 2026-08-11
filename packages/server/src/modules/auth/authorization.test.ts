import { describe, expect, it } from "vitest";
import { createAuthorizationContext } from "@guild/kernel";
import { PERMISSIONS, PERMISSION_ID, SITE_OWNER_LEVEL, SITE_OWNER_ROLE_ID } from "@guild/shared/constants/roles";
import { assertRoleAssignable, assertTargetBelowActor, requireAnyPermission } from "./authorization";

const authorization = createAuthorizationContext({
  userId: "actor",
  sessionId: "session",
  roleId: "officer",
  roleLevel: 500,
  permissions: [PERMISSION_ID.ADMIN_USERS_EDIT, PERMISSION_ID.ADMIN_USERS_ROLE],
});

describe("auth authorization policies", () => {
  it("keeps any-permission checks explicit", () => {
    expect(requireAnyPermission(authorization, [
      PERMISSION_ID.ADMIN_USERS_VIEW,
      PERMISSION_ID.ADMIN_USERS_EDIT,
    ]).userId).toBe("actor");
    expect(() => requireAnyPermission(authorization, [PERMISSION_ID.ADMIN_AUDIT_VIEW])).toThrowError(
      /Insufficient permission/,
    );
  });

  it("rejects same-level and higher targets", () => {
    expect(() => assertTargetBelowActor(authorization.actor!, { userId: "peer", roleId: "officer", roleLevel: 500 }, { allowSelf: false }))
      .toThrowError(/at or above/);
    expect(() => assertTargetBelowActor(authorization.actor!, { userId: "actor", roleId: "officer", roleLevel: 500 }, { allowSelf: false }))
      .toThrowError(/yourself/);
  });

  it("rejects permission escalation even for a lower role", () => {
    expect(() => assertRoleAssignable(authorization.actor!, {
      id: "member",
      level: 100,
      permissions: new Set([PERMISSION_ID.ADMIN_AUDIT_VIEW]),
    })).toThrowError(/do not hold/);
  });

  it("keeps site-owner peer management and assignment as the sole same-level exception", () => {
    const owner = createAuthorizationContext({
      userId: "owner-1", sessionId: "session", roleId: SITE_OWNER_ROLE_ID,
      roleLevel: SITE_OWNER_LEVEL, permissions: PERMISSIONS,
    }).actor!;
    expect(() => assertTargetBelowActor(owner, {
      userId: "owner-2", roleId: SITE_OWNER_ROLE_ID, roleLevel: SITE_OWNER_LEVEL,
    }, { allowSelf: false, allowOwnerPeer: true })).not.toThrow();
    expect(() => assertTargetBelowActor(owner, {
      userId: "owner-1", roleId: SITE_OWNER_ROLE_ID, roleLevel: SITE_OWNER_LEVEL,
    }, { allowSelf: false, allowOwnerPeer: true })).not.toThrow();
    expect(() => assertRoleAssignable(owner, {
      id: SITE_OWNER_ROLE_ID, level: SITE_OWNER_LEVEL, permissions: new Set(PERMISSIONS),
    })).not.toThrow();
    expect(() => assertRoleAssignable(owner, {
      id: "custom-owner", level: 900, permissions: new Set([PERMISSION_ID.ADMIN_OWNERS_MANAGE]),
    })).toThrowError(/reserved/);
  });
});
