import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { LIMITS } from "@guild/shared/config/limits";
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

function publicContext() {
  return createRequestContext({
    requestId: "request-public", now: NOW,
    authorization: createAuthorizationContext(null),
  });
}

describe("MemberService guarded profile edits", () => {
  it("rejects oversized guest roster pages before storage access", async () => {
    const listRoster = vi.fn();
    const service = new MemberService({
      store: { listRoster } as unknown as MembersStore,
      media: {} as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await expect(service.list(publicContext(), {
      page: 1,
      limit: LIMITS.pagination.publicUsers + 1,
      includeTotal: false,
      externalView: false,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(listRoster).not.toHaveBeenCalled();
  });

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

  it("preserves absence dates in the deletion audit without storing its note", async () => {
    const deleteAbsence = vi.fn().mockResolvedValue(true);
    const absence = {
      id: "absence-1", user_id: target.userId, username: target.username, role_id: "member",
      role_name: "Member", role_color: null, role_level: 100,
      start_date: "2026-08-10", end_date: "2026-08-12", note: "private", created_at: NOW,
    };
    const service = new MemberService({
      store: {
        getMemberTarget: vi.fn().mockResolvedValue(target),
        listAbsences: vi.fn().mockResolvedValue([absence]),
        deleteAbsence,
      } as unknown as MembersStore,
      media: {} as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await service.deleteAbsence(context(), target.userId, absence.id);
    const audit = deleteAbsence.mock.calls[0]![2];
    expect(audit.payload.context).toEqual([
      { field: "subject_id", value: { type: "reference", value: { id: target.userId, label: target.username } } },
      { field: "start_at", value: { type: "date", value: absence.start_date } },
      { field: "end_at", value: { type: "date", value: absence.end_date } },
    ]);
    expect(JSON.stringify(audit.payload)).not.toContain(absence.note);
  });
});
