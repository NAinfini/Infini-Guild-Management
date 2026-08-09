import { describe, expect, it, vi } from "vitest";
import { GalleryService } from "../GalleryService";
import type { MediaService } from "../MediaService";

const MEDIA_ID = "Abcdefghijklmnopqrstu";

function createMediaService(linked = true) {
  return {
    checkQuota: vi.fn().mockResolvedValue(true),
    createImages: vi.fn().mockResolvedValue({
      expiresAt: "2026-05-08T00:00:00.000Z",
      mediaIds: [MEDIA_ID],
    }),
    listLinkedMedia: vi.fn().mockImplementation(async (_entityType: string, entityIds: string[]) => new Map(
      linked
        ? entityIds.map((entityId) => [entityId, [{ mediaId: MEDIA_ID, slot: "image", sortOrder: 0 }]])
        : [],
    )),
    replace: vi.fn().mockResolvedValue(undefined),
  };
}

function createDeps(linked = true) {
  return {
    mediaService: createMediaService(linked) as ReturnType<typeof createMediaService> & MediaService,
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

function createDeleteDb(item: { id: string; type: "image" | "video"; url: string | null; caption: string | null; uploadedBy: string } | null, deleteError?: Error) {
  const limit = vi.fn().mockResolvedValue(item ? [{ ...item, uploadedByName: null, createdAt: "2026-05-07T00:00:00.000Z" }] : []);
  const select = vi.fn(() => ({
    from: () => ({ leftJoin: () => ({ where: () => ({ limit }) }) }),
  }));
  const whereDelete = deleteError
    ? vi.fn().mockRejectedValue(deleteError)
    : vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn(() => ({ where: whereDelete }));
  return { db: { select, delete: deleteFrom }, calls: { deleteFrom, whereDelete } };
}

describe("GalleryService unified media lifecycle", () => {
  it("cleans the attempted parent rows without attaching media when the gallery batch fails", async () => {
    const failure = new Error("gallery insert failed");
    const deps = createDeps(false);
    (deps.rawDb.batch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const service = new GalleryService({ delete: () => ({ where: deleteWhere }) } as never, deps);

    await expect(service.uploadImages(
      "actor-1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
      [null],
      10,
      5_000_000,
    )).rejects.toBe(failure);

    expect(deps.mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "gallery_image",
      ownerUserId: "actor-1",
      scope: { kind: "owner" },
      incomingCount: 1,
    }));
    expect(deps.mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "gallery_image",
      maxBytes: 5_000_000,
    }));
    expect(deps.mediaService.replace).not.toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("creates every gallery parent before attaching and cleans the whole batch on attachment failure", async () => {
    const failure = new Error("second attachment failed");
    const deps = createDeps(false);
    (deps.mediaService.createImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      expiresAt: "2026-05-08T00:00:00.000Z",
      mediaIds: [MEDIA_ID, "Vbcdefghijklmnopqrstu"],
    });
    (deps.mediaService.replace as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const service = new GalleryService({ delete: () => ({ where: deleteWhere }) } as never, deps);

    await expect(service.uploadImages(
      "actor-1",
      [
        { full: new ArrayBuffer(1), view: new ArrayBuffer(1) },
        { full: new ArrayBuffer(1), view: new ArrayBuffer(1) },
      ],
      [null, "second"],
      10,
      5_000_000,
    )).rejects.toBe(failure);

    expect((deps.rawDb.batch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      (deps.mediaService.replace as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
    expect(deps.mediaService.replace).toHaveBeenCalledTimes(2);
    expect(deleteWhere).toHaveBeenCalledOnce();
  });

  it("deletes an image parent and lets lifecycle triggers remove its media link", async () => {
    const { db, calls } = createDeleteDb({ id: "item-1", type: "image", url: null, caption: null, uploadedBy: "u-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    const result = await service.deleteItem("u-1", false, "item-1");

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(deps.mediaService.replace).not.toHaveBeenCalled();
    expect(calls.whereDelete).toHaveBeenCalledOnce();
  });

  it("surfaces a gallery parent deletion failure without mutating media links", async () => {
    const failure = new Error("D1 unavailable");
    const { db } = createDeleteDb({ id: "item-1", type: "image", url: null, caption: null, uploadedBy: "u-1" }, failure);
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    await expect(service.deleteItem("u-1", false, "item-1")).rejects.toBe(failure);

    expect(deps.mediaService.replace).not.toHaveBeenCalled();
  });

  it("rejects deleting another member's gallery item without gallery.delete", async () => {
    const { db, calls } = createDeleteDb({ id: "item-1", type: "image", url: null, caption: null, uploadedBy: "owner-1" });
    const deps = createDeps();
    const service = new GalleryService(db as never, deps);

    const result = await service.deleteItem("u-1", false, "item-1");

    expect(result).toEqual({ ok: false, code: "FORBIDDEN", message: "Cannot delete this gallery item" });
    expect(calls.deleteFrom).not.toHaveBeenCalled();
    expect(deps.mediaService.replace).not.toHaveBeenCalled();
  });
});
