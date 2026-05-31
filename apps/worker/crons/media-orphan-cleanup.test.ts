import { describe, expect, it, vi, beforeEach } from "vitest";
import { runMediaOrphanCleanupCron } from "./media-orphan-cleanup";

vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createMockEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    },
    MEDIA: {
      list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("runMediaOrphanCleanupCron", () => {
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    env = createMockEnv();
  });

  it("deletes media for users soft-deleted more than 7 days ago", async () => {
    env.DB.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE deleted_at")) {
        return {
          all: async () => ({ results: [{ id: "old-user" }] }),
          bind: () => ({ all: async () => ({ results: [{ id: "old-user" }] }) }),
        };
      }
      return {
        all: async () => ({ results: [] }),
        bind: () => ({ all: async () => ({ results: [] }) }),
      };
    });

    env.MEDIA.list.mockImplementation(async (opts: { prefix: string }) => {
      if (opts.prefix === "members/old-user/") {
        return { objects: [{ key: "members/old-user/avatar.png" }], truncated: false };
      }
      return { objects: [], truncated: false };
    });

    await runMediaOrphanCleanupCron(env as never);
    expect(env.MEDIA.delete).toHaveBeenCalledWith(["members/old-user/avatar.png"]);
  });

  it("does not delete media when no soft-deleted users qualify", async () => {
    await runMediaOrphanCleanupCron(env as never);
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
  });

  it("deletes orphaned gallery keys not referenced by any gallery_items row", async () => {
    env.DB.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT url FROM gallery_items")) {
        return {
          all: async () => ({ results: [{ url: "gallery/images/keep.png" }] }),
          bind: () => ({ all: async () => ({ results: [{ url: "gallery/images/keep.png" }] }) }),
        };
      }
      return {
        all: async () => ({ results: [] }),
        bind: () => ({ all: async () => ({ results: [] }) }),
      };
    });

    env.MEDIA.list.mockImplementation(async (opts: { prefix: string }) => {
      if (opts.prefix === "gallery/images/") {
        return {
          objects: [
            { key: "gallery/images/keep.png" },
            { key: "gallery/images/orphan.png" },
          ],
          truncated: false,
        };
      }
      return { objects: [], truncated: false };
    });

    await runMediaOrphanCleanupCron(env as never);
    expect(env.MEDIA.delete).toHaveBeenCalledWith(["gallery/images/orphan.png"]);
  });
});
