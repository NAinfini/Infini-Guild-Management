import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { MemberMediaPort, MembersStore, MemberTarget } from "./member-types";
import { MemberService } from "./member-service";

const NOW = "2026-08-09T12:00:00.000Z";
const target: MemberTarget = {
  userId: "target", username: "Target", roleId: "member", roleLevel: 100, isActive: true,
  deletedAt: null, revisionToken: "user-v1", roleRevisionToken: "role-v1", profileRevisionToken: "profile-v1",
};

function context() {
  return createRequestContext({
    requestId: "request-1", now: NOW,
    authorization: createAuthorizationContext({
      userId: "admin", sessionId: "session", roleId: "admin", roleLevel: 900,
      permissions: [PERMISSION_ID.ADMIN_USERS_EDIT],
    }),
  });
}

describe("MemberService guarded profile edits", () => {
  it("returns 409 when the target authorization snapshot becomes stale", async () => {
    const store = {
      getMemberTarget: async () => target,
      updateProfile: async () => null,
    } as unknown as MembersStore;
    const media = {
      listForMembers: async () => new Map([[target.userId, {
        avatarMediaId: null, images: [], audioMediaId: null, audioName: null,
      }]]),
    } as unknown as MemberMediaPort;
    const service = new MemberService({
      store, media, absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await expect(service.updateProfile(context(), target.userId, { bio: "changed" }))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("rejects an absence query wider than the shared maximum before reading storage", async () => {
    const listAbsences = vi.fn();
    const service = new MemberService({
      store: { listAbsences } as unknown as MembersStore,
      media: {} as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await expect(service.listAbsenceWindow(context(), "2026-01-01", "2027-01-02"))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(listAbsences).not.toHaveBeenCalled();
  });
});
