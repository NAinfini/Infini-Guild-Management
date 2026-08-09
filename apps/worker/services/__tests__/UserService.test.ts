
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_MEDIA_POLICY, type MemberAvailability } from "@guild/shared";
import { MediaValidationError } from "../MediaService";
import type { MediaService } from "../MediaService";
import { UserService } from "../UserService";

const MEDIA_ID = "Abcdefghijklmnopqrstu";
const SECOND_MEDIA_ID = "Vbcdefghijklmnopqrstu";
const KEEP_MEDIA_ID = "Cbcdefghijklmnopqrstu";
const NEW_MEDIA_ID = "Dbcdefghijklmnopqrstu";

type RelationFixtures = {
  classes?: Record<string, string[]>;
  images?: Record<string, string[]>;
  availability?: Record<string, Array<{ weekday: number; startMinute: number; endMinute: number }>>;
};

function createDeps(relations: RelationFixtures = {}) {
  const rawStatements: Array<{ sql: string; binds: unknown[] }> = [];
  const rawDb = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => {
        const relationRows = sql.includes("FROM member_profile_classes") ? relations.classes : undefined;
        const statement = {
          sql,
          binds,
          all: vi.fn().mockResolvedValue({
            results: sql.includes("FROM member_availability_windows")
              ? binds.flatMap((ownerId) => (relations.availability?.[String(ownerId)] ?? []).map((window) => ({
                  user_id: String(ownerId),
                  weekday: window.weekday,
                  start_minute: window.startMinute,
                  end_minute: window.endMinute,
                })))
              : binds.flatMap((ownerId) =>
                  (relationRows?.[String(ownerId)] ?? []).map((value) => ({
                    owner_id: String(ownerId),
                    value,
                  })),
                ),
          }),
        };
        rawStatements.push(statement);
        return statement;
      }),
    })),
    batch: vi.fn().mockResolvedValue([]),
  };
  const mediaServiceMock = {
    listLinkedMedia: vi.fn().mockImplementation(async (_entityType: string, entityIds: string[]) => new Map(
      entityIds.map((entityId) => [
        entityId,
        (relations.images?.[entityId] ?? []).map((mediaId, sortOrder) => ({
          mediaId,
          slot: "image",
          sortOrder,
          originalName: null,
        })),
      ]),
    )),
    listLinkedMediaIds: vi.fn().mockResolvedValue([]),
    checkQuota: vi.fn().mockResolvedValue(true),
    createImages: vi.fn().mockResolvedValue({
      expiresAt: "2026-08-09T00:00:00.000Z",
      mediaIds: [NEW_MEDIA_ID],
    }),
    createAudio: vi.fn().mockResolvedValue({
      expiresAt: "2026-08-09T00:00:00.000Z",
      mediaId: NEW_MEDIA_ID,
    }),
    replace: vi.fn().mockResolvedValue(undefined),
  };
  const mediaService = mediaServiceMock as typeof mediaServiceMock & MediaService;
  return {
    rawDb: rawDb as never,
    rawDbMock: rawDb,
    rawStatements,
    mediaService,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    verifyPassword: vi.fn(),
    createPasswordHash: vi.fn(),
    destroySession: vi.fn(),
    clearSessionCookie: vi.fn(),
    getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
  };
}

function createProfileUploadSelect(profile: Record<string, unknown>) {
  return vi
    .fn()
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ roleLevel: 100, deletedAt: null, username: "Alpha" }]),
          })),
        })),
      })),
    })
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{
            userId: "u-1",
            availabilityTimezone: null,
            updatedAt: "2026-03-08T12:00:00.000Z",
            ...profile,
          }]),
        })),
      })),
    });
}

function createProfileMediaDb(profile: Record<string, unknown> = {}, updateError?: Error) {
  const updateWhere = updateError
    ? vi.fn().mockRejectedValue(updateError)
    : vi.fn().mockResolvedValue(undefined);
  return {
    db: {
      select: createProfileUploadSelect(profile),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    },
    updateWhere,
  };
}

describe("UserService", () => {
  it("updates the password and revokes all sessions in one D1 batch", async () => {
    const passwordUpdate = { query: "password-update" };
    const sessionDelete = { query: "session-delete" };
    const batch = vi.fn().mockResolvedValue([]);
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => passwordUpdate) })) }));
    const remove = vi.fn(() => ({ where: vi.fn(() => sessionDelete) }));
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ passwordHash: "old-hash", salt: "old-salt" }]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ username: "Alpha" }]) })) })) });
    const deps = createDeps();
    deps.verifyPassword.mockResolvedValue(true);
    deps.createPasswordHash.mockResolvedValue({ passwordHash: "new-hash", salt: "new-salt" });
    const service = new UserService({ select, update, delete: remove, batch } as never, deps);

    const result = await service.changePassword(
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      { currentPassword: "password123", newPassword: "new-password123", confirmNewPassword: "new-password123" },
    );

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(batch).toHaveBeenCalledWith([passwordUpdate, sessionDelete]);
    expect(deps.clearSessionCookie).toHaveBeenCalledOnce();
    expect(deps.destroySession).not.toHaveBeenCalled();
  });

  it("returns user stats from aggregate counts instead of full user rows", async () => {
    const from = vi.fn().mockResolvedValue([{ activeMembers: 2, totalMembers: 3 }]);
    const select = vi.fn(() => ({ from }));
    const service = new UserService({ select } as never, createDeps());

    const result = await (service as unknown as {
      getUserStats(): Promise<{ ok: true; data: { active_members: number; total_members: number } }>;
    }).getUserStats();

    expect(result).toEqual({ ok: true, data: { active_members: 2, total_members: 3 } });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("can list users without requesting an exact total count", async () => {
    const offset = vi.fn().mockResolvedValue([]);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const leftJoin = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ leftJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const service = new UserService({ select } as never, createDeps());

    await service.listUsers({
      page: 1,
      limit: 20,
      search: "",
      sessionUser: null,
      includeTotal: false,
    });

    expect(select).toHaveBeenCalledWith(expect.not.objectContaining({ _total: expect.anything() }));
  });

  it("uses the indexed profile class lookup instead of scanning profile JSON", async () => {
    let whereFilter: unknown;
    const offset = vi.fn().mockResolvedValue([]);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn((filter: unknown) => {
      whereFilter = filter;
      return { orderBy };
    });
    const leftJoin = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ leftJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const service = new UserService({ select } as never, createDeps());

    await service.listUsers({
      page: 1,
      limit: 20,
      search: "",
      classFilter: "鸣金虹",
      sessionUser: null,
      includeTotal: false,
    });

    const sqlDebug = inspect(whereFilter, { depth: 20 });
    expect(sqlDebug).toContain("member_profile_classes");
    expect(sqlDebug).not.toContain("json_each");
  });

  it("hides absence dates from the public roster payload", async () => {
    const offset = vi.fn().mockResolvedValue([{
      userId: "u-1",
      username: "Alpha",
      role: "member",
      roleName: "Member",
      roleColor: "gray",
      roleLevel: 100,
      isActive: true,
      deletedAt: null,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      userUpdatedAt: "2026-01-01T00:00:00.000Z",
      profileUserId: "u-1",
      power: 100,
      titleHtml: null,
      bio: null,
      availabilityTimezone: null,
      vacationStart: "2026-07-26",
      vacationEnd: "2026-07-30",
      notes: null,
      profileCreatedAt: "2026-01-01T00:00:00.000Z",
      profileUpdatedAt: "2026-01-01T00:00:00.000Z",
    }]);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const leftJoin = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ leftJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const deps = createDeps({
      classes: { "u-1": ["warrior", "healer"] },
      images: { "u-1": [MEDIA_ID, SECOND_MEDIA_ID] },
    });
    const service = new UserService({ select: vi.fn(() => ({ from })) } as never, deps);

    const result = await service.listUsers({
      page: 1,
      limit: 20,
      search: "",
      sessionUser: null,
      includeTotal: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data[0]).toMatchObject({
      user: {
        role: "member",
        role_name: "Member",
        role_color: "gray",
        role_level: 100,
      },
      profile: {
        classes: ["warrior", "healer"],
        images: [MEDIA_ID, SECOND_MEDIA_ID],
        vacation_start: null,
        vacation_end: null,
      },
    });
  });

  it("assembles authenticated availability from timezone and window rows", async () => {
    const offset = vi.fn().mockResolvedValue([{
      userId: "u-1",
      username: "Alpha",
      role: "member",
      roleName: "Member",
      roleColor: "gray",
      roleLevel: 100,
      isActive: true,
      deletedAt: null,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      userUpdatedAt: "2026-01-01T00:00:00.000Z",
      profileUserId: "u-1",
      power: 100,
      titleHtml: null,
      bio: null,
      availabilityTimezone: "UTC",
      vacationStart: null,
      vacationEnd: null,
      notes: null,
      profileCreatedAt: "2026-01-01T00:00:00.000Z",
      profileUpdatedAt: "2026-01-01T00:00:00.000Z",
    }]);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const leftJoin = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ leftJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const deps = createDeps({
      availability: {
        "u-1": [{ weekday: 1, startMinute: 540, endMinute: 600 }],
      },
    });
    const service = new UserService({ select: vi.fn(() => ({ from })) } as never, deps);

    const result = await service.listUsers({
      page: 1,
      limit: 20,
      search: "",
      sessionUser: { id: "viewer", permissions: new Set() } as never,
      includeTotal: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data.data[0] as { profile: { availability: MemberAvailability } }).profile.availability).toEqual({
      timezone: "UTC",
      days: {
        sunday: [],
        monday: [{ start_utc: "09:00", end_utc: "10:00" }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
      },
    });
  });

  it("updates the timezone and replaces availability windows in one D1 batch", async () => {
    const oldProfile = {
      userId: "u-1",
      power: 0,
      titleHtml: null,
      bio: null,
      availabilityTimezone: null,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const updatedUserProfile = {
      userId: "u-1",
      username: "Alpha",
      role: "member",
      roleName: "Member",
      roleColor: "gray",
      roleLevel: 100,
      isActive: true,
      deletedAt: null,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      userUpdatedAt: "2026-01-01T00:00:00.000Z",
      profileUserId: "u-1",
      power: 0,
      titleHtml: null,
      bio: null,
      availabilityTimezone: "UTC",
      vacationStart: null,
      vacationEnd: null,
      notes: null,
      profileCreatedAt: "2026-01-01T00:00:00.000Z",
      profileUpdatedAt: "2026-01-01T00:00:00.000Z",
    };
    const accessLimit = vi.fn().mockResolvedValue([{ roleLevel: 100, deletedAt: null, username: "Alpha" }]);
    const profileLimit = vi.fn().mockResolvedValue([oldProfile]);
    const updatedLimit = vi.fn().mockResolvedValue([updatedUserProfile]);
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: accessLimit })) })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: profileLimit })) })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: updatedLimit })) })),
          })),
        })),
      });
    let availabilityReadCount = 0;
    const statements: Array<{ sql: string; binds: unknown[]; all: ReturnType<typeof vi.fn> }> = [];
    const rawDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...binds: unknown[]) => {
          const statement = {
            sql,
            binds,
            all: vi.fn().mockImplementation(async () => {
              if (!sql.includes("FROM member_availability_windows")) return { results: [] };
              availabilityReadCount += 1;
              return {
                results: availabilityReadCount === 1 ? [] : [
                  { user_id: "u-1", weekday: 1, start_minute: 540, end_minute: 600 },
                ],
              };
            }),
          };
          statements.push(statement);
          return statement;
        }),
      })),
      batch: vi.fn().mockResolvedValue([]),
    };
    const deps = createDeps();
    deps.rawDb = rawDb as never;
    const service = new UserService({ select } as never, deps as never);

    const result = await service.updateProfile(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      {
        availability: {
          timezone: "UTC",
          days: {
            sunday: [],
            monday: [{ start_utc: "09:00", end_utc: "10:00" }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(rawDb.batch).toHaveBeenCalledOnce();
    const batched = rawDb.batch.mock.calls[0]?.[0] as typeof statements;
    expect(batched).toHaveLength(3);
    expect(batched[0]).toMatchObject({ binds: ["UTC", expect.any(String), "u-1"] });
    expect(batched[0]?.sql).toContain("availability_timezone = ?");
    expect(batched[1]).toMatchObject({ binds: ["u-1"] });
    expect(batched[1]?.sql).toContain("DELETE FROM member_availability_windows");
    expect(batched[2]).toMatchObject({ binds: ["u-1", 1, 540, 600] });
  });

  it("uses member-image entity quota and retains existing profile media ids", async () => {
    const deps = createDeps({ images: { "u-1": [MEDIA_ID] } });
    const { db } = createProfileMediaDb({ userId: "u-1", power: 0 });
    const service = new UserService(db as never, deps as never);

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      [{ full: new ArrayBuffer(5), view: new ArrayBuffer(5) }],
    );

    expect(result).toEqual({ ok: true, data: { media_ids: [NEW_MEDIA_ID] } });
    expect(deps.mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "member_image",
      scope: { kind: "entity", entityType: "member_profile", entityId: "u-1" },
      incomingCount: 1,
    }));
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: "u-1",
      media: [
        { mediaId: MEDIA_ID, sortOrder: 0 },
        { mediaId: NEW_MEDIA_ID, sortOrder: 1 },
      ],
    }));
  });

  it("passes the D1 media policy limit to MediaService without duplicating byte validation", async () => {
    const deps = createDeps();
    deps.getMediaPolicy.mockResolvedValue({
      ...DEFAULT_SITE_MEDIA_POLICY,
      max_file_size_bytes: {
        ...DEFAULT_SITE_MEDIA_POLICY.max_file_size_bytes,
        profile_image: 4,
      },
    });
    const { db } = createProfileMediaDb({ userId: "u-1", power: 0 });
    const service = new UserService(db as never, deps as never);

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      [{ full: new ArrayBuffer(5), view: new ArrayBuffer(5) }],
    );

    expect(result.ok).toBe(true);
    expect(deps.mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({ maxBytes: 4 }));
  });

  it("restores existing image links if updating the profile timestamp fails", async () => {
    const failure = new Error("profile update failed");
    const deps = createDeps({ images: { "u-1": [MEDIA_ID] } });
    const { db } = createProfileMediaDb({ userId: "u-1", power: 0 }, failure);
    const service = new UserService(db as never, deps as never);

    await expect(service.uploadProfileImages(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
    )).rejects.toBe(failure);

    expect(deps.mediaService.replace).toHaveBeenCalledTimes(2);
    expect(deps.mediaService.replace).toHaveBeenLastCalledWith(expect.objectContaining({
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
    }));
  });

  it("detaches requested image ids while retaining the rest", async () => {
    const deps = createDeps({ images: { "u-1": [MEDIA_ID, SECOND_MEDIA_ID, KEEP_MEDIA_ID] } });
    const { db } = createProfileMediaDb({ userId: "u-1", power: 0 });
    const service = new UserService(db as never, deps as never);

    const result = await service.deleteProfileImages(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      [MEDIA_ID, SECOND_MEDIA_ID],
    );

    expect(result).toEqual({ ok: true, data: { ok: true, deleted: 2 } });
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "member_profile",
      entityId: "u-1",
      slot: "image",
      media: [{ mediaId: KEEP_MEDIA_ID, sortOrder: 0 }],
    }));
  });

  it("creates avatars as full-and-view member_avatar assets without consuming profile quota", async () => {
    const deps = createDeps();
    const { db } = createProfileMediaDb({ userId: "u-1", power: 0 });
    const service = new UserService(db as never, deps as never);

    const result = await service.uploadAvatar(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      { full: new ArrayBuffer(1), view: new ArrayBuffer(1) },
    );

    expect(result).toEqual({ ok: true, data: { media_id: NEW_MEDIA_ID } });
    expect(deps.mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "member_avatar",
      uploads: [{ full: expect.any(ArrayBuffer), view: expect.any(ArrayBuffer) }],
    }));
    expect(deps.mediaService.checkQuota).not.toHaveBeenCalled();
  });

  it("stores the audio filename through the audio asset contract", async () => {
    const deps = createDeps();
    const { db } = createProfileMediaDb({ userId: "u-1", power: 0 });
    const service = new UserService(db as never, deps as never);
    const file = new File([new Uint8Array([1])], "voice.ogg", { type: "audio/ogg" });

    const result = await service.uploadProfileAudio(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      file,
    );

    expect(result).toEqual({ ok: true, data: { media_id: NEW_MEDIA_ID } });
    expect(deps.mediaService.createAudio).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: "u-1",
      originalName: "voice.ogg",
      data: expect.any(ArrayBuffer),
    }));
  });

  it("maps MediaService image validation errors without storing a second validation policy", async () => {
    const deps = createDeps();
    deps.mediaService.createImages.mockRejectedValueOnce(new MediaValidationError("Invalid WebP"));
    const { db } = createProfileMediaDb({ userId: "u-1", power: 0 });
    const service = new UserService(db as never, deps as never);

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
    );

    expect(result).toEqual({ ok: false, code: "VALIDATION_ERROR", message: "Invalid WebP" });
  });

  it("refuses to attach a media id that is not already linked to the profile", async () => {
    const update = vi.fn();
    const deps = createDeps({ images: { "u-1": [MEDIA_ID] } });
    const db = createProfileMediaDb({ userId: "u-1", power: 0 }).db;
    db.update = update;
    const service = new UserService(db as never, deps as never);

    const result = await service.updateProfile(
      { id: "u-1", role: "member", roleLevel: 100, permissions: new Set() } as never,
      "u-1",
      { images: [MEDIA_ID, SECOND_MEDIA_ID] },
    );

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: `images may only reorder or remove existing profile media: ${SECOND_MEDIA_ID}`,
    });
    expect(update).not.toHaveBeenCalled();
  });

});

describe("reserved system-test username namespace", () => {
  async function attemptRename(newUsername: string) {
    // Resolves to no auth row, so a username that passes the guard stops at the
    // password lookup rather than reaching an update.
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const service = new UserService({ select } as never, createDeps());
    const result = await service.changeUsername(
      { id: "member-1" } as never,
      "member-1",
      { currentPassword: "hunter2", newUsername },
    );
    return { result, select };
  }

  /*
   * System-test cleanup permanently deletes users in this namespace, so an
   * account must never be able to move into it — the row would be gone with
   * the next cleanup and no warning.
   */
  it("refuses to rename an account into the system-test namespace", async () => {
    const { result, select } = await attemptRename("systemtest_hijack");

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    // Rejected before the password check, so it cannot be used as a password oracle.
    expect(select).not.toHaveBeenCalled();
  });

  it("matches the reserved prefix case-insensitively", async () => {
    const { result } = await attemptRename("SystemTest_Hijack");
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("leaves usernames that merely resemble the prefix alone", async () => {
    // `systemtestX` is outside the namespace; the cron escapes the underscore
    // precisely so this name survives.
    const { select } = await attemptRename("systemtestX_member");
    expect(select).toHaveBeenCalled();
  });
});
