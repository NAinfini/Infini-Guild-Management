import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { GalleryService, type GalleryRecord, type GalleryStore } from "./gallery-service";
import type { MediaService } from "../media/public.js";

function context(userId: string, permissions: readonly string[] = []) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId,
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions,
    }),
    now: "2026-08-09T00:00:00.000Z",
  });
}

function store(overrides: Partial<GalleryStore> = {}): GalleryStore {
  return {
    list: vi.fn(),
    get: vi.fn(),
    createImages: vi.fn(),
    createVideo: vi.fn(),
    delete: vi.fn(),
    batchDelete: vi.fn(),
    ...overrides,
  };
}

function service(value: GalleryStore, media: Partial<MediaService> = {}) {
  return new GalleryService(
    value,
    media as MediaService,
    { publish: vi.fn() },
    { defer: vi.fn() },
  );
}

const image: GalleryRecord = {
  id: "gallery-1",
  type: "image",
  media_id: "123456789012345678901",
  url: null,
  caption: "Launch",
  uploaded_by: "owner-1",
  uploaded_by_name: "Owner",
  created_at: "2026-08-08T00:00:00.000Z",
  revisionToken: "revision-old-123456",
};

describe("GalleryService", () => {
  it("rejects unsupported video hosts before writing", async () => {
    const createVideo = vi.fn();
    await expect(service(store({ createVideo })).createVideo(
      context("owner-1", ["gallery.upload"]),
      { url: "https://tracker.invalid/watch/1" },
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createVideo).not.toHaveBeenCalled();
  });

  it("lets the owner delete without the global delete permission and uses revision CAS", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const gallery = store({ get: vi.fn().mockResolvedValue(image), delete: remove });

    await expect(service(gallery).delete(context("owner-1"), image.id)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0]![0]).toMatchObject({
      id: image.id,
      expectedRevisionToken: image.revisionToken,
      audit: { actorUserId: "owner-1", requestId: "request-1" },
    });
  });

  it("denies deleting another owner's item without permission", async () => {
    const remove = vi.fn();
    const gallery = store({ get: vi.fn().mockResolvedValue(image), delete: remove });

    await expect(service(gallery).delete(context("member-2"), image.id))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("creates an aligned image batch through one store mutation", async () => {
    const createImages = vi.fn();
    const gallery = store({ createImages });
    const uploadImages = vi.fn().mockResolvedValue([
      "123456789012345678901",
      "123456789012345678902",
    ]);

    const result = await service(gallery, { uploadImages }).uploadImages(
      context("owner-1", ["gallery.upload"]),
      [{ full: new Uint8Array([1]), view: new Uint8Array([2]) }, { full: new Uint8Array([3]), view: new Uint8Array([4]) }],
      [" First ", null],
      10_000,
      10,
    );

    expect(result.data).toHaveLength(2);
    expect(createImages).toHaveBeenCalledOnce();
    expect(createImages.mock.calls[0]![0]).toMatchObject({
      mediaIds: ["123456789012345678901", "123456789012345678902"],
      ownerUserId: "owner-1",
      maxItems: 10,
      audit: { actorUserId: "owner-1", requestId: "request-1" },
    });
    expect(uploadImages.mock.invocationCallOrder[0]).toBeLessThan(createImages.mock.invocationCallOrder[0]!);
  });

  it("leaves uploaded media with the store when an atomic quota claim loses", async () => {
    const failure = Object.assign(new Error("Gallery image quota is 1"), { code: "VALIDATION_ERROR", status: 400 });
    const createImages = vi.fn().mockRejectedValue(failure);
    const uploadImages = vi.fn().mockResolvedValue(["123456789012345678901"]);

    await expect(service(store({ createImages }), { uploadImages }).uploadImages(
      context("owner-1", ["gallery.upload"]),
      [{ full: new Uint8Array([1]), view: new Uint8Array([2]) }],
      [null],
      10_000,
      1,
    )).rejects.toBe(failure);

    expect(uploadImages).toHaveBeenCalledOnce();
    expect(createImages).toHaveBeenCalledOnce();
  });

  it("binds cursors to their sort direction", async () => {
    const ascCursor = btoa(JSON.stringify({
      createdAt: "2026-08-08T00:00:00.000Z",
      id: "gallery-1",
      order: "asc",
    })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const list = vi.fn();

    await expect(service(store({ list })).list(context("owner-1"), {
      cursor: ascCursor,
      limit: 20,
      order: "desc",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(list).not.toHaveBeenCalled();
  });
});
