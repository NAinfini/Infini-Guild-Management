import { describe, expect, it, vi } from "vitest";
import { GalleryService } from "../GalleryService";

function createDeps() {
  return {
    media: { delete: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    rawDb: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings, run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) })),
      })),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database,
  };
}

function createDeleteDb(item: { id: string; type: "image" | "video"; url: string; caption: string | null; uploadedBy: string } | null) {
  const limit = vi.fn().mockResolvedValue(item ? [{ ...item, uploadedByName: null, createdAt: "2026-05-07T00:00:00.000Z" }] : []);
  const whereSelect = vi.fn(() => ({ limit }));
  const leftJoin = vi.fn(() => ({ where: whereSelect }));
  const from = vi.fn(() => ({ leftJoin }));
  const select = vi.fn(() => ({ from }));
  const whereDelete = vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn(() => ({ where: whereDelete }));

  return {
    db: { select, delete: deleteFrom },
    calls: { deleteFrom, whereDelete },
  };
}

describe("GalleryService", () => {
  it("writes media references after uploading images", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
    };
    const deps = createDeps();
    const media = { put: vi.fn().mockResolvedValue({ key: "gallery/images/actor-1/ts_item-1" }) };
    const service = new GalleryService(db as never, { ...deps, media: media as unknown as R2Bucket });

    await service.uploadImages(
      "actor-1",
      [{ data: new ArrayBuffer(1), contentType: "image/png", name: "img.png" }],
      [null],
    );

    // replaceMediaRefs calls rawDb.batch once per uploaded image (delete + insert)
    expect(deps.rawDb.batch).toHaveBeenCalled();
    const batchCall = (deps.rawDb.batch as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => (call[0] as unknown[]).length >= 2,
    );
    expect(batchCall).toBeDefined();
  });

  it("removes media references after deleting an image item", async () => {
    const { db } = createDeleteDb({ id: "item-1", type: "image", url: "gallery/images/item-1", caption: null, uploadedBy: "u-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    await service.deleteItem("u-1", false, "item-1");

    // deleteMediaRefs calls rawDb.prepare + .bind + .run
    expect(deps.rawDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM media_references"),
    );
  });

  it("allows members to delete their own gallery items without gallery.delete", async () => {
    const { db } = createDeleteDb({ id: "item-1", type: "image", url: "gallery/images/item-1", caption: null, uploadedBy: "u-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    const result = await service.deleteItem("u-1", false, "item-1");

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(deps.rawDb.batch).toHaveBeenCalledTimes(1);
    expect(deps.media.delete).toHaveBeenCalledWith("gallery/images/item-1");
  });

  it("rejects deleting someone else's gallery item without gallery.delete", async () => {
    const { db, calls } = createDeleteDb({ id: "item-1", type: "image", url: "gallery/images/item-1", caption: null, uploadedBy: "owner-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    const result = await service.deleteItem("u-1", false, "item-1");

    expect(result).toEqual({ ok: false, code: "FORBIDDEN", message: "Cannot delete this gallery item" });
    expect(calls.deleteFrom).not.toHaveBeenCalled();
    expect(deps.media.delete).not.toHaveBeenCalled();
  });

  it("allows gallery.delete holders to delete any gallery item", async () => {
    const { db } = createDeleteDb({ id: "item-1", type: "video", url: "https://example.com/video", caption: null, uploadedBy: "owner-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    const result = await service.deleteItem("u-1", true, "item-1");

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(deps.rawDb.batch).toHaveBeenCalledTimes(1);
  });

  it("deletes only gallery item rows after gallery social tables are removed", async () => {
    const { db } = createDeleteDb({ id: "item-1", type: "image", url: "gallery/images/item-1", caption: null, uploadedBy: "u-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    await service.deleteItem("u-1", false, "item-1");

    expect(deps.rawDb.prepare).not.toHaveBeenCalledWith("DELETE FROM gallery_comments WHERE gallery_item_id = ?1");
    expect(deps.rawDb.prepare).not.toHaveBeenCalledWith("DELETE FROM gallery_likes WHERE gallery_item_id = ?1");
    expect(deps.rawDb.prepare).toHaveBeenCalledWith("DELETE FROM gallery_items WHERE id = ?1");
    expect(deps.rawDb.batch).toHaveBeenCalledTimes(1);
  });
});
