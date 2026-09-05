import { describe, expect, it, vi } from "vitest";
import {
  createAuthorizationContext,
  createRequestContext,
  type DeferredTask,
  type DeferredTasks,
  type NotificationPublisher,
} from "@guild/kernel";
import { galleryItemEtag } from "@guild/shared";
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
    updateMetadata: vi.fn(),
    delete: vi.fn(),
    batchDelete: vi.fn(),
    setLike: vi.fn(),
    ...overrides,
  };
}

function service(
  value: GalleryStore,
  media: Partial<MediaService> = {},
  notifications: NotificationPublisher = { publish: vi.fn() },
  deferred: DeferredTasks = { defer: vi.fn() },
) {
  return new GalleryService(
    value,
    media as MediaService,
    notifications,
    deferred,
  );
}

const image: GalleryRecord = {
  id: "gallery-1",
  type: "image",
  media_id: "123456789012345678901",
  url: null,
  title: "Launch",
  description: null,
  uploaded_by: "owner-1",
  uploaded_by_name: "Owner",
  like_count: 0,
  liked_by_viewer: false,
  created_at: "2026-08-08T00:00:00.000Z",
  revisionToken: "revision-old-123456",
};

describe("GalleryService", () => {
  it("rejects unsupported video hosts before writing", async () => {
    const createVideo = vi.fn();
    await expect(service(store({ createVideo })).createVideo(
      context("owner-1", ["gallery.upload"]),
      { url: "https://tracker.invalid/watch/1", title: "Tracker" },
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createVideo).not.toHaveBeenCalled();
  });

  it("includes the opaque item revision needed for a later delete precondition", async () => {
    const list = vi.fn().mockResolvedValue({ data: [image], hasMore: false });

    const result = await service(store({ list })).list(context("owner-1"), {
      limit: 20,
      order: "desc",
    });

    expect(result.data[0]).toEqual(expect.objectContaining({
      id: image.id,
      revision_token: image.revisionToken,
    }));
  });

  it("lets the owner delete without the global delete permission and uses revision CAS", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const gallery = store({ get: vi.fn().mockResolvedValue(image), delete: remove });

    await expect(service(gallery).delete(
      context("owner-1"),
      image.id,
      galleryItemEtag({ id: image.id, revision_token: image.revisionToken }),
    )).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0]![0]).toMatchObject({
      id: image.id,
      expectedRevisionToken: image.revisionToken,
      audit: {
        actorKind: "user",
        actorId: "owner-1",
        requestId: "request-1",
        subjectType: "gallery_item",
        subjectId: image.id,
        subjectLabel: image.title,
        action: "delete",
        payload: {
          schema_version: 2,
          changes: [],
          context: [{ field: "type", value: { type: "code", value: "image" } }],
        },
      },
    });
  });

  it("lets the owner update gallery metadata with normalization, audit, and revision CAS", async () => {
    const updateMetadata = vi.fn().mockResolvedValue(true);
    const value = service(store({
      get: vi.fn().mockResolvedValue(image),
      updateMetadata,
    }));

    const result = await value.update(
      context("owner-1"),
      image.id,
      { title: "  Guild launch  ", description: "  At the keep.  " },
      galleryItemEtag({ id: image.id, revision_token: image.revisionToken }),
    );

    expect(result).toEqual(expect.objectContaining({
      id: image.id,
      title: "Guild launch",
      description: "At the keep.",
      revision_token: expect.any(String),
    }));
    const mutation = updateMetadata.mock.calls[0]![0];
    expect(mutation).toMatchObject({
      id: image.id,
      expectedRevisionToken: image.revisionToken,
      title: "Guild launch",
      description: "At the keep.",
      audit: {
        actorKind: "user",
        actorId: "owner-1",
        requestId: "request-1",
        subjectType: "gallery_item",
        subjectId: image.id,
        subjectLabel: "Guild launch",
        action: "update",
        payload: {
          schema_version: 2,
          changes: [
            {
              field: "title",
              before: { type: "text", value: "Launch" },
              after: { type: "text", value: "Guild launch" },
            },
            {
              field: "description",
              before: { type: "null", value: null },
              after: { type: "text", value: "At the keep." },
            },
          ],
          context: [],
        },
      },
    });
    expect(mutation.newRevisionToken).toBe(result.revision_token);
  });

  it("requires gallery.manage to update another member's gallery metadata", async () => {
    const updateMetadata = vi.fn().mockResolvedValue(true);
    const gallery = store({ get: vi.fn().mockResolvedValue(image), updateMetadata });
    const etag = galleryItemEtag({ id: image.id, revision_token: image.revisionToken });

    await expect(service(gallery).update(
      context("member-2"),
      image.id,
      { title: "Renamed", description: null },
      etag,
    )).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(updateMetadata).not.toHaveBeenCalled();

    await expect(service(gallery).update(
      context("moderator-1", ["gallery.manage"]),
      image.id,
      { title: "Renamed", description: null },
      etag,
    )).resolves.toEqual(expect.objectContaining({ title: "Renamed" }));
    expect(updateMetadata).toHaveBeenCalledOnce();
  });

  it("rejects a stale gallery metadata update before writing", async () => {
    const updateMetadata = vi.fn();
    const gallery = store({ get: vi.fn().mockResolvedValue(image), updateMetadata });

    await expect(service(gallery).update(
      context("owner-1"),
      image.id,
      { title: "Renamed", description: null },
      '"gallery-gallery-1-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it("rejects a stale delete precondition before attempting the store mutation", async () => {
    const remove = vi.fn();
    const gallery = store({ get: vi.fn().mockResolvedValue(image), delete: remove });

    await expect(service(gallery).delete(
      context("owner-1"),
      image.id,
      '"gallery-gallery-1-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(remove).not.toHaveBeenCalled();
  });

  it("denies deleting another owner's item before evaluating its precondition", async () => {
    const remove = vi.fn();
    const gallery = store({ get: vi.fn().mockResolvedValue(image), delete: remove });

    await expect(service(gallery).delete(
      context("member-2"),
      image.id,
      '"gallery-gallery-1-stale"',
    ))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("creates an aligned image batch through one store mutation", async () => {
    const createImages = vi.fn<GalleryStore["createImages"]>();
    const gallery = store({ createImages });
    const uploadImages = vi.fn().mockResolvedValue([
      "123456789012345678901",
      "123456789012345678902",
    ]);

    const result = await service(gallery, { uploadImages }).uploadImages(
      context("owner-1", ["gallery.upload"]),
      [{ full: new Uint8Array([1]), view: new Uint8Array([2]) }, { full: new Uint8Array([3]), view: new Uint8Array([4]) }],
      [{ title: " First ", description: null }, { title: "Second", description: null }],
      10_000,
      10,
    );

    expect(result.data).toHaveLength(2);
    expect(createImages).toHaveBeenCalledOnce();
    const mutation = createImages.mock.calls[0]![0];
    expect(mutation).toMatchObject({
      mediaIds: ["123456789012345678901", "123456789012345678902"],
      ownerUserId: "owner-1",
      maxItems: 10,
    });
    expect(mutation.audit).toMatchObject({
      actorKind: "user",
      actorId: "owner-1",
      requestId: "request-1",
      subjectType: "gallery_item",
      subjectId: mutation.records.map(({ id }) => id).join(","),
      subjectLabel: "image",
      action: "upload_images",
      payload: {
        schema_version: 2,
        changes: [],
        context: [
          { field: "item_count", value: { type: "number", value: 2 } },
          {
            field: "item_ids",
            value: {
              type: "list",
              value: mutation.records.map(({ id, title }) => ({
                type: "reference",
                value: { id, label: title },
              })),
            },
          },
        ],
      },
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
      [{ title: "Quota test", description: null }],
      10_000,
      1,
    )).rejects.toBe(failure);

    expect(uploadImages).toHaveBeenCalledOnce();
    expect(createImages).toHaveBeenCalledOnce();
  });

  it("allows a viewer to like and unlike a gallery item", async () => {
    const setLike = vi.fn()
      .mockResolvedValueOnce({ outcome: "ok" as const, changed: true, likeCount: 1 })
      .mockResolvedValueOnce({ outcome: "ok" as const, changed: true, likeCount: 0 });
    const gallery = store({ get: vi.fn().mockResolvedValue(image), setLike });

    await expect(service(gallery).like(context("owner-1"), image.id))
      .resolves.toEqual({ liked: true, like_count: 1 });
    await expect(service(gallery).unlike(context("owner-1"), image.id))
      .resolves.toEqual({ liked: false, like_count: 0 });
    expect(setLike).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: image.id,
      userId: "owner-1",
      liked: true,
      audit: expect.objectContaining({
        action: "update",
        payload: expect.objectContaining({
          changes: [{
            field: "liked",
            before: { type: "boolean", value: false },
            after: { type: "boolean", value: true },
          }],
        }),
      }),
    }));
    expect(setLike).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: image.id,
      userId: "owner-1",
      liked: false,
    }));
  });

  it("returns not found when a gallery item is deleted after the initial read", async () => {
    const setLike = vi.fn().mockResolvedValue({ outcome: "not_found" as const });
    const gallery = store({ get: vi.fn().mockResolvedValue(image), setLike });

    await expect(service(gallery).like(context("owner-1"), image.id))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(setLike).toHaveBeenCalledOnce();
  });

  it("publishes member-visible gallery changes after likes are committed", async () => {
    const tasks: DeferredTask[] = [];
    const outbound = vi.fn().mockResolvedValue(undefined);
    const notifications: NotificationPublisher = { publish: outbound };
    const gallery = store({
      get: vi.fn().mockResolvedValue(image),
      setLike: vi.fn()
        .mockResolvedValueOnce({ outcome: "ok" as const, changed: true, likeCount: 1 })
        .mockResolvedValueOnce({ outcome: "ok" as const, changed: true, likeCount: 0 }),
    });
    const value = service(
      gallery,
      {},
      notifications,
      { defer: (task) => { tasks.push(task); } },
    );

    await expect(value.like(context("owner-1"), image.id)).resolves.toEqual({ liked: true, like_count: 1 });
    await expect(value.unlike(context("owner-1"), image.id)).resolves.toEqual({ liked: false, like_count: 0 });

    await expect(Promise.all(tasks.map((task) => task()))).resolves.toEqual([undefined, undefined]);
    const liked = {
      type: "entity_changed",
      entity_type: "gallery",
      entity_id: image.id,
      updated_at: "2026-08-09T00:00:00.000Z",
      hint: "item_liked",
    } as const;
    const unliked = { ...liked, hint: "item_unliked" } as const;
    expect(outbound).toHaveBeenNthCalledWith(1, liked);
    expect(outbound).toHaveBeenNthCalledWith(2, unliked);
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
