import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import { AnnouncementService } from "../AnnouncementService";
import type { MediaService } from "../MediaService";

const MEDIA_ID = "Abcdefghijklmnopqrstu";
const EXISTING_MEDIA_ID = "Vbcdefghijklmnopqrstu";

function bodyWithImage(mediaId: string): string {
  return JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: `/api/media/${mediaId}/view` } }] });
}

const BASE_ANNOUNCEMENT_ROW = {
  id: "ann1",
  title: "T",
  bodyJson: '{"content":[]}',
  pinned: false,
  status: "draft" as const,
  publishAt: null,
  expiresAt: null,
  archivedAt: null,
  createdBy: "u1",
  updatedBy: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function createRawDb(runError?: Error) {
  const run = runError ? vi.fn().mockRejectedValue(runError) : vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return { rawDb: { prepare } as unknown as D1Database, prepare, bind, run };
}

function createMediaService() {
  return {
    checkQuota: vi.fn().mockResolvedValue(true),
    createImages: vi.fn().mockResolvedValue({
      expiresAt: "2026-08-09T00:00:00.000Z",
      mediaIds: [MEDIA_ID],
    }),
    listLinkedMediaIds: vi.fn().mockResolvedValue([EXISTING_MEDIA_ID]),
    replace: vi.fn().mockResolvedValue(undefined),
    deleteAssets: vi.fn().mockResolvedValue(1),
  };
}

function createDeps(rawDb: D1Database = createRawDb().rawDb) {
  return {
    mediaService: createMediaService() as ReturnType<typeof createMediaService> & MediaService,
    rawDb,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    publishAnnouncementPublished: vi.fn().mockResolvedValue(undefined),
  };
}

function createListDb(rows: unknown[] = []) {
  const offset = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn((..._expressions: SQL[]) => ({ limit }));
  const where = vi.fn(() => ({ orderBy, then: Promise.resolve(rows).then.bind(Promise.resolve(rows)) }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn();
  return { db: { select, update }, calls: { orderBy, update } };
}

function createCrudDb(row: Record<string, unknown>, options: { updateError?: Error; deleteError?: Error } = {}) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([row]) }) }),
  }));
  const updateWhere = options.updateError
    ? vi.fn().mockRejectedValue(options.updateError)
    : vi.fn().mockResolvedValue(undefined);
  const update = vi.fn(() => ({ set: () => ({ where: updateWhere }) }));
  const deleteWhere = options.deleteError
    ? vi.fn().mockRejectedValue(options.deleteError)
    : vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn(() => ({ where: deleteWhere }));
  return { db: { select, update, delete: remove }, calls: { update, updateWhere, remove, deleteWhere } };
}

describe("AnnouncementService", () => {
  it("does not write announcement state while listing announcements", async () => {
    const { db, calls } = createListDb();
    const service = new AnnouncementService(db as never, createDeps());

    await service.list({ canReadAll: false, page: 1, limit: 20, archived: false });

    expect(calls.update).not.toHaveBeenCalled();
  });

  it.each([
    ["the default descending order", undefined, ["desc", "desc"]],
    ["ascending updated order", "updated_asc", ["asc", "asc"]],
  ] as const)("uses pinned-first stable pagination for %s", async (_label, sort, directions) => {
    const { db, calls } = createListDb();
    const service = new AnnouncementService(db as never, createDeps());

    await service.list({ canReadAll: false, page: 1, limit: 20, archived: false, ...(sort ? { sort } : {}) });

    const orderSql = (calls.orderBy.mock.calls[0] ?? []).map((expression) =>
      new SQLiteSyncDialect().sqlToQuery(expression).sql.replaceAll('"', ""));
    expect(orderSql).toHaveLength(3);
    expect(orderSql[0]).toBe("announcements.pinned desc");
    expect(orderSql[1]).toBe(`announcements.updated_at ${directions[0]}`);
    expect(orderSql[2]).toBe(`announcements.id ${directions[1]}`);
  });

  it("attaches only canonical rich-text media ids when creating an announcement", async () => {
    const { rawDb, run } = createRawDb();
    const deps = createDeps(rawDb);
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);
    const body = JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: `/api/media/${MEDIA_ID}/view` } }] });

    const result = await service.create("u1", { title: "T", body_json: body, pinned: false, status: "draft" });

    expect(result.ok).toBe(true);
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "announcement",
      slot: "body",
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
      ownerUserId: "u1",
    }));
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(
      (deps.mediaService.replace as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it("does not attach media if the announcement insert fails", async () => {
    const failure = new Error("announcement insert failed");
    const { rawDb } = createRawDb(failure);
    const deps = createDeps(rawDb);
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);

    await expect(service.create("u1", {
      title: "T",
      body_json: JSON.stringify({ src: `/api/media/${MEDIA_ID}/view` }),
      pinned: false,
      status: "draft",
    })).rejects.toBe(failure);

    expect(deps.mediaService.replace).not.toHaveBeenCalled();
  });

  it("deletes the announcement parent if media attachment fails", async () => {
    const failure = new Error("announcement attachment failed");
    const { rawDb, prepare, run } = createRawDb();
    const deps = createDeps(rawDb);
    (deps.mediaService.replace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);

    await expect(service.create("u1", {
      title: "T",
      body_json: bodyWithImage(MEDIA_ID),
      pinned: false,
      status: "draft",
    })).rejects.toBe(failure);

    expect(prepare).toHaveBeenLastCalledWith("DELETE FROM announcements WHERE id = ?1");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("surfaces both media attachment and parent cleanup failures", async () => {
    const attachmentFailure = new Error("announcement attachment failed");
    const cleanupFailure = new Error("announcement cleanup failed");
    const { rawDb, run } = createRawDb();
    run.mockResolvedValueOnce({ meta: { changes: 1 } }).mockRejectedValueOnce(cleanupFailure);
    const deps = createDeps(rawDb);
    (deps.mediaService.replace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(attachmentFailure);
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);

    const promise = service.create("u1", {
      title: "T",
      body_json: bodyWithImage(MEDIA_ID),
      pinned: false,
      status: "draft",
    });

    await expect(promise).rejects.toMatchObject({
      name: "AggregateError",
      errors: [attachmentFailure, cleanupFailure],
    });
  });

  it("does not replace media when an update omits body_json", async () => {
    const deps = createDeps();
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);

    await service.update("u1", "ann1", { title: "New title" });

    expect(deps.mediaService.replace).not.toHaveBeenCalled();
  });

  it("replaces body links with canonical media ids on update", async () => {
    const deps = createDeps();
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);
    const body = JSON.stringify({
      type: "doc",
      content: [{ type: "image", attrs: { src: `/api/media/${MEDIA_ID}/view` } }],
    });

    await service.update("u1", "ann1", { body_json: body });

    expect(deps.mediaService.listLinkedMediaIds).toHaveBeenCalledWith("announcement", "ann1", "body");
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
      ownerUserId: "u1",
    }));
  });

  it("deletes the announcement parent and lets lifecycle triggers remove media links", async () => {
    const deps = createDeps();
    const { db, calls } = createCrudDb(BASE_ANNOUNCEMENT_ROW);
    const service = new AnnouncementService(db as never, deps);

    await service.permanentDelete("u1", "ann1");

    expect(deps.mediaService.replace).not.toHaveBeenCalled();
    expect(calls.deleteWhere).toHaveBeenCalledOnce();
  });

  it("uses pending-only quota for pre-announcement uploads", async () => {
    const deps = createDeps();
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);

    const result = await service.createPendingImages(
      "u1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
      10,
      5_000_000,
    );

    expect(result).toEqual({ ok: true, data: { expires_at: "2026-08-09T00:00:00.000Z", media_ids: [MEDIA_ID] } });
    expect(deps.mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: "pending" } }));
  });

  it("uses announcement scope and appends new media ids for an existing announcement", async () => {
    const deps = createDeps();
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);

    const result = await service.uploadImages(
      "u1",
      "ann1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
      10,
      5_000_000,
    );

    expect(result).toEqual({ ok: true, data: { media_ids: [MEDIA_ID] } });
    expect(deps.mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: "entity", entityType: "announcement", entityId: "ann1" },
    }));
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      media: [
        { mediaId: EXISTING_MEDIA_ID, sortOrder: 0 },
        { mediaId: MEDIA_ID, sortOrder: 1 },
      ],
    }));
  });

  it("restores existing links and deletes newly created assets when attachment fails", async () => {
    const failure = new Error("link write failed");
    const deps = createDeps();
    (deps.mediaService.replace as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const service = new AnnouncementService(createCrudDb(BASE_ANNOUNCEMENT_ROW).db as never, deps);

    await expect(service.uploadImages(
      "u1",
      "ann1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
      10,
      5_000_000,
    )).rejects.toBe(failure);

    expect(deps.mediaService.replace).toHaveBeenLastCalledWith(expect.objectContaining({
      media: [{ mediaId: EXISTING_MEDIA_ID, sortOrder: 0 }],
    }));
    expect(deps.mediaService.deleteAssets).toHaveBeenCalledWith([MEDIA_ID]);
  });
});
