import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
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
            limit: vi.fn().mockResolvedValue([{ role: "member", deletedAt: null }]),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  userId: "u-1",
                  username: "Alpha",
                  role: "member",
                  isActive: true,
                  deletedAt: null,
                  userCreatedAt: "2026-03-08T12:00:00.000Z",
                  userUpdatedAt: "2026-03-08T12:00:00.000Z",
                  profileId: "profile-1",
                  profileUserId: "u-1",
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
                  profileCreatedAt: "2026-03-08T12:00:00.000Z",
                  profileUpdatedAt: "2026-03-08T12:00:00.000Z",
                },
              ]),
            })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ id: "profile-1" }]),
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
});
