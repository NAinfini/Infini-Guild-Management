import { describe, expect, it, vi, beforeEach } from "vitest";
import { runMediaOrphanCleanupCron } from "./media-orphan-cleanup";

vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/media-references", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/media-references")>();
  return {
    ...actual,
    findUnreferencedKeys: vi.fn(),
    replaceMediaRefs: vi.fn(),
  };
});

import { findUnreferencedKeys, replaceMediaRefs } from "../services/media-references";

const NOW = new Date("2024-06-01T12:00:00.000Z").getTime();

/** An uploaded Date older than GRACE_HOURS (48 h) */
const OLD_DATE = new Date(NOW - 49 * 60 * 60 * 1000);
/** An uploaded Date within the grace window */
const FRESH_DATE = new Date(NOW - 1 * 60 * 60 * 1000);

function createMockDb(overrides: Record<string, { results: unknown[] }> = {}) {
  return {
    prepare: vi.fn((sql: string) => {
      const match = Object.keys(overrides).find((k) => sql.includes(k));
      const result = match ? overrides[match] : { results: [] };
      return {
        bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue(result), first: vi.fn().mockResolvedValue(null) }),
        all: vi.fn().mockResolvedValue(result),
        first: vi.fn().mockResolvedValue(null),
      };
    }),
    batch: vi.fn().mockResolvedValue([]),
  };
}

function createMockEnv(
  dbOverrides: Record<string, { results: unknown[] }> = {},
  mediaList: (opts: { prefix: string }) => { objects: { key: string; uploaded: Date }[]; truncated: boolean } = () => ({
    objects: [],
    truncated: false,
  }),
) {
  return {
    DB: {
      ...createMockDb(dbOverrides),
      // Override prepare to return a properly chained mock for COUNT(*) as well
      prepare: vi.fn((sql: string) => {
        if (sql.includes("COUNT(*)")) {
          return {
            first: vi.fn().mockResolvedValue({ cnt: 1 }),
            all: vi.fn().mockResolvedValue({ results: [{ cnt: 1 }] }),
            bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ cnt: 1 }), all: vi.fn().mockResolvedValue({ results: [{ cnt: 1 }] }) }),
          };
        }
        const match = Object.keys(dbOverrides).find((k) => sql.includes(k));
        const result = match ? dbOverrides[match] : { results: [] };
        return {
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue(result), first: vi.fn().mockResolvedValue(null) }),
          all: vi.fn().mockResolvedValue(result),
          first: vi.fn().mockResolvedValue(null),
        };
      }),
    },
    MEDIA: {
      list: vi.fn().mockImplementation(mediaList),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("runMediaOrphanCleanupCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  // ── Soft-deleted user purge (unchanged behaviour) ─────────────────────────

  it("deletes media for users soft-deleted more than 7 days ago", async () => {
    const env = createMockEnv(
      {},
      (opts) => {
        if (opts.prefix === "members/old-user/") {
          return { objects: [{ key: "members/old-user/avatar.png", uploaded: OLD_DATE }], truncated: false };
        }
        return { objects: [], truncated: false };
      },
    );

    // Override prepare so the users query returns an old-user row
    env.DB.prepare = vi.fn((sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE deleted_at")) {
        return {
          all: vi.fn().mockResolvedValue({ results: [{ id: "old-user" }] }),
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [{ id: "old-user" }] }) }),
          first: vi.fn().mockResolvedValue(null),
        };
      }
      if (sql.includes("COUNT(*)")) {
        return {
          first: vi.fn().mockResolvedValue({ cnt: 1 }),
          all: vi.fn().mockResolvedValue({ results: [] }),
          bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ cnt: 1 }), all: vi.fn().mockResolvedValue({ results: [] }) }),
        };
      }
      return {
        all: vi.fn().mockResolvedValue({ results: [] }),
        bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }), first: vi.fn().mockResolvedValue(null) }),
        first: vi.fn().mockResolvedValue(null),
      };
    });

    vi.mocked(findUnreferencedKeys).mockResolvedValue([]);

    await runMediaOrphanCleanupCron(env as never);

    expect(env.MEDIA.delete).toHaveBeenCalledWith(["members/old-user/avatar.png"]);
  });

  it("does not delete member media when no soft-deleted users qualify", async () => {
    const env = createMockEnv();
    vi.mocked(findUnreferencedKeys).mockResolvedValue([]);

    await runMediaOrphanCleanupCron(env as never);

    // delete should not be called at all if nothing is found
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
  });

  // ── Grace period ──────────────────────────────────────────────────────────

  it("does not treat freshly-uploaded objects as orphan candidates", async () => {
    const env = createMockEnv(
      {},
      (opts) => {
        if (opts.prefix === "gallery/images/") {
          return {
            objects: [{ key: "gallery/images/new.png", uploaded: FRESH_DATE }],
            truncated: false,
          };
        }
        return { objects: [], truncated: false };
      },
    );

    vi.mocked(findUnreferencedKeys).mockResolvedValue([]);

    await runMediaOrphanCleanupCron(env as never);

    // findUnreferencedKeys should have been called with an empty array for gallery prefix
    // (the fresh key is excluded from candidates) — nothing to delete
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
    // Verify that the fresh key was never passed to findUnreferencedKeys
    const calls = vi.mocked(findUnreferencedKeys).mock.calls;
    for (const [, keys] of calls) {
      expect(keys).not.toContain("gallery/images/new.png");
    }
  });

  // ── Referenced keys kept ─────────────────────────────────────────────────

  it("keeps referenced old keys and deletes only unreferenced ones", async () => {
    const env = createMockEnv(
      {},
      (opts) => {
        if (opts.prefix === "gallery/images/") {
          return {
            objects: [
              { key: "gallery/images/keep.png", uploaded: OLD_DATE },
              { key: "gallery/images/orphan.png", uploaded: OLD_DATE },
            ],
            truncated: false,
          };
        }
        return { objects: [], truncated: false };
      },
    );

    // Simulate: keep.png is referenced, orphan.png is not
    vi.mocked(findUnreferencedKeys).mockImplementation(async (_db, keys) => {
      return (keys as string[]).filter((k) => k === "gallery/images/orphan.png");
    });

    await runMediaOrphanCleanupCron(env as never);

    expect(env.MEDIA.delete).toHaveBeenCalledWith(["gallery/images/orphan.png"]);
    // Should not delete the keep key
    const allDeleteCalls = vi.mocked(env.MEDIA.delete).mock.calls.flat(2) as string[];
    expect(allDeleteCalls).not.toContain("gallery/images/keep.png");
  });

  // ── Backfill triggered when count = 0 ────────────────────────────────────

  it("runs backfill when media_references table is empty (count = 0)", async () => {
    const env = createMockEnv();

    // Override COUNT(*) to return 0 → trigger backfill
    env.DB.prepare = vi.fn((sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return {
          first: vi.fn().mockResolvedValue({ cnt: 0 }),
          all: vi.fn().mockResolvedValue({ results: [] }),
          bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ cnt: 0 }), all: vi.fn().mockResolvedValue({ results: [] }) }),
        };
      }
      if (sql.includes("SELECT id FROM users WHERE deleted_at")) {
        return {
          all: vi.fn().mockResolvedValue({ results: [] }),
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
          first: vi.fn().mockResolvedValue(null),
        };
      }
      // All content table queries return one row each to exercise the backfill paths
      if (sql.includes("gallery_items")) {
        return {
          all: vi.fn().mockResolvedValue({ results: [{ id: "gi-1", url: "gallery/images/photo.png" }] }),
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
          first: vi.fn().mockResolvedValue(null),
        };
      }
      if (sql.includes("recurring_templates")) {
        return {
          all: vi.fn().mockResolvedValue({ results: [{ id: "rt-1", attachments: '["events/template/file.pdf"]' }] }),
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
          first: vi.fn().mockResolvedValue(null),
        };
      }
      if (sql.includes("FROM events")) {
        return {
          all: vi.fn().mockResolvedValue({ results: [{ id: "ev-1", attachments: '["events/ev-1/attach.png"]' }] }),
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
          first: vi.fn().mockResolvedValue(null),
        };
      }
      if (sql.includes("announcements")) {
        return {
          all: vi.fn().mockResolvedValue({ results: [{ id: "ann-1", body_json: null }] }),
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
          first: vi.fn().mockResolvedValue(null),
        };
      }
      if (sql.includes("wiki_articles")) {
        return {
          all: vi.fn().mockResolvedValue({ results: [{ id: "wiki-1", body_json: null }] }),
          bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
          first: vi.fn().mockResolvedValue(null),
        };
      }
      return {
        all: vi.fn().mockResolvedValue({ results: [] }),
        bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }), first: vi.fn().mockResolvedValue(null) }),
        first: vi.fn().mockResolvedValue(null),
      };
    });

    vi.mocked(findUnreferencedKeys).mockResolvedValue([]);
    vi.mocked(replaceMediaRefs).mockResolvedValue(undefined);

    await runMediaOrphanCleanupCron(env as never);

    // replaceMediaRefs should have been called for the gallery_item row
    expect(replaceMediaRefs).toHaveBeenCalledWith(expect.anything(), "gallery_item", "gi-1", ["gallery/images/photo.png"]);
    // and for the event row
    expect(replaceMediaRefs).toHaveBeenCalledWith(expect.anything(), "event", "ev-1", ["events/ev-1/attach.png"]);
    // and for the recurring_template row (latent bug fix)
    expect(replaceMediaRefs).toHaveBeenCalledWith(expect.anything(), "recurring_template", "rt-1", ["events/template/file.pdf"]);
  });

  it("skips backfill when media_references table has rows (count > 0)", async () => {
    const env = createMockEnv();
    vi.mocked(findUnreferencedKeys).mockResolvedValue([]);
    vi.mocked(replaceMediaRefs).mockResolvedValue(undefined);

    // Default mock returns cnt: 1 → no backfill
    await runMediaOrphanCleanupCron(env as never);

    expect(replaceMediaRefs).not.toHaveBeenCalled();
  });

  // ── Chunked deletion ──────────────────────────────────────────────────────

  it("deletes orphans in chunks of ≤1000", async () => {
    // Generate 2500 old orphan keys for the gallery prefix
    const orphanKeys = Array.from({ length: 2500 }, (_, i) => `gallery/images/orphan-${i}.png`);

    const env = createMockEnv(
      {},
      (opts) => {
        if (opts.prefix === "gallery/images/") {
          return {
            objects: orphanKeys.map((key) => ({ key, uploaded: OLD_DATE })),
            truncated: false,
          };
        }
        return { objects: [], truncated: false };
      },
    );

    vi.mocked(findUnreferencedKeys).mockImplementation(async (_db, keys) => keys as string[]);

    await runMediaOrphanCleanupCron(env as never);

    const deleteCalls = vi.mocked(env.MEDIA.delete).mock.calls;
    // All chunks should be ≤ 1000
    for (const [arg] of deleteCalls) {
      const keys = arg as string[];
      expect(keys.length).toBeLessThanOrEqual(1000);
    }
    // Total deleted should equal the number of orphans
    const totalDeleted = deleteCalls.reduce((sum, [arg]) => sum + (arg as string[]).length, 0);
    expect(totalDeleted).toBe(2500);
  });
});
