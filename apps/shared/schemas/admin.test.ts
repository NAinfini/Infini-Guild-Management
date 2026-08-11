import { describe, expect, it } from "vitest";
import {
  adminRoleSchema,
  auditLogSchema,
  createAdminMemberSchema,
  createInviteLinkSchema,
  inviteLinkSchema,
  loginLockStateSchema,
  resetLoginLockResponseSchema,
} from "./admin";
import { jsonObjectSchema } from "./json";
import { PERMISSIONS } from "../constants/roles";

const roleTarget = {
  role_id: "raider",
  role_name: "Raider",
  role_color: "#123456",
  role_level: 200,
};

describe("admin role-target schemas", () => {
  it("requires a D1 role id when creating an invite or member", () => {
    expect(createInviteLinkSchema.safeParse({ max_uses: 1 }).success).toBe(false);
    expect(createAdminMemberSchema.safeParse({ username: "new_member" }).success).toBe(false);

    expect(createInviteLinkSchema.safeParse({ role_id: "raider", max_uses: 1 }).success).toBe(true);
    expect(createAdminMemberSchema.safeParse({ username: "new_member", role_id: "raider" }).success).toBe(true);
  });

  it("returns the assigned role metadata with invite links", () => {
    const parsed = inviteLinkSchema.safeParse({
      id: "invite-1",
      code: "CODE",
      created_by: "user-1",
      max_uses: 2,
      used_count: 0,
      expires_at: null,
      created_at: "2026-08-05T00:00:00.000Z",
      revoked_at: null,
      ...roleTarget,
    });

    expect(parsed.success).toBe(true);
  });

  it("treats every role as editable data instead of exposing a built-in flag", () => {
    const parsed = adminRoleSchema.parse({
      id: "admin",
      name: "Admin",
      level: 999,
      color: "red",
      created_at: "2026-08-05T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z",
      permissions: Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])),
      assigned_user_count: 1,
    });

    expect(parsed).not.toHaveProperty("is_builtin");
  });
});

describe("admin login-lock schemas", () => {
  const state = {
    fail_count: 4,
    locked_until: "2026-08-09T12:00:30.000Z",
    is_locked: true,
    retry_after_seconds: 30,
  };

  it("keeps state and reset DTOs strict and snake_case", () => {
    expect(loginLockStateSchema.parse(state)).toEqual(state);
    expect(resetLoginLockResponseSchema.parse({ ok: true, ...state })).toEqual({ ok: true, ...state });
    expect(loginLockStateSchema.safeParse({ ...state, retryAfterSeconds: 30 }).success).toBe(false);
  });
});

describe("audit JSON object contract", () => {
  it("accepts nested JSON values and rejects non-JSON or non-object roots", () => {
    expect(jsonObjectSchema.parse({ nested: [true, 1, "value", null, { ok: false }] })).toEqual({
      nested: [true, 1, "value", null, { ok: false }],
    });
    expect(jsonObjectSchema.safeParse([]).success).toBe(false);
    expect(jsonObjectSchema.safeParse({ invalid: undefined }).success).toBe(false);
    expect(jsonObjectSchema.safeParse({ invalid: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("exposes audit detail as an object without a detail_text compatibility field", () => {
    const parsed = auditLogSchema.parse({
      id: "audit-1",
      entity_type: "event",
      action: "update",
      actor_id: "actor-1",
      entity_id: "event-1",
      diff_title: null,
      detail: { title: { from: "Before", to: "After" } },
      created_at: "2026-08-08T00:00:00.000Z",
    });

    expect(parsed.detail).toEqual({ title: { from: "Before", to: "After" } });
    expect(parsed).not.toHaveProperty("detail_text");
    expect(auditLogSchema.safeParse({ ...parsed, detail: "{}" }).success).toBe(false);
  });
});
