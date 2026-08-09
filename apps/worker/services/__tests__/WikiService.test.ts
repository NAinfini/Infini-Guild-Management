
import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

vi.mock("nanoid", () => ({ nanoid: vi.fn(() => "generated-id") }));

import { WikiService } from "../WikiService";
import type { MediaService } from "../MediaService";

// Minimal D1Database mock that captures batch/run calls.
function createRawDb(options: { batchError?: Error; firstResponses?: unknown[] } = {}) {
  const firstResponses = [...(options.firstResponses ?? [])];
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  const batchMock = options.batchError
    ? vi.fn().mockRejectedValue(options.batchError)
    : vi.fn((batchStatements: unknown[]) => Promise.resolve(
        batchStatements.map(() => ({ results: [], success: true, meta: { changes: 1 } })),
      ));
  const runMock = vi.fn().mockResolvedValue({ results: [], success: true, meta: {} });
  const prepareMock = vi.fn((sql: string) => ({
    bind: vi.fn((...bindings: unknown[]) => {
      statements.push({ sql, bindings });
      return {
        sql,
        bindings,
        run: runMock,
        first: vi.fn().mockImplementation(async () => firstResponses.shift() ?? null),
        // 图片上传入口开头会先回收过期租约；这里没有过期租约，扫描一轮就返回。
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
    }),
  }));
  return {
    rawDb: { prepare: prepareMock, batch: batchMock } as unknown as D1Database,
    batchMock,
    runMock,
    prepareMock,
    statements,
  };
}

function createDeps(rawDb: D1Database = createRawDb().rawDb) {
  const mediaService = {
    checkQuota: vi.fn().mockResolvedValue(true),
    createImages: vi.fn().mockResolvedValue({
      expiresAt: "2026-08-09T00:00:00.000Z",
      mediaIds: ["Vbcdefghijklmnopqrstu"],
    }),
    listLinkedMediaIds: vi.fn().mockResolvedValue(["Abcdefghijklmnopqrstu"]),
    replace: vi.fn().mockResolvedValue(undefined),
    deleteAssets: vi.fn().mockResolvedValue(1),
  };
  return {
    mediaService: mediaService as typeof mediaService & MediaService,
    rawDb,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    buildAuditLogStatements: vi.fn((input: { action: string }) => (
      [{ audit: input.action } as unknown as D1PreparedStatement]
    )),
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

const WIKI_MEDIA_ID = "Abcdefghijklmnopqrstu";
const NEW_WIKI_MEDIA_ID = "Vbcdefghijklmnopqrstu";

function bodyWithImage(mediaId: string): string {
  return JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: `/api/media/${mediaId}/view` } }] });
}

function createSequentialWikiDb(rowsBySelect: unknown[][]) {
  const pending = [...rowsBySelect];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const rows = pending.shift() ?? [];
        const promise = Promise.resolve(rows);
        return {
          limit: vi.fn().mockResolvedValue(rows),
          then: promise.then.bind(promise),
          catch: promise.catch.bind(promise),
          finally: promise.finally.bind(promise),
        };
      }),
    })),
  }));
  return { select };
}

function createArticleListDb() {
  const offset = vi.fn().mockResolvedValue([]);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn((..._expressions: SQL[]) => ({ limit }));
  const where = vi.fn()
    .mockReturnValueOnce({ orderBy })
    .mockResolvedValueOnce([{ count: 0 }]);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select }, orderBy };
}

function toOrderSql(expressions: SQL[]): string[] {
  return expressions.map((expression) =>
    new SQLiteSyncDialect().sqlToQuery(expression).sql.replaceAll('"', ""));
}


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
  // 形参不能省：省掉之后 vi.fn 把签名推成零参，mock.calls 就是 []，
  // 断言里取 calls[0][0] 会被 TS 判成「长度 0 的元组没有下标 0」。
  const setMock = vi.fn((_patch: Record<string, unknown>) => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  return {
    db: { select: selectMock, insert: insertMock, update: updateMock, delete: deleteMock },
    mocks: { selectMock, insertMock, updateMock, setMock, deleteMock, deleteWhereMock },
  };
}

const BASE_CATEGORY_ROW = {
  id: "cat1",
  name: "Guides",
  slug: "guides",
  sortOrder: 0,
  parentId: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

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
    it.each([
      [
        "the default curated order",
        undefined,
        [
          "wiki_articles.pinned desc",
          "wiki_articles.sort_order asc",
          "wiki_articles.updated_at desc",
          "wiki_articles.id asc",
        ],
      ],
      [
        "updated descending order",
        "updated_desc",
        [
          "wiki_articles.pinned desc",
          "wiki_articles.updated_at desc",
          "wiki_articles.id desc",
        ],
      ],
      [
        "updated ascending order",
        "updated_asc",
        [
          "wiki_articles.pinned desc",
          "wiki_articles.updated_at asc",
          "wiki_articles.id asc",
        ],
      ],
    ] as const)("uses stable pagination for %s", async (_label, sort, expectedOrder) => {
      const { db, orderBy } = createArticleListDb();
      const service = new WikiService(db as never, createDeps());

      await service.listArticles({
        page: 1,
        limit: 50,
        ...(sort ? { sort } : {}),
      });

      expect(toOrderSql(orderBy.mock.calls[0] ?? [])).toEqual(expectedOrder);
    });

  });

  describe("updateCategory", () => {
    it("stamps updated_at on the single-row path, same as the batch path does", async () => {
      const { rawDb } = createRawDb();
      const { db, mocks } = createCrudDb(BASE_CATEGORY_ROW);
      const service = new WikiService(db as never, createDeps(rawDb));

      const before = new Date().toISOString();
      await service.updateCategory("u1", "cat1", { name: "Renamed" });

      const patch = mocks.setMock.mock.calls[0]?.[0];
      expect(patch).toBeDefined();
      expect(patch?.name).toBe("Renamed");
      expect(patch?.updatedAt).toBeTypeOf("string");
      expect(String(patch?.updatedAt) >= before).toBe(true);
    });

    it("still writes updated_at when the request changes no other field", async () => {
      // 空 patch 会让 Drizzle 的 set({}) 抛错；无条件写 updatedAt 顺带兜住这一条。
      const { rawDb } = createRawDb();
      const { db, mocks } = createCrudDb(BASE_CATEGORY_ROW);
      const service = new WikiService(db as never, createDeps(rawDb));

      await service.updateCategory("u1", "cat1", {});

      expect(Object.keys(mocks.setMock.mock.calls[0]?.[0] ?? {})).toEqual(["updatedAt"]);
    });
  });

  describe("unified article media lifecycle", () => {
    it("attaches canonical rich-text media ids when creating article revision one", async () => {
      const { batchMock, rawDb } = createRawDb();
      const db = createSequentialWikiDb([[], [BASE_ARTICLE_ROW]]);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps as never);

      const result = await service.createArticle("u1", {
        title: "My Article",
        category_id: "cat1",
        body_json: bodyWithImage(WIKI_MEDIA_ID),
        sort_order: 0,
        pinned: false,
      });

      expect(result.ok).toBe(true);
      expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
        entityType: "wiki_article",
        slot: "body",
        media: [{ mediaId: WIKI_MEDIA_ID, sortOrder: 0 }],
        ownerUserId: "u1",
      }));
      expect(batchMock).toHaveBeenCalledTimes(1);
      const sql = (batchMock.mock.calls[0]?.[0] as Array<{ sql?: string }>).map((statement) => statement.sql ?? "").join("\n");
      expect(sql).toContain("INSERT INTO wiki_articles");
      expect(sql).toContain("INSERT INTO wiki_revisions");
      expect(batchMock.mock.invocationCallOrder[0]).toBeLessThan(
        (deps.mediaService.replace as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
      );
    });

    it("deletes the article parent if initial media attachment fails", async () => {
      const failure = new Error("article attachment failed");
      const { rawDb, prepareMock, runMock } = createRawDb();
      const db = createSequentialWikiDb([[]]);
      const deps = createDeps(rawDb);
      (deps.mediaService.replace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
      const service = new WikiService(db as never, deps as never);

      await expect(service.createArticle("u1", {
        title: "My Article",
        category_id: "cat1",
        body_json: bodyWithImage(WIKI_MEDIA_ID),
        sort_order: 0,
        pinned: false,
      })).rejects.toBe(failure);

      expect(prepareMock).toHaveBeenLastCalledWith("DELETE FROM wiki_articles WHERE id = ?1");
      expect(runMock).toHaveBeenCalledOnce();
    });

    it("keeps media referenced by retained revisions after the current body removes it", async () => {
      const existing = { ...BASE_ARTICLE_ROW, bodyJson: bodyWithImage(WIKI_MEDIA_ID) };
      const updated = { ...BASE_ARTICLE_ROW, bodyJson: '{"content":[]}', updatedBy: "u1" };
      const db = createSequentialWikiDb([
        [existing],
        [{ revision: 1, bodyJson: bodyWithImage(WIKI_MEDIA_ID) }],
        [updated],
      ]);
      const { rawDb } = createRawDb();
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps as never);

      const result = await service.updateArticle("u1", "art1", { body_json: '{"content":[]}' });

      expect(result.ok).toBe(true);
      expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
        entityType: "wiki_article",
        entityId: "art1",
        media: [{ mediaId: WIKI_MEDIA_ID, sortOrder: 0 }],
      }));
    });

    it("drops media after the only referencing revision is pruned", async () => {
      const revisions = Array.from({ length: 50 }, (_, index) => ({
        revision: index + 1,
        bodyJson: index === 0 ? bodyWithImage(WIKI_MEDIA_ID) : '{"content":[]}',
      }));
      const updated = { ...BASE_ARTICLE_ROW, title: "Next", updatedBy: "u1" };
      const db = createSequentialWikiDb([[BASE_ARTICLE_ROW], revisions, [updated]]);
      const { rawDb } = createRawDb();
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps as never);

      const result = await service.updateArticle("u1", "art1", { title: "Next" });

      expect(result.ok).toBe(true);
      expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({ media: [] }));
      expect(rawDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM wiki_revisions"));
    });

    it("restores prior links when a revision update batch fails", async () => {
      const failure = new Error("revision batch failed");
      const db = createSequentialWikiDb([
        [BASE_ARTICLE_ROW],
        [{ revision: 1, bodyJson: bodyWithImage(WIKI_MEDIA_ID) }],
      ]);
      const { rawDb } = createRawDb({ batchError: failure });
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps as never);

      await expect(service.updateArticle("u1", "art1", { title: "Next" })).rejects.toBe(failure);

      expect(deps.mediaService.replace).toHaveBeenCalledTimes(2);
      expect(deps.mediaService.replace).toHaveBeenLastCalledWith(expect.objectContaining({
        media: [{ mediaId: WIKI_MEDIA_ID, sortOrder: 0 }],
      }));
    });

    it("does not replace article links when only pinned changes", async () => {
      const { rawDb } = createRawDb();
      const { db } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps as never);

      await service.updateArticle("u1", "art1", { pinned: true });

      expect(deps.mediaService.replace).not.toHaveBeenCalled();
    });

    it("rejects restoring a revision identical to current content without touching media", async () => {
      const { rawDb } = createRawDb();
      const { db, mocks } = createCrudDb(BASE_ARTICLE_ROW);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps as never);

      const result = await service.restoreRevision("u1", "art1", 1);

      expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
      expect(mocks.updateMock).not.toHaveBeenCalled();
      expect(deps.mediaService.replace).not.toHaveBeenCalled();
    });

    it("deletes revisions before the article parent and lets lifecycle triggers remove links", async () => {
      const { batchMock, rawDb } = createRawDb();
      const db = createSequentialWikiDb([[BASE_ARTICLE_ROW]]);
      const deps = createDeps(rawDb);
      const service = new WikiService(db as never, deps as never);

      const result = await service.permanentDeleteArticle("u1", "art1");

      expect(result).toEqual({ ok: true, data: { ok: true } });
      expect(deps.mediaService.replace).not.toHaveBeenCalled();
      const sql = (batchMock.mock.calls[0]?.[0] as Array<{ sql?: string }>).map((statement) => statement.sql ?? "");
      expect(sql.findIndex((statement) => statement.includes("DELETE FROM wiki_revisions"))).toBeLessThan(
        sql.findIndex((statement) => statement.includes("DELETE FROM wiki_articles")),
      );
    });

    it("creates pending wiki image assets under entity quota", async () => {
      const db = createSequentialWikiDb([[BASE_ARTICLE_ROW]]);
      const deps = createDeps();
      const service = new WikiService(db as never, deps as never);

      const result = await service.uploadArticleImages(
        "u1",
        "art1",
        [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
        10,
        5_000_000,
      );

      expect(result).toEqual({ ok: true, data: { media_ids: [NEW_WIKI_MEDIA_ID] } });
      expect(deps.mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({
        purpose: "wiki_image",
        scope: { kind: "entity", entityType: "wiki_article", entityId: "art1" },
      }));
      expect(deps.mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({
        purpose: "wiki_image",
        maxBytes: 5_000_000,
      }));
    });

    it("deletes assets created by this call if post-create work fails", async () => {
      const failure = new Error("audit failed");
      const db = createSequentialWikiDb([[BASE_ARTICLE_ROW]]);
      const deps = createDeps();
      deps.writeAuditLog.mockRejectedValueOnce(failure);
      const service = new WikiService(db as never, deps as never);

      await expect(service.uploadArticleImages(
        "u1",
        "art1",
        [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
        10,
        5_000_000,
      )).rejects.toBe(failure);

      expect(deps.mediaService.deleteAssets).toHaveBeenCalledWith([NEW_WIKI_MEDIA_ID]);
    });
  });

  describe("deleteCategory", () => {
    it("blocks deletion and calls no media refs when category has articles", async () => {
      // deleteCategory returns CONFLICT when articles exist — no ref cleanup needed
      const { batchMock, runMock, rawDb } = createRawDb();
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

  describe("batchUpdateCategories", () => {
    const CATEGORY_ROWS = [
      { id: "root", name: "Root", slug: "root", sortOrder: 0, parentId: null, createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
      { id: "guides", name: "Guides", slug: "guides", sortOrder: 1, parentId: null, createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
      { id: "combat", name: "Combat", slug: "combat", sortOrder: 2, parentId: "guides", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
    ];

    /* select().from() 直接可 await（整表读），再 .orderBy() 才是 listCategories 那一条。 */
    function createCategoryDb(rows = CATEGORY_ROWS) {
      const fromMock = vi.fn(() => ({
        then: (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(rows).then(onFulfilled),
        orderBy: vi.fn().mockResolvedValue(rows),
      }));
      return { select: vi.fn(() => ({ from: fromMock })) };
    }

    /* 把 prepare/bind 的入参原样留下来，好断言到底发了哪几条 UPDATE。 */
    function createRecordingRawDb() {
      const batchMock = vi.fn().mockResolvedValue([]);
      const prepareMock = vi.fn((sql: string) => ({
        bind: (...bindings: unknown[]) => ({ sql, bindings }),
      }));
      return {
        rawDb: { prepare: prepareMock, batch: batchMock } as unknown as D1Database,
        batchMock,
      };
    }

    it("writes every category update plus one batch_update audit row in a single D1 batch", async () => {
      const { rawDb, batchMock } = createRecordingRawDb();
      const deps = createDeps(rawDb);
      const service = new WikiService(createCategoryDb() as never, deps);

      const result = await service.batchUpdateCategories("u1", [
        { id: "guides", name: "Guides & Tips" },
        { id: "combat", sort_order: 5, parent_id: null },
      ]);

      expect(result.ok).toBe(true);
      expect(batchMock).toHaveBeenCalledTimes(1);

      const statements = batchMock.mock.calls[0]?.[0] as Array<{ sql?: string; bindings?: unknown[]; audit?: string }>;
      expect(statements).toHaveLength(3);
      expect(statements[0]?.sql).toMatch(/^UPDATE wiki_categories SET name = \?, updated_at = \? WHERE id = \?$/);
      expect(statements[0]?.bindings?.at(0)).toBe("Guides & Tips");
      expect(statements[0]?.bindings?.at(-1)).toBe("guides");
      expect(statements[1]?.sql).toMatch(/^UPDATE wiki_categories SET parent_id = \?, sort_order = \?, updated_at = \? WHERE id = \?$/);
      expect(statements[1]?.bindings?.slice(0, 2)).toEqual([null, 5]);
      /* 审计条目和 UPDATE 在同一个 batch 里——不是事后补写的。 */
      expect(statements[2]?.audit).toBe("batch_update");
      expect(deps.buildAuditLogStatements).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "wiki_category", action: "batch_update", entityId: "batch" }),
      );
    });

    it("rejects the whole batch when it would nest two levels deep, even though each row alone is legal", async () => {
      const { rawDb, batchMock } = createRecordingRawDb();
      const deps = createDeps(rawDb);
      const service = new WikiService(createCategoryDb() as never, deps);

      // guides 目前是顶层、combat 挂在它下面。这一批把 guides 也挂到 root 下面：
      // 单看 guides 这一行合法（root 没有父级），但落库后 combat 就成了第三层。
      const result = await service.batchUpdateCategories("u1", [{ id: "guides", parent_id: "root" }]);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
      expect(batchMock).not.toHaveBeenCalled();
    });

    it("rejects the whole batch when any id is unknown", async () => {
      const { rawDb, batchMock } = createRecordingRawDb();
      const deps = createDeps(rawDb);
      const service = new WikiService(createCategoryDb() as never, deps);

      const result = await service.batchUpdateCategories("u1", [
        { id: "guides", sort_order: 9 },
        { id: "ghost", sort_order: 10 },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("NOT_FOUND");
      expect(batchMock).not.toHaveBeenCalled();
    });

    it("rejects a category that would become its own parent", async () => {
      const { rawDb, batchMock } = createRecordingRawDb();
      const service = new WikiService(createCategoryDb() as never, createDeps(rawDb));

      const result = await service.batchUpdateCategories("u1", [{ id: "guides", parent_id: "guides" }]);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
      expect(batchMock).not.toHaveBeenCalled();
    });

    it("rejects a parent that does not exist", async () => {
      const { rawDb, batchMock } = createRecordingRawDb();
      const service = new WikiService(createCategoryDb() as never, createDeps(rawDb));

      const result = await service.batchUpdateCategories("u1", [{ id: "root", parent_id: "ghost" }]);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("NOT_FOUND");
      expect(batchMock).not.toHaveBeenCalled();
    });
  });
});
