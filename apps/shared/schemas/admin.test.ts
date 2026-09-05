import { describe, expect, it } from "vitest";
import {
  adminRoleSchema,
  auditEventSchema,
  auditSubjectSchema,
  createAdminMemberSchema,
  createInviteLinkSchema,
  inviteLinkSchema,
  updateAdminMemberSchema,
  updateRoleSchema,
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
    expect(createAdminMemberSchema.safeParse({ login_name: "new_member", display_name: "NewMember" }).success).toBe(false);

    expect(createInviteLinkSchema.safeParse({ role_id: "raider", max_uses: 1 }).success).toBe(true);
    expect(createAdminMemberSchema.safeParse({
      login_name: "new_member",
      display_name: "NewMember",
      role_id: "raider",
      notes: "Initial officer note",
    }).success).toBe(true);
    expect(createAdminMemberSchema.safeParse({
      login_name: "new_member",
      display_name: "NewMember",
      role_id: "raider",
      notes: "x".repeat(2001),
    }).success).toBe(false);
  });

  it("requires one stored 10-character invite code in every invite response", () => {
    const parsed = inviteLinkSchema.safeParse({
      id: "invite-1",
      code: "A1B2C3D4E5",
      created_by: "user-1",
      max_uses: 2,
      used_count: 0,
      expires_at: null,
      created_at: "2026-08-05T00:00:00.000Z",
      revoked_at: null,
      ...roleTarget,
    });

    expect(parsed.success).toBe(true);
    expect(inviteLinkSchema.safeParse({
      ...(parsed.success ? parsed.data : {}),
      code: "SHORT",
    }).success).toBe(false);
    expect(inviteLinkSchema.safeParse({
      ...(parsed.success ? parsed.data : {}),
      code: "A1B2C3D4-5",
    }).success).toBe(false);
  });

  it("treats every role as editable data instead of exposing a built-in flag", () => {
    const parsed = adminRoleSchema.parse({
      id: "admin",
      name: "Admin",
      level: 999,
      color: "red",
      created_at: "2026-08-05T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z",
      revision_token: "role-v1",
      permissions: Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])),
      assigned_user_count: 1,
    });

    expect(parsed).not.toHaveProperty("is_builtin");
  });
});

describe("admin member edit schema", () => {
  const profile = {
    power: 42,
    classes: ["guardian"],
    title_html: "<b>Officer</b>",
    bio: "Coordinates raids",
    availability: null,
    notes: "Private officer note",
  };

  it("accepts one composite command but rejects empty and smuggled profile fields", () => {
    expect(updateAdminMemberSchema.parse({
      expected_user_revision_token: "user-v1",
      expected_profile_revision_token: "profile-v1",
      display_name: "RenamedMember",
      profile,
      role_id: "officer",
      is_active: false,
    })).toEqual({
      expected_user_revision_token: "user-v1",
      expected_profile_revision_token: "profile-v1",
      display_name: "RenamedMember",
      profile,
      role_id: "officer",
      is_active: false,
    });
    expect(updateAdminMemberSchema.safeParse({}).success).toBe(false);
    expect(updateAdminMemberSchema.safeParse({
      expected_user_revision_token: "user-v1",
      expected_profile_revision_token: "profile-v1",
      profile: { ...profile, display_name: "Escalation attempt" },
    }).success).toBe(false);
    expect(updateAdminMemberSchema.safeParse({
      expected_user_revision_token: "user-v1",
      expected_profile_revision_token: "profile-v1",
      display_name: "Not a valid name",
    }).success).toBe(false);
    expect(updateRoleSchema.safeParse({ expected_revision_token: "role-v1", color: "#123456" }).success).toBe(true);
  });
});

describe("audit event contract", () => {
  it("accepts nested JSON values and rejects non-JSON or non-object roots", () => {
    expect(jsonObjectSchema.parse({ nested: [true, 1, "value", null, { ok: false }] })).toEqual({
      nested: [true, 1, "value", null, { ok: false }],
    });
    expect(jsonObjectSchema.safeParse([]).success).toBe(false);
    expect(jsonObjectSchema.safeParse({ invalid: undefined }).success).toBe(false);
    expect(jsonObjectSchema.safeParse({ invalid: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("accepts a typed audit payload and rejects malformed payloads", () => {
    const parsed = auditEventSchema.parse({
      event_id: "audit-1",
      request_id: "request-1",
      actor: { kind: "user", id: "actor-1", label: "Admin" },
      subject: { type: "event", id: "event-1", label: "Launch" },
      action: "update",
      payload: {
        schema_version: 2,
        changes: [{
          field: "title",
          before: { type: "text", value: "Before" },
          after: { type: "text", value: "After" },
        }],
        context: [],
      },
      occurred_at: "2026-08-08T00:00:00.000Z",
    });

    expect(parsed.payload.changes[0]).toEqual({
      field: "title",
      before: { type: "text", value: "Before" },
      after: { type: "text", value: "After" },
    });
    expect(auditEventSchema.safeParse({ ...parsed, payload: "{}" }).success).toBe(false);
  });

  it("accepts the complete subject of a 50-image batch while keeping its length bounded", () => {
    const id = Array.from({ length: 50 }, (_, index) => String(index).padStart(21, "0")).join(",");
    const subject = { type: "gallery_item", id, label: "image" };
    expect(auditSubjectSchema.parse(subject)).toEqual(subject);
    expect(auditSubjectSchema.safeParse({ ...subject, id: `${id}x` }).success).toBe(false);
  });
});
