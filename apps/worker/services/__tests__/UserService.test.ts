import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_MEDIA_POLICY } from "@guild/shared";
import { UserService } from "../UserService";

type RelationFixtures = {
  classes?: Record<string, string[]>;
  images?: Record<string, string[]>;
};

function createDeps(relations: RelationFixtures = {}) {
  const rawStatements: Array<{ sql: string; binds: unknown[] }> = [];
  const rawDb = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => {
        const relationRows = sql.includes("FROM member_profile_classes")
          ? relations.classes
          : sql.includes("FROM member_profile_images")
            ? relations.images
            : undefined;
        const statement = {
          sql,
          binds,
          all: vi.fn().mockResolvedValue({
            results: binds.flatMap((ownerId) =>
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
  return {
    rawDb: rawDb as never,
    rawDbMock: rawDb,
    rawStatements,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    storeProfileImage: vi.fn(),
    storeProfileAudio: vi.fn(),
    deleteMediaObject: vi.fn(),
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
            avatarKey: null,
            audioKey: null,
            updatedAt: "2026-03-08T12:00:00.000Z",
            ...profile,
          }]),
        })),
      })),
    });
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
      profileId: "profile-1",
      profileUserId: "u-1",
      power: 100,
      titleHtml: null,
      bio: null,
      avatarKey: null,
      audioKey: null,
      videoUrls: "[]",
      availability: null,
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
      images: { "u-1": ["members/u-1/images/one.webp", "members/u-1/images/two.webp"] },
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
        images: ["members/u-1/images/one.webp", "members/u-1/images/two.webp"],
        vacation_start: null,
        vacation_end: null,
      },
    });
  });

  it("records only managed media owned by the profile when deleting images", async () => {
    const select = vi
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
            limit: vi.fn().mockResolvedValue([
              {
                id: "profile-1",
                userId: "u-1",
                power: 0,
                titleHtml: null,
                bio: null,
                avatarKey: "members/u-1/images/avatar.webp",
                audioKey: "members/u-1/audio/profile.mp3",
                videoUrls: "[]",
                availability: null,
                vacationStart: null,
                vacationEnd: null,
                notes: null,
                createdAt: "2026-03-08T12:00:00.000Z",
                updatedAt: "2026-03-08T12:00:00.000Z",
              },
            ]),
          })),
        })),
      });
    const deps = createDeps({
      images: {
        "u-1": [
          "members/u-1/images/one.webp",
          "members/u-1/images/two.webp",
          "members/u-1/images/keep.webp",
          "/mock/profile.webp",
          "https://cdn.example.com/profile.webp",
          "events/evt-1/images/poster.webp",
          "members/u-2/images/foreign.webp",
        ],
      },
    });
    deps.deleteMediaObject.mockResolvedValue(undefined);
    const service = new UserService({ select } as never, deps);

    const result = await (service as unknown as {
      deleteProfileImages(
        sessionUser: { id: string; role: "member"; permissions: ReadonlySet<string> },
        targetUserId: string,
        imageKeys: string[],
      ): Promise<{ ok: true; data: { ok: true; deleted: number } }>;
    }).deleteProfileImages(
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      ["members/u-1/images/one.webp", "members/u-1/images/two.webp"],
    );

    expect(result).toEqual({ ok: true, data: { ok: true, deleted: 2 } });
    expect(deps.deleteMediaObject).toHaveBeenCalledTimes(2);
    expect(deps.rawDbMock.batch).toHaveBeenCalledTimes(1);
    expect(deps.rawDbMock.batch.mock.invocationCallOrder[0]).toBeLessThan(
      deps.deleteMediaObject.mock.invocationCallOrder[0]!,
    );
    expect(deps.rawStatements
      .filter(({ sql }) => sql.includes("INSERT INTO member_profile_images"))
      .map(({ binds }) => binds)).toEqual([
      ["u-1", "members/u-1/images/keep.webp", 0],
      ["u-1", "/mock/profile.webp", 1],
      ["u-1", "https://cdn.example.com/profile.webp", 2],
      ["u-1", "events/evt-1/images/poster.webp", 3],
      ["u-1", "members/u-2/images/foreign.webp", 4],
    ]);
    expect(deps.rawStatements
      .filter(({ sql }) => sql.includes("INSERT OR IGNORE INTO media_references"))
      .map(({ binds }) => binds)).toEqual([
      ["members/u-1/images/keep.webp", "member_profile", "u-1"],
      ["members/u-1/images/avatar.webp", "member_profile", "u-1"],
      ["members/u-1/audio/profile.mp3", "member_profile", "u-1"],
    ]);
  });

  it("returns validation errors from profile image storage without throwing", async () => {
    const select = vi
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
            limit: vi.fn().mockResolvedValue([{ userId: "u-1", avatarKey: null }]),
          })),
        })),
      });
    const deps = createDeps();
    deps.storeProfileImage.mockRejectedValue(new Error("File bytes do not match declared type: image/png"));
    const service = new UserService({ select } as never, deps);
    const file = new File([new Uint8Array([1, 2, 3])], "bad.webp", { type: "image/webp" });

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      [file],
    );

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "File bytes do not match declared type: image/png",
    });
  });

  it("removes earlier profile uploads when a later file fails validation", async () => {
    const deps = createDeps();
    deps.storeProfileImage
      .mockResolvedValueOnce("members/u-1/images/one.png")
      .mockRejectedValueOnce(new Error("File bytes do not match declared type: image/png"));
    deps.deleteMediaObject.mockResolvedValue(undefined);
    const service = new UserService({
      select: createProfileUploadSelect({}),
    } as never, deps);

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      [
        new File([new Uint8Array([1])], "one.webp", { type: "image/webp" }),
        new File([new Uint8Array([2])], "two.webp", { type: "image/webp" }),
      ],
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(deps.deleteMediaObject).toHaveBeenCalledWith("members/u-1/images/one.png");
  });

  it("removes profile image keys when the atomic profile/reference update fails", async () => {
    const failure = new Error("profile update failed");
    const deps = createDeps({ images: { "u-1": ["members/u-1/images/existing.png"] } });
    deps.rawDbMock.batch.mockRejectedValueOnce(failure);
    deps.storeProfileImage.mockResolvedValue("members/u-1/images/new.png");
    deps.deleteMediaObject.mockResolvedValue(undefined);
    const service = new UserService({
      select: createProfileUploadSelect({}),
    } as never, deps);

    await expect(service.uploadProfileImages(
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      [new File([new Uint8Array([1])], "new.webp", { type: "image/webp" })],
    )).rejects.toBe(failure);

    expect(deps.deleteMediaObject).toHaveBeenCalledWith("members/u-1/images/new.png");
    expect(deps.rawDbMock.batch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "avatar",
      method: "uploadAvatar" as const,
      store: "storeProfileImage" as const,
      key: "members/u-1/images/avatar.png",
      file: new File([new Uint8Array([1])], "avatar.webp", { type: "image/webp" }),
    },
    {
      label: "audio",
      method: "uploadProfileAudio" as const,
      store: "storeProfileAudio" as const,
      key: "members/u-1/audio/profile.wav",
      file: new File([new Uint8Array([1])], "profile.wav", { type: "audio/wav" }),
    },
  ])("removes a newly stored $label when its profile update fails", async ({ method, store, key, file }) => {
    const failure = new Error(`${method} update failed`);
    const deps = createDeps();
    deps.rawDbMock.batch.mockRejectedValueOnce(failure);
    deps[store].mockResolvedValue(key);
    deps.deleteMediaObject.mockResolvedValue(undefined);
    const service = new UserService({
      select: createProfileUploadSelect({}),
    } as never, deps);

    await expect(service[method](
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      file,
    )).rejects.toBe(failure);

    expect(deps.deleteMediaObject).toHaveBeenCalledWith(key);
    expect(deps.rawDbMock.batch).toHaveBeenCalledTimes(1);
  });

  it("rejects profile images over the configured media policy before storage", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ roleLevel: 100, deletedAt: null, username: "Alpha" }]),
            })),
          })),
        })),
      });
    const deps = createDeps();
    deps.getMediaPolicy = vi.fn().mockResolvedValue({
      max_file_size_bytes: {
        profile_image: 4,
        profile_audio: 1024,
        announcement_image: 1024,
        wiki_image: 1024,
        event_image: 1024,
        gallery_image: 1024,
      },
      quotas: {
        profile: 10,
        announcement: 10,
        gallery: 20,
        wiki: 10,
      },
    });
    const service = new UserService({ select } as never, deps);
    const file = new File([new Uint8Array(5)], "large.webp", { type: "image/webp" });

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      [file],
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(deps.storeProfileImage).not.toHaveBeenCalled();
  });

  it("refuses to attach an R2 key that is not already on the profile", async () => {
    const update = vi.fn();
    const select = vi
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
            limit: vi.fn().mockResolvedValue([
              { userId: "u-1", avatarKey: null },
            ]),
          })),
        })),
      });
    const deps = createDeps({ images: { "u-1": ["members/u-1/own.webp"] } });
    const service = new UserService({ select, update } as never, deps);

    const result = await service.updateProfile(
      { id: "u-1", role: "member", permissions: new Set() } as never,
      "u-1",
      { images: ["members/u-1/own.webp", "members/victim/avatar.webp"] },
    );

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "images may only reorder or remove existing profile media: members/victim/avatar.webp",
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
