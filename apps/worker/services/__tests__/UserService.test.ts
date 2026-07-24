import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_MEDIA_POLICY } from "@guild/shared";
import { UserService } from "../UserService";

function createDeps() {
  return {
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    storeProfileImage: vi.fn(),
    storeProfileAudio: vi.fn(),
    deleteMediaObject: vi.fn(),
    verifyPassword: vi.fn(),
    createPasswordHash: vi.fn(),
    destroySession: vi.fn(),
    getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
  };
}

describe("UserService", () => {
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
    const from = vi.fn(() => ({ leftJoin }));
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
    const from = vi.fn(() => ({ leftJoin }));
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

  it("deletes multiple profile images with one profile update", async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ role: "member", deletedAt: null, username: "Alpha" }]),
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
                classes: "[]",
                titleHtml: null,
                bio: null,
                images: JSON.stringify(["one.png", "two.png", "keep.png"]),
                avatarKey: null,
                audioKey: null,
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
    const deps = createDeps();
    deps.deleteMediaObject.mockResolvedValue(undefined);
    const service = new UserService({ select, update: vi.fn(() => ({ set: updateSet })) } as never, deps);

    const result = await (service as unknown as {
      deleteProfileImages(
        sessionUser: { id: string; role: "member"; permissions: ReadonlySet<string> },
        targetUserId: string,
        imageKeys: string[],
      ): Promise<{ ok: true; data: { ok: true; deleted: number } }>;
    }).deleteProfileImages({ id: "u-1", role: "member", permissions: new Set() }, "u-1", ["one.png", "two.png"]);

    expect(result).toEqual({ ok: true, data: { ok: true, deleted: 2 } });
    expect(deps.deleteMediaObject).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ images: JSON.stringify(["keep.png"]) }));
  });

  it("returns validation errors from profile image storage without throwing", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ role: "member", deletedAt: null, username: "Alpha" }]),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ userId: "u-1", images: "[]", avatarKey: null }]),
          })),
        })),
      });
    const deps = createDeps();
    deps.storeProfileImage.mockRejectedValue(new Error("File bytes do not match declared type: image/png"));
    const service = new UserService({ select } as never, deps);
    const file = new File([new Uint8Array([1, 2, 3])], "bad.png", { type: "image/png" });

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-1",
      [file],
    );

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "File bytes do not match declared type: image/png",
    });
  });

  it("rejects profile images over the configured media policy before storage", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ role: "member", deletedAt: null, username: "Alpha" }]),
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
    const file = new File([new Uint8Array(5)], "large.png", { type: "image/png" });

    const result = await service.uploadProfileImages(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-1",
      [file],
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(deps.storeProfileImage).not.toHaveBeenCalled();
  });
});
