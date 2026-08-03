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
  it("writes gallery rows and media references in one D1 batch", async () => {
    const db = {};
    const deps = createDeps();
    const media = { put: vi.fn().mockResolvedValue({}) };
    const service = new GalleryService(db as never, { ...deps, media: media as unknown as R2Bucket });

    await service.uploadImages(
      "actor-1",
      [{ data: new ArrayBuffer(1), contentType: "image/png", name: "img.png" }],
      [null],
    );

    expect(deps.rawDb.batch).toHaveBeenCalledTimes(1);
    expect((deps.rawDb.batch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(3);
    expect(media.put).toHaveBeenCalledWith(
      expect.stringMatching(/^gallery\/users\/actor-1\/items\/[^/]+\/images\/[A-Za-z0-9_-]+\.png$/),
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: "image/png" } },
    );
  });

  it("removes the R2 object when the atomic gallery row/reference batch fails", async () => {
    const failure = new Error("gallery insert failed");
    const db = {};
    const deps = createDeps();
    (deps.rawDb.batch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
    const media = {
      put: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new GalleryService(db as never, { ...deps, media: media as unknown as R2Bucket });

    await expect(service.uploadImages(
      "actor-1",
      [{ data: new ArrayBuffer(1), contentType: "image/png", name: "img.png" }],
      [null],
    )).rejects.toBe(failure);

    expect(media.delete).toHaveBeenCalledTimes(1);
    expect(deps.rawDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM media_references"),
    );
  });

  it("removes media references after deleting an image item", async () => {
    const { db } = createDeleteDb({ id: "item-1", type: "image", url: "gallery/users/u-1/items/item-1/images/image.webp", caption: null, uploadedBy: "u-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    await service.deleteItem("u-1", false, "item-1");

    expect(deps.rawDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM media_references"),
    );
    expect((deps.rawDb.batch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("allows members to delete their own gallery items without gallery.delete", async () => {
    const { db } = createDeleteDb({ id: "item-1", type: "image", url: "gallery/users/u-1/items/item-1/images/image.webp", caption: null, uploadedBy: "u-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    const result = await service.deleteItem("u-1", false, "item-1");

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(deps.rawDb.prepare).toHaveBeenCalledWith("DELETE FROM gallery_items WHERE id = ?1");
    expect(deps.rawDb.batch).toHaveBeenCalledTimes(1);
    expect(deps.media.delete).toHaveBeenCalledWith("gallery/users/u-1/items/item-1/images/image.webp");
    expect((deps.rawDb.batch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      (deps.media.delete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it("rejects deleting someone else's gallery item without gallery.delete", async () => {
    const { db, calls } = createDeleteDb({ id: "item-1", type: "image", url: "gallery/users/owner-1/items/item-1/images/image.webp", caption: null, uploadedBy: "owner-1" });
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
});
