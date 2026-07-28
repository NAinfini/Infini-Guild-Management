import { describe, expect, it, vi } from "vitest";
import { AnnouncementService } from "../AnnouncementService";
import { signAnnouncementImageStagingToken } from "../announcement-image-staging";

// Minimal D1Database mock that captures batch/run calls.
function createRawDb() {
  const batchMock = vi.fn().mockResolvedValue([]);
  const runMock = vi.fn().mockResolvedValue({ results: [], success: true, meta: {} });
  const bindMock = vi.fn().mockReturnValue({ run: runMock, first: vi.fn().mockResolvedValue(null) });
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
    publishAnnouncementPublished: vi.fn().mockResolvedValue(undefined),
    signingSecret: "test-secret",
  };
}

function createListDb(rows: unknown[] = []) {
  const offset = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update },
    calls: { select, update, set, updateWhere },
  };
}

// Builds a Drizzle-like db mock for CRUD operations.
// The service calls:
//   select(COLS).from(table).where(cond).limit(1)  → awaited as array
//   select(LIST_COLS).from(table).where(cond).orderBy(...).limit(n).offset(n)  → awaited as array
//   insert(table).values(...)  → awaited
//   update(table).set(patch).where(cond)  → awaited
//   delete(table).where(cond)  → awaited
// Also: select({count}).from(table).where(cond)  → awaited as array (for count queries)
function createCrudDb(row: Record<string, unknown>) {
  // where() must return something awaitable as an array (for count queries like
  // select({count}).from(table).where(cond)) AND chainable with .limit()/.orderBy().
  // We make .where() return a thenable that also has .limit() and .orderBy().
  function makeChainResult(resolveValue: unknown[]) {
    const result: Record<string, unknown> = {
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
    return result;
  }

  const fromMock = vi.fn(() => ({
    where: vi.fn(() => makeChainResult([row])),
  }));

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

const BASE_ANNOUNCEMENT_ROW = {
  id: "ann1",
  title: "T",
  bodyJson: '{"content":[]}',
  pinned: false,
  status: "draft",
  publishAt: null,
  expiresAt: null,
  archivedAt: null,
  createdBy: "u1",
  updatedBy: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("AnnouncementService", () => {
  it("does not write announcement state while listing announcements", async () => {
    const { db, calls } = createListDb();
    const service = new AnnouncementService(db as never, createDeps());

    await service.list({ canReadAll: false, page: 1, limit: 20, archived: false });

    expect(calls.update).not.toHaveBeenCalled();
  });

  it("calls replaceMediaRefs after create", async () => {
    const { batchMock, rawDb } = createRawDb();
    const { db } = createCrudDb(BASE_ANNOUNCEMENT_ROW);
    const deps = createDeps(rawDb);
    const service = new AnnouncementService(db as never, deps);

    await service.create("u1", { title: "T", body_json: '{"content":[]}', pinned: false, status: "draft" });

    // replaceMediaRefs issues a db.batch with at least the DELETE statement
    expect(batchMock).toHaveBeenCalled();
  });

  it("creates a staged announcement and its media references in one raw D1 batch", async () => {
    const id = "Abcdefghijklmnopqrstu";
    const rawDb = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database;
    let lookups = 0;
    const row = { ...BASE_ANNOUNCEMENT_ROW, id };
    const db = {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: vi.fn().mockImplementation(() => Promise.resolve(lookups++ === 0 ? [] : [row])) }) }) })),
    };
    const deps = createDeps(rawDb);
    deps.media = { head: vi.fn().mockResolvedValue({ key: `announcement/${id}/images/a.png` }) } as unknown as R2Bucket;
    const service = new AnnouncementService(db as never, deps);
    const token = await signAnnouncementImageStagingToken("test-secret", { version: 1, purpose: "announcement-image-staging", announcement_id: id, actor_id: "u1", exp: Math.floor(Date.now() / 1000) + 60 });
    const body = JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: `/api/announcements/image?key=${encodeURIComponent(`announcement/${id}/images/a.png`)}` } }] });

    const result = await service.create("u1", { title: "T", body_json: body, pinned: false, status: "draft", staging_token: token });

    expect(result.ok).toBe(true);
    expect(rawDb.batch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({}),
    ]));
    expect(rawDb.batch).toHaveBeenCalledTimes(1);
    expect((rawDb.batch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(3);
  });

  it("does not turn ordinary announcement text into a media reference on update", async () => {
    const bodyJson = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "announcement/ann1/images/not-an-image-node.png" }] }] });
    const { batchMock, rawDb } = createRawDb();
    const { db } = createCrudDb({ ...BASE_ANNOUNCEMENT_ROW, bodyJson });
    const service = new AnnouncementService(db as never, createDeps(rawDb));

    await service.update("u1", "ann1", { body_json: bodyJson });

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0]![0]).toHaveLength(1);
  });

  it("calls replaceMediaRefs after update when body_json is provided", async () => {
    const { batchMock, rawDb } = createRawDb();
    const { db } = createCrudDb(BASE_ANNOUNCEMENT_ROW);
    const deps = createDeps(rawDb);
    const service = new AnnouncementService(db as never, deps);

    await service.update("u1", "ann1", { body_json: '{"content":[]}' });

    expect(batchMock).toHaveBeenCalled();
  });

  it("does NOT call replaceMediaRefs after update when body_json is absent", async () => {
    const { batchMock, rawDb } = createRawDb();
    const { db } = createCrudDb(BASE_ANNOUNCEMENT_ROW);
    const deps = createDeps(rawDb);
    const service = new AnnouncementService(db as never, deps);

    await service.update("u1", "ann1", { title: "New title" });

    expect(batchMock).not.toHaveBeenCalled();
  });

  it("calls deleteMediaRefs after permanentDelete", async () => {
    const { runMock, rawDb, prepareMock } = createRawDb();
    const { db } = createCrudDb(BASE_ANNOUNCEMENT_ROW);
    const deps = createDeps(rawDb);
    const service = new AnnouncementService(db as never, deps);

    await service.permanentDelete("u1", "ann1");

    // deleteMediaRefs calls prepare(...).bind(...).run()
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM media_references"));
    expect(runMock).toHaveBeenCalled();
  });
});
