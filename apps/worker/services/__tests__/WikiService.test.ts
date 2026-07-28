import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { WikiService } from "../WikiService";

// Minimal D1Database mock that captures batch/run calls.
function createRawDb() {
  const batchMock = vi.fn().mockResolvedValue([]);
  const runMock = vi.fn().mockResolvedValue({ results: [], success: true, meta: {} });
  const bindMock = vi.fn().mockReturnValue({ run: runMock });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
  return {
    rawDb: { prepare: prepareMock, batch: batchMock } as unknown as D1Database,
    batchMock,
    runMock,
    prepareMock,
  };
}

function createDeps(rawDb: D1Database = createRawDb().rawDb) {
  return {
    media: {} as R2Bucket,
    rawDb,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
  };
}

const BASE_ARTICLE_ROW = {
  id: "art1",
  title: "My Article",
  slug: "my-article",
  categoryId: "cat1",
  bodyJson: '{"content":[]}',
  sortOrder: 0,
  pinned: false,
  archivedAt: null,
  createdBy: "u1",
  updatedBy: null,
  updatedByUsername: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

// Builds a Drizzle-like db mock for CRUD operations.
// Handles both:
//   select().from().where().limit(1)   → resolves to array (getById)
//   select().from().where()            → resolves to array (slug uniqueness check)
//   select().from().where().orderBy().limit(n).offset(n)  → list
function createCrudDb(articleRow: Record<string, unknown>) {
  // where() returns a thenable AND has .limit()/.orderBy() for chaining
  function makeChainResult(resolveValue: unknown[]) {
    return {
      then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolveValue).then(onFulfilled, onRejected),
      catch: (onRejected: (e: unknown) => unknown) => Promise.resolve(resolveValue).catch(onRejected),
      limit: vi.fn().mockResolvedValue(resolveValue),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          offset: vi.fn().mockResolvedValue(resolveValue),
        })),
      })),
    };
  }

  const fromMock = vi.fn(() => ({ where: vi.fn(() => makeChainResult([articleRow])) }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  const updateWhereMock = vi.fn().mockResolvedValue(undefined);
  const setMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  return {
    db: { select: selectMock, insert: insertMock, update: updateMock, delete: deleteMock },
    mocks: { selectMock, insertMock, updateMock, deleteMock, deleteWhereMock },
  };
}

describe("WikiService", () => {
  describe("listArticles", () => {
    it("filters the database by every selected category before pagination", async () => {
      const whereMock = vi.fn()
        .mockReturnValueOnce({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn().mockResolvedValue([BASE_ARTICLE_ROW]),
            })),
          })),
        })
        .mockResolvedValueOnce([{ count: 1 }]);
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: whereMock })),
        })),
      };
      const service = new WikiService(db as never, createDeps());

      await service.listArticles({
        page: 1,
        limit: 50,
        categoryIds: ["cat1", "cat2"],
      });

      const whereSql = whereMock.mock.calls[0]?.[0] as SQL;
      const query = new SQLiteSyncDialect().sqlToQuery(whereSql);
      expect(query.sql).toMatch(/category_id"? in \(\?, \?\)/i);
      expect(query.params).toEqual(["cat1", "cat2"]);
    });
  });

  describe("createArticle", () => {
    it("calls replaceMediaRefs after successful article create", async () => {
      const { batchMock, rawDb } = createRawDb();
      const { db } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      await service.createArticle("u1", {
        title: "My Article",
        category_id: "cat1",
        body_json: '{"content":[]}',
        sort_order: 0,
        pinned: false,
      });

      // replaceMediaRefs calls db.batch with at least the DELETE statement
      expect(batchMock).toHaveBeenCalled();
    });

    it("records revision 1 on article create", async () => {
      const { rawDb } = createRawDb();
      const { db, mocks } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      await service.createArticle("u1", {
        title: "My Article",
        category_id: "cat1",
        body_json: '{"content":[]}',
        sort_order: 0,
        pinned: false,
      });

      // Two inserts: the article row and its initial revision snapshot
      expect(mocks.insertMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("updateArticle", () => {
    it("calls replaceMediaRefs after update when body_json is provided", async () => {
      const { batchMock, rawDb } = createRawDb();
      const { db } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      await service.updateArticle("u1", "art1", { body_json: '{"content":[]}' });

      expect(batchMock).toHaveBeenCalled();
    });

    it("does NOT call replaceMediaRefs after update when body_json is absent", async () => {
      const { batchMock, rawDb } = createRawDb();
      const { db } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      await service.updateArticle("u1", "art1", { title: "New title" });

      expect(batchMock).not.toHaveBeenCalled();
    });

    it("records revision snapshots when the title changes", async () => {
      const { rawDb } = createRawDb();
      const { db, mocks } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      await service.updateArticle("u1", "art1", { title: "New title" });

      // Legacy article (no revisions yet): baseline snapshot + new snapshot
      expect(mocks.insertMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT record a revision when only pinned changes", async () => {
      const { rawDb } = createRawDb();
      const { db, mocks } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      await service.updateArticle("u1", "art1", { pinned: true });

      expect(mocks.insertMock).not.toHaveBeenCalled();
    });
  });

  describe("restoreRevision", () => {
    it("rejects restoring a revision identical to the current content", async () => {
      const { rawDb } = createRawDb();
      // Generic mock returns the same row for article and revision lookups,
      // so title/body always match → identical-content guard must trigger.
      const { db, mocks } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      const result = await service.restoreRevision("u1", "art1", 1);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
      expect(mocks.updateMock).not.toHaveBeenCalled();
      expect(deps.writeAuditLog).not.toHaveBeenCalled();
    });
  });

  describe("permanentDeleteArticle", () => {
    it("calls deleteMediaRefs after article deletion", async () => {
      const { runMock, rawDb, prepareMock } = createRawDb();
      const { db } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      await service.permanentDeleteArticle("u1", "art1");

      // deleteMediaRefs calls prepare(...).bind(...).run()
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM media_references"));
      expect(runMock).toHaveBeenCalled();
    });
  });

  describe("deleteCategory", () => {
    it("blocks deletion and calls no media refs when category has articles", async () => {
      // deleteCategory returns CONFLICT when articles exist — no ref cleanup needed
      const { batchMock, runMock, rawDb } = createRawDb();
      // Mock: hasArticles check returns a row, blocking delete
      const limitMock = vi.fn().mockResolvedValue([{ id: "art1" }]);
      const whereMock = vi.fn(() => ({ limit: limitMock }));
      const fromMock = vi.fn(() => ({ where: whereMock }));
      const selectMock = vi.fn(() => ({ from: fromMock }));
      const db = { select: selectMock };
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps);

      const result = await service.deleteCategory("u1", "cat1");

      expect(result.ok).toBe(false);
      expect(batchMock).not.toHaveBeenCalled();
      expect(runMock).not.toHaveBeenCalled();
    });
  });
});
