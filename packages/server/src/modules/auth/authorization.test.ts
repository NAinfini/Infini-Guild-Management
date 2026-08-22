import { describe, expect, it } from "vitest";
import { createAuthorizationContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
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

  it("allows the actor's exact role but rejects a different role at the same level", () => {
    expect(() => assertRoleAssignable(authorization.actor!, {
      id: "officer",
      level: 500,
      permissions: new Set([PERMISSION_ID.ADMIN_USERS_EDIT]),
    })).not.toThrow();
    expect(() => assertRoleAssignable(authorization.actor!, {
      id: "peer-officer",
      level: 500,
      permissions: new Set([PERMISSION_ID.ADMIN_USERS_EDIT]),
    })).toThrowError(/different role at your own level/);
  });
});
