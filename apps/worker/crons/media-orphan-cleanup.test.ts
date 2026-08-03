import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_REFERENCE_BACKFILL_VERSION, runMediaOrphanCleanupCron } from "./media-orphan-cleanup";

vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/media-references", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/media-references")>();
  return {
    ...actual,
    deleteMediaRefs: vi.fn().mockResolvedValue(undefined),
    findUnreferencedKeys: vi.fn().mockResolvedValue([]),
    replaceMediaRefs: vi.fn().mockResolvedValue(undefined),
  };
});

import { deleteMediaRefs, findUnreferencedKeys, replaceMediaRefs } from "../services/media-references";

const NOW = new Date("2026-08-02T12:00:00.000Z").getTime();
const OLD_DATE = new Date(NOW - 49 * 60 * 60 * 1000);
const FRESH_DATE = new Date(NOW - 60 * 60 * 1000);
const DOMAINS = [
  "gallery",
  "event",
  "recurring_template",
  "announcement",
  "wiki_article",
  "class_icon",
  "storage_item",
  "member_profile",
  "site_config",
] as const;

type DbOptions = {
  missingDomains?: readonly string[];
  rows?: Record<string, unknown[]>;
  checkpointFailure?: Error;
  expiredLeaseRows?: Array<{ media_key: string }>;
  expiredLeaseOrphanKeys?: string[];
};

function createDb(options: DbOptions = {}) {
  const missing = new Set(options.missingDomains ?? []);
  let expiredLeasePageServed = false;
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...bindings: unknown[]) => ({
      first: vi.fn().mockImplementation(async () => {
        if (sql.includes("FROM media_reference_backfills")) {
          return missing.has(String(bindings[0])) ? null : { version: MEDIA_REFERENCE_BACKFILL_VERSION };
        }
        return null;
      }),
      all: vi.fn().mockImplementation(async () => {
        if (sql.includes("FROM media_upload_leases")) {
          if (expiredLeasePageServed) return { results: [] };
          expiredLeasePageServed = true;
          return { results: options.expiredLeaseRows ?? [] };
        }
        const match = Object.entries(options.rows ?? {}).find(([fragment]) => sql.includes(fragment));
        return { results: match?.[1] ?? [] };
      }),
      run: vi.fn().mockImplementation(async () => {
        if (sql.includes("INSERT INTO media_reference_backfills") && options.checkpointFailure) {
          throw options.checkpointFailure;
        }
        return { success: true, meta: { changes: 1 } };
      }),
    })),
  }));
  return {
    prepare,
    batch: vi.fn().mockResolvedValue([
      { results: [], success: true, meta: { changes: 0 } },
      { results: (options.expiredLeaseOrphanKeys ?? []).map((media_key) => ({ media_key })), success: true, meta: { changes: options.expiredLeaseOrphanKeys?.length ?? 0 } },
    ]),
  };
}

type ListedObject = { key: string; uploaded: Date };
type ListPage = { objects: ListedObject[]; truncated: boolean; cursor?: string };

function createEnv(
  dbOptions: DbOptions = {},
  list: (options: { prefix: string; cursor?: string; limit: number }) => ListPage = () => ({ objects: [], truncated: false }),
) {
  return {
    DB: createDb(dbOptions),
    MEDIA_ORPHAN_DELETE_MODE: "delete",
    MEDIA: {
      list: vi.fn().mockImplementation(list),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("runMediaOrphanCleanupCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.mocked(findUnreferencedKeys).mockResolvedValue([]);
    vi.mocked(replaceMediaRefs).mockResolvedValue(undefined);
    vi.mocked(deleteMediaRefs).mockResolvedValue(undefined);
  });

  it("uses per-domain checkpoints instead of a global media_references count", async () => {
    const env = createEnv();
    await runMediaOrphanCleanupCron(env as never);

    const sql = env.DB.prepare.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).not.toMatch(/COUNT\s*\(\s*\*\s*\).*media_references/i);
    for (const domain of DOMAINS) {
      expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("FROM media_reference_backfills"));
      expect(domain).toBeTruthy();
    }
    expect(replaceMediaRefs).not.toHaveBeenCalled();
  });

  it("never deletes a domain before its checkpoint commits", async () => {
    const env = createEnv({
      missingDomains: ["storage_item"],
      checkpointFailure: new Error("checkpoint unavailable"),
      rows: {
        "SELECT id FROM storage_items": [{ id: "item-1" }],
        "SELECT r2_key FROM storage_item_images": [{ r2_key: "storage/items/item-1/old.webp" }],
      },
    });

    await expect(runMediaOrphanCleanupCron(env as never)).rejects.toThrow("checkpoint unavailable");
    expect(replaceMediaRefs).toHaveBeenCalledWith(
      expect.anything(),
      "storage_item",
      "item-1",
      ["storage/items/item-1/old.webp"],
    );
    expect(env.MEDIA.list).not.toHaveBeenCalled();
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
  });

  it("backfills storage/items and commits its version before scanning the prefix", async () => {
    const env = createEnv(
      {
        missingDomains: ["storage_item"],
        rows: {
          "SELECT id FROM storage_items": [{ id: "item-1" }],
          "SELECT r2_key FROM storage_item_images": [{ r2_key: "storage/items/item-1/image.webp" }],
        },
      },
      ({ prefix }) => ({
        objects: prefix === "storage/items/"
          ? [{ key: "storage/items/item-1/image.webp", uploaded: OLD_DATE }]
          : [],
        truncated: false,
      }),
    );

    await runMediaOrphanCleanupCron(env as never);

    expect(replaceMediaRefs).toHaveBeenCalledWith(expect.anything(), "storage_item", "item-1", ["storage/items/item-1/image.webp"]);
    const checkpointCall = env.DB.prepare.mock.calls.find(([sql]) => sql.includes("INSERT INTO media_reference_backfills"));
    expect(checkpointCall).toBeTruthy();
    expect(env.MEDIA.list).toHaveBeenCalledWith({ prefix: "storage/items/", limit: 1000 });
  });

  it("streams every R2 page and deletes more than 1000 orphans without accumulating a prefix", async () => {
    const pages = new Map<string | undefined, ListPage>([
      [undefined, { objects: Array.from({ length: 1000 }, (_, index) => ({ key: `gallery/users/uploader/items/item-${index}/images/a.webp`, uploaded: OLD_DATE })), truncated: true, cursor: "page-2" }],
      ["page-2", { objects: Array.from({ length: 1000 }, (_, index) => ({ key: `gallery/users/uploader/items/item-${index + 1000}/images/a.webp`, uploaded: OLD_DATE })), truncated: true, cursor: "page-3" }],
      ["page-3", { objects: Array.from({ length: 500 }, (_, index) => ({ key: `gallery/users/uploader/items/item-${index + 2000}/images/a.webp`, uploaded: OLD_DATE })), truncated: false }],
    ]);
    const env = createEnv({}, ({ prefix, cursor }) =>
      prefix === "gallery/" ? pages.get(cursor)! : { objects: [], truncated: false },
    );
    vi.mocked(findUnreferencedKeys).mockImplementation(async (_db, keys) => [...keys]);

    const result = await runMediaOrphanCleanupCron(env as never);

    expect(env.MEDIA.list).toHaveBeenCalledWith({ prefix: "gallery/", cursor: "page-2", limit: 1000 });
    expect(env.MEDIA.list).toHaveBeenCalledWith({ prefix: "gallery/", cursor: "page-3", limit: 1000 });
    const deletedChunks = env.MEDIA.delete.mock.calls.map(([keys]) => keys as string[]);
    expect(deletedChunks.every((keys) => keys.length <= 1000)).toBe(true);
    expect(deletedChunks.reduce((total, keys) => total + keys.length, 0)).toBe(2500);
    expect(result.prefixes.find((entry) => entry.prefix === "gallery/")).toMatchObject({
      objectsSeen: 2500,
      candidates: 2500,
      orphansDeleted: 2500,
    });
  });

  it("honors the grace window on the storage prefix", async () => {
    const env = createEnv({}, ({ prefix }) => ({
      objects: prefix === "storage/items/"
        ? [
            { key: "storage/items/item-1/old.webp", uploaded: OLD_DATE },
            { key: "storage/items/item-1/fresh.webp", uploaded: FRESH_DATE },
          ]
        : [],
      truncated: false,
    }));
    vi.mocked(findUnreferencedKeys).mockImplementation(async (_db, keys) => [...keys]);

    await runMediaOrphanCleanupCron(env as never);

    expect(findUnreferencedKeys).toHaveBeenCalledWith(expect.anything(), ["storage/items/item-1/old.webp"]);
    expect(env.MEDIA.delete).toHaveBeenCalledWith(["storage/items/item-1/old.webp"]);
    expect(env.MEDIA.delete).not.toHaveBeenCalledWith(expect.arrayContaining(["storage/items/item-1/fresh.webp"]));
  });

  it("reports orphan candidates without deleting anything when deletion mode is not enabled", async () => {
    const env = createEnv({}, ({ prefix }) => ({
      objects: prefix === "gallery/"
        ? [{ key: "gallery/users/uploader/items/item-1/images/a.webp", uploaded: OLD_DATE }]
        : [],
      truncated: false,
    }));
    env.MEDIA_ORPHAN_DELETE_MODE = "report";
    vi.mocked(findUnreferencedKeys).mockImplementation(async (_db, keys) => [...keys]);

    const result = await runMediaOrphanCleanupCron(env as never);

    expect(result.mode).toBe("report");
    expect(result.expiredLeaseObjectsDeleted).toBe(0);
    expect(result.deletedUserMediaKeys).toBe(0);
    expect(result.prefixes.find((entry) => entry.prefix === "gallery/")).toMatchObject({
      orphansFound: 1,
      orphansDeleted: 0,
    });
    expect(env.DB.batch).not.toHaveBeenCalled();
    expect(deleteMediaRefs).not.toHaveBeenCalled();
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
  });

  it("purges expired leases without deleting objects that gained a persistent reference", async () => {
    const referencedKey = "announcement/staged-1/images/referenced.webp";
    const orphanKey = "announcement/staged-1/images/orphan.webp";
    const env = createEnv({
      expiredLeaseRows: [{ media_key: referencedKey }, { media_key: orphanKey }],
      expiredLeaseOrphanKeys: [orphanKey],
    });

    const result = await runMediaOrphanCleanupCron(env as never);

    const sql = env.DB.prepare.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("DELETE FROM media_upload_leases");
    expect(sql).toContain("EXISTS (SELECT 1 FROM media_references");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM media_references");
    expect(env.MEDIA.delete).toHaveBeenCalledWith([orphanKey]);
    expect(env.MEDIA.delete).not.toHaveBeenCalledWith(expect.arrayContaining([referencedKey]));
    expect(result.expiredLeaseObjectsDeleted).toBe(1);
  });

  it("clears references before purging every page of a retained soft-deleted member prefix", async () => {
    const env = createEnv(
      { rows: { "SELECT id FROM users": [{ id: "old-user" }] } },
      ({ prefix, cursor }) => {
        if (prefix !== "members/old-user/") return { objects: [], truncated: false };
        if (!cursor) return { objects: [{ key: "members/old-user/images/a.webp", uploaded: OLD_DATE }], truncated: true, cursor: "next" };
        return { objects: [{ key: "members/old-user/audio/b.ogg", uploaded: OLD_DATE }], truncated: false };
      },
    );

    const result = await runMediaOrphanCleanupCron(env as never);

    expect(deleteMediaRefs).toHaveBeenCalledWith(expect.anything(), "member_profile", "old-user");
    expect(env.MEDIA.delete).toHaveBeenNthCalledWith(1, ["members/old-user/images/a.webp"]);
    expect(env.MEDIA.delete).toHaveBeenNthCalledWith(2, ["members/old-user/audio/b.ogg"]);
    expect(result.deletedUserMediaKeys).toBe(2);
  });
});
