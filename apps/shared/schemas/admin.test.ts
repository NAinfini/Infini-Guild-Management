import { describe, expect, it } from "vitest";
import {
  adminRoleSchema,
  createAdminMemberSchema,
  createInviteLinkSchema,
  inviteLinkSchema,
} from "./admin";
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
