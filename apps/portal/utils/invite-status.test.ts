import type { InviteLink } from "@guild/shared";
import { describe, expect, it } from "vitest";
import { resolveInviteStatus } from "./invite-status";

const baseInvite: InviteLink = {
  id: "invite-1",
  code: "CODE",
  created_by: "admin-1",
  role_id: "member",
  role_name: "Member",
  role_color: null,
  role_level: 1,
  max_uses: 5,
  used_count: 1,
  expires_at: null,
  created_at: "2026-07-28T00:00:00.000Z",
  revoked_at: null,
};

describe("resolveInviteStatus", () => {
  it("uses revoked, fully-used, expired, active precedence", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");

    expect(resolveInviteStatus({
      ...baseInvite,
      revoked_at: "2026-07-28T10:00:00.000Z",
      used_count: 5,
      expires_at: "2026-07-27T00:00:00.000Z",
    }, now)).toBe("revoked");
    expect(resolveInviteStatus({ ...baseInvite, used_count: 5 }, now)).toBe("fullyUsed");
    expect(resolveInviteStatus({
      ...baseInvite,
      expires_at: "2026-07-28T11:59:59.000Z",
    }, now)).toBe("expired");
    expect(resolveInviteStatus(baseInvite, now)).toBe("active");
  });
});
