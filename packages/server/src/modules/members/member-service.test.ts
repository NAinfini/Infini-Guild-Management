import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { LIMITS } from "@guild/shared/config/limits";
import { memberProfileRevisionEtag } from "@guild/shared";
import type { MemberMediaPort, MemberRecord, MembersStore, MemberTarget } from "./member-types";
import { buildMemberWire, MemberService } from "./member-service";

const NOW = "2026-08-09T12:00:00.000Z";
const target: MemberTarget = {
  userId: "target", display_name: "Target", roleId: "member", roleLevel: 100, isActive: true,
  deletedAt: null, revisionToken: "user-v1", roleRevisionToken: "role-v1", profileRevisionToken: "profile-v1",
};

const memberRecord: MemberRecord = {
  user: {
    id: target.userId,
    display_name: target.display_name,
    roleId: target.roleId,
    roleName: "Member",
    roleColor: null,
    roleLevel: target.roleLevel,
    isActive: true,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    revisionToken: target.revisionToken,
    lastLoginAt: null,
  },
  profile: {
    userId: target.userId,
    power: 0,
    classes: [],
    titleHtml: null,
    bio: null,
    videoUrls: [],
    availability: null,
    vacationStart: null,
    vacationEnd: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    revisionToken: target.profileRevisionToken,
  },
  badges: [],
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

function selfContext() {
  return createRequestContext({
    requestId: "request-self", now: NOW,
    authorization: createAuthorizationContext({
      userId: target.userId, sessionId: "session-self", roleId: "member", roleLevel: target.roleLevel,
      permissions: [],
    }),
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

    await expect(service.updateProfile(
      context(),
      target.userId,
      { bio: "changed" },
      memberProfileRevisionEtag(target.profileRevisionToken),
    ))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("writes a changed public display name through the profile transaction and audit", async () => {
    const updateProfile = vi.fn().mockResolvedValue({
      userId: target.userId,
      power: 0,
      classes: [],
      titleHtml: null,
      bio: null,
      videoUrls: [],
      availability: null,
      vacationStart: null,
      vacationEnd: null,
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
      revisionToken: "profile-v2",
    });
    const service = new MemberService({
      store: {
        getMemberTarget: vi.fn().mockResolvedValue(target),
        updateProfile,
      } as unknown as MembersStore,
      media: {
        listForMembers: vi.fn().mockResolvedValue(new Map([[target.userId, {
          avatarMediaId: null, images: [], audioMediaId: null, audioName: null,
        }]])),
      } as unknown as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await service.updateProfile(
      context(),
      target.userId,
      { display_name: "Renamed" },
      memberProfileRevisionEtag(target.profileRevisionToken),
    );

    expect(updateProfile).toHaveBeenCalledWith(
      target.userId,
      expect.objectContaining({ displayName: "Renamed" }),
      target,
      [],
      expect.objectContaining({
        subjectLabel: "Renamed",
        payload: expect.objectContaining({
          changes: [{
            field: "display_name",
            before: { type: "text", value: "Target" },
            after: { type: "text", value: "Renamed" },
          }],
        }),
      }),
    );
  });

  it("maps a duplicate public display name to a conflict", async () => {
    const service = new MemberService({
      store: {
        getMemberTarget: vi.fn().mockResolvedValue(target),
        updateProfile: vi.fn().mockResolvedValue("display_name_taken"),
      } as unknown as MembersStore,
      media: {
        listForMembers: vi.fn().mockResolvedValue(new Map([[target.userId, {
          avatarMediaId: null, images: [], audioMediaId: null, audioName: null,
        }]])),
      } as unknown as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await expect(service.updateProfile(
      context(),
      target.userId,
      { display_name: "Taken" },
      memberProfileRevisionEtag(target.profileRevisionToken),
    ))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("rejects a stale direct profile revision for self or administrator before media or storage writes", async () => {
    const updateProfile = vi.fn();
    const listForMembers = vi.fn();
    const service = new MemberService({
      store: { getMemberTarget: vi.fn().mockResolvedValue(target), updateProfile } as unknown as MembersStore,
      media: { listForMembers } as unknown as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await expect(service.updateProfile(
      selfContext(),
      target.userId,
      { bio: "stale" },
      memberProfileRevisionEtag("profile-v0"),
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(listForMembers).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();

    await expect(service.updateProfile(
      context(),
      target.userId,
      { bio: "stale administrator edit" },
      memberProfileRevisionEtag("profile-v0"),
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(listForMembers).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("requires the same profile ETag for self and administrator media writes before creating an audit", async () => {
    const uploadProfileImages = vi.fn().mockResolvedValue(["image-1"]);
    const service = new MemberService({
      store: { getMemberTarget: vi.fn().mockResolvedValue(target) } as unknown as MembersStore,
      media: { uploadProfileImages } as unknown as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });
    const upload = { full: new Uint8Array(), view: new Uint8Array() };

    await expect(service.uploadImages(selfContext(), target.userId, [upload]))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(uploadProfileImages).not.toHaveBeenCalled();

    await service.uploadImages(
      selfContext(),
      target.userId,
      [upload],
      memberProfileRevisionEtag(target.profileRevisionToken),
    );
    await service.uploadImages(
      context(),
      target.userId,
      [upload],
      memberProfileRevisionEtag(target.profileRevisionToken),
    );

    expect(uploadProfileImages).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      target.userId,
      [upload],
      expect.objectContaining({ action: "upload_images" }),
      target.profileRevisionToken,
    );
    expect(uploadProfileImages).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      target.userId,
      [upload],
      expect.objectContaining({ action: "upload_images" }),
      target.profileRevisionToken,
    );
  });

  it("returns the verified current revision when a profile media deletion changes nothing", async () => {
    const deleteAvatar = vi.fn().mockResolvedValue(false);
    const service = new MemberService({
      store: { getMemberTarget: vi.fn().mockResolvedValue(target) } as unknown as MembersStore,
      media: { deleteAvatar } as unknown as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await expect(service.deleteAvatar(
      selfContext(),
      target.userId,
      memberProfileRevisionEtag(target.profileRevisionToken),
    )).resolves.toEqual({ ok: true, profileRevisionToken: target.profileRevisionToken });
    expect(deleteAvatar).toHaveBeenCalledWith(
      expect.anything(),
      target.userId,
      expect.objectContaining({ action: "delete_avatar" }),
      target.profileRevisionToken,
    );
  });

  it("returns the exact self-profile revision written by the guarded store", async () => {
    const saved = {
      userId: target.userId,
      power: 0,
      classes: [],
      titleHtml: null,
      bio: "saved",
      videoUrls: [],
      availability: null,
      vacationStart: null,
      vacationEnd: null,
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
      revisionToken: "profile-v2",
    };
    const service = new MemberService({
      store: {
        getMemberTarget: vi.fn().mockResolvedValue(target),
        updateProfile: vi.fn().mockResolvedValue(saved),
      } as unknown as MembersStore,
      media: {
        listForMembers: vi.fn().mockResolvedValue(new Map([[target.userId, {
          avatarMediaId: null, images: [], audioMediaId: null, audioName: null,
        }]])),
      } as unknown as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    await expect(service.updateProfile(
      selfContext(),
      target.userId,
      { bio: "saved" },
      memberProfileRevisionEtag(target.profileRevisionToken),
    )).resolves.toMatchObject({
      profile: { bio: "saved" },
      revisionToken: "profile-v2",
    });
  });

  it("exposes profile revision metadata to the owner but not an external projection", async () => {
    const service = new MemberService({
      store: { getMember: vi.fn().mockResolvedValue(memberRecord) } as unknown as MembersStore,
      media: {
        listForMembers: vi.fn().mockResolvedValue(new Map([[target.userId, {
          avatarMediaId: null, images: [], audioMediaId: null, audioName: null,
        }]])),
      } as unknown as MemberMediaPort,
      absencePolicy: { readAbsencePolicy: async () => ({ maxSpanDays: 30, maxEntriesPerUser: 5 }) },
    });

    const owner = await service.detail(selfContext(), target.userId);
    const external = await service.detail(selfContext(), target.userId, true);

    expect(buildMemberWire(owner).edit_revisions).toEqual({
      user_revision_token: target.revisionToken,
      profile_revision_token: target.profileRevisionToken,
    });
    expect(buildMemberWire(external).edit_revisions).toBeUndefined();
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
      id: "absence-1", user_id: target.userId, display_name: target.display_name, role_id: "member",
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
      { field: "subject_id", value: { type: "reference", value: { id: target.userId, label: target.display_name } } },
      { field: "start_at", value: { type: "date", value: absence.start_date } },
      { field: "end_at", value: { type: "date", value: absence.end_date } },
    ]);
    expect(JSON.stringify(audit.payload)).not.toContain(absence.note);
  });
});
