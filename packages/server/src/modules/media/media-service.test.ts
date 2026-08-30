import {
  createAuthorizationContext,
  createRequestContext,
  type BlobMetadata,
  type BlobRead,
  type BlobStore,
} from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import { MediaRangeError, MediaService, type MediaReadFacts, type MediaStore } from "./media-service";

const NOW = "2026-08-09T12:00:00.000Z";
const metadata: BlobMetadata = {
  key: "media/media-1/view.webp",
  size: 10,
  contentType: "image/webp",
  sha256: "a".repeat(64),
  etag: "media-etag",
  lastModified: NOW,
};
const facts: MediaReadFacts = {
  objectKey: metadata.key,
  byteSize: metadata.size,
  contentType: "image/webp",
  sha256: metadata.sha256,
  ownerUserId: null,
  mediaType: "image",
  originalName: null,
  entityTypes: [],
  contentReadable: false,
  audience: "public",
};

describe("MediaService reads", () => {
  it("uses one descriptor and one BlobStore get for a ranged read", async () => {
    const head = vi.fn();
    const get = vi.fn().mockResolvedValue({
      metadata,
      body: stream("2345"),
      range: { offset: 2, length: 4, total: 10 },
    } satisfies BlobRead);
    const { service, describeRead } = mediaService({}, { head, get });

    await expect(service.read(anonymousContext(), "media-1", "view", {
      kind: "closed",
      offset: 2,
      length: 4,
    })).resolves.toMatchObject({
      audience: "public",
      object: { range: { offset: 2, length: 4, total: 10 } },
    });

    expect(describeRead).toHaveBeenCalledOnce();
    expect(describeRead).toHaveBeenCalledWith("media-1", "view", NOW, {
      announcement: { kind: "public" },
      wikiArticle: { kind: "public" },
    });
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(metadata.key, { offset: 2, length: 4 });
    expect(head).not.toHaveBeenCalled();
  });

  it("resolves open and suffix ranges from the database manifest before BlobStore access", async () => {
    const get = vi.fn(async (_key: string, range: { offset: number; length: number }) => ({
      metadata,
      body: stream("range"),
      range: { ...range, total: metadata.size },
    }));
    const { service } = mediaService({}, { get });

    await service.read(anonymousContext(), "media-1", "view", { kind: "open", offset: 7 });
    await service.read(anonymousContext(), "media-1", "view", { kind: "suffix", length: 4 });
    expect(get).toHaveBeenNthCalledWith(1, metadata.key, { offset: 7, length: 3 });
    expect(get).toHaveBeenNthCalledWith(2, metadata.key, { offset: 6, length: 4 });
  });

  it("rejects an unsatisfiable manifest range before touching BlobStore", async () => {
    const get = vi.fn();
    const { service, describeRead } = mediaService({}, { get });

    await expect(service.read(anonymousContext(), "media-1", "view", { kind: "open", offset: 10 }))
      .rejects.toMatchObject({ total: 10 } satisfies Partial<MediaRangeError>);
    expect(describeRead).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it.each(["key", "size", "contentType", "sha256"] as const)(
    "cancels the body and returns 503 when BlobStore %s disagrees with the manifest",
    async (field) => {
      const cancel = vi.fn();
      const mismatched: BlobMetadata = {
        ...metadata,
        ...(field === "key" ? { key: `${metadata.key}.wrong` } : {}),
        ...(field === "size" ? { size: metadata.size + 1 } : {}),
        ...(field === "contentType" ? { contentType: "application/octet-stream" } : {}),
        ...(field === "sha256" ? { sha256: "b".repeat(64) } : {}),
      };
      const get = vi.fn().mockResolvedValue({
        metadata: mismatched,
        body: new ReadableStream<Uint8Array>({ cancel }),
      } satisfies BlobRead);
      const { service, describeRead } = mediaService({}, { get });

      await expect(service.read(anonymousContext(), "media-1", "view"))
        .rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 503 });
      expect(describeRead).toHaveBeenCalledOnce();
      expect(get).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("validates metadata-only reads against the complete manifest", async () => {
    const head = vi.fn().mockResolvedValue({ ...metadata, contentType: "application/octet-stream" });
    const { service, describeRead } = mediaService({}, { head });

    await expect(service.head(anonymousContext(), "media-1", "view"))
      .rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 503 });
    expect(describeRead).toHaveBeenCalledOnce();
    expect(head).toHaveBeenCalledOnce();
  });

  it("preserves the manifest audience for HTTP cache policy", async () => {
    const head = vi.fn().mockResolvedValue(metadata);
    const { service } = mediaService({ audience: "authenticated" }, { head });

    await expect(service.head(anonymousContext(), "media-1", "view"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const authenticated = mediaService({ audience: "authenticated" }, { head });
    await expect(authenticated.service.head(authenticatedContext(), "media-1", "view"))
      .resolves.toEqual({ metadata, audience: "authenticated", entityTypes: [] });
  });

  it("rejects private media before touching BlobStore", async () => {
    const head = vi.fn();
    const get = vi.fn();
    const { service } = mediaService({ audience: "private", ownerUserId: "owner-1" }, { head, get });

    await expect(service.head(anonymousContext(), "media-1", "view"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(head).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("uses parent content scope instead of create permission or upload ownership for private content", async () => {
    const head = vi.fn().mockResolvedValue(metadata);
    const otherAuthor = mediaService({
      audience: "private",
      ownerUserId: "author-b",
      entityTypes: ["announcement"],
      contentReadable: false,
    }, { head });
    await expect(otherAuthor.service.head(
      authenticatedContext("author-a", ["announcements.create"]),
      "media-1",
      "view",
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(otherAuthor.describeRead).toHaveBeenCalledWith("media-1", "view", NOW, {
      announcement: { kind: "owned", ownerUserId: "author-a" },
      wikiArticle: { kind: "public" },
    });

    const ownContent = mediaService({
      audience: "private",
      ownerUserId: "author-b",
      entityTypes: ["announcement"],
      contentReadable: true,
    }, { head });
    await expect(ownContent.service.head(
      authenticatedContext("author-a", ["announcements.create"]),
      "media-1",
      "view",
    )).resolves.toEqual({ metadata, audience: "private", entityTypes: ["announcement"] });

    const revokedCreator = mediaService({
      audience: "private",
      ownerUserId: "author-a",
      entityTypes: ["announcement"],
      contentReadable: false,
    }, { head });
    await expect(revokedCreator.service.head(authenticatedContext("author-a"), "media-1", "view"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    const manager = mediaService({
      audience: "private",
      ownerUserId: "author-b",
      entityTypes: ["announcement"],
      contentReadable: true,
    }, { head });
    await expect(manager.service.head(
      authenticatedContext("manager", ["announcements.edit"]),
      "media-1",
      "view",
    )).resolves.toEqual({ metadata, audience: "private", entityTypes: ["announcement"] });
  });
});

describe("MediaService uploads", () => {
  it("stages any announcement attachment as an opaque full file variant", async () => {
    const reserveUploads = vi.fn().mockResolvedValue(undefined);
    const markStaged = vi.fn().mockResolvedValue(undefined);
    const putIfAbsent = vi.fn(async (key: string, input: Parameters<BlobStore["putIfAbsent"]>[1]) => ({
      key,
      size: input.size,
      contentType: input.contentType,
      sha256: input.sha256,
      etag: input.sha256,
      lastModified: NOW,
    }));
    const service = new MediaService(
      { reserveUploads, markStaged } as unknown as MediaStore,
      { putIfAbsent } as unknown as BlobStore,
    );
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff]);

    const attachment = await service.uploadAnnouncementAttachment(authenticatedContext(), {
      bytes,
      originalName: "Guild strategy.pack",
      contentType: "application/x-guild-pack",
    }, 1_024);

    expect(attachment).toMatchObject({
      name: "Guild strategy.pack",
      content_type: "application/octet-stream",
      byte_size: bytes.byteLength,
    });
    const reservation = reserveUploads.mock.calls[0]?.[0][0];
    expect(reservation).toMatchObject({
      purpose: "announcement_attachment",
      mediaType: "file",
      originalName: "Guild strategy.pack",
    });
    expect(reservation.variants).toEqual([expect.objectContaining({
      variant: "full",
      contentType: "application/octet-stream",
      width: null,
      height: null,
    })]);
    expect(putIfAbsent).toHaveBeenCalledWith(
      expect.stringMatching(/\/full\.bin$/),
      expect.objectContaining({ contentType: "application/octet-stream" }),
    );
  });

  it("reserves and stages one batch while writing immutable objects sequentially", async () => {
    const reserveUploads = vi.fn().mockResolvedValue(undefined);
    const markStaged = vi.fn().mockResolvedValue(undefined);
    const markDeleting = vi.fn().mockResolvedValue(undefined);
    let active = 0;
    let maxActive = 0;
    const putIfAbsent = vi.fn(async (key: string, input: Parameters<BlobStore["putIfAbsent"]>[1]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        key,
        size: input.size,
        contentType: input.contentType,
        sha256: input.sha256,
        etag: input.sha256,
        lastModified: NOW,
      };
    });
    const service = new MediaService(
      { reserveUploads, markStaged, markDeleting } as unknown as MediaStore,
      { putIfAbsent } as unknown as BlobStore,
    );
    const image = minimalWebP();

    const ids = await service.uploadImages(
      authenticatedContext(),
      "gallery_image",
      Array.from({ length: 3 }, () => ({ full: image, view: image })),
      1_024,
    );

    expect(ids).toHaveLength(3);
    expect(reserveUploads).toHaveBeenCalledOnce();
    expect(reserveUploads.mock.calls[0]).toHaveLength(2);
    expect(reserveUploads.mock.calls[0]?.[0]).toHaveLength(3);
    expect(reserveUploads.mock.calls[0]?.[1]).toBe("request-media-upload");
    expect(putIfAbsent).toHaveBeenCalledTimes(6);
    expect(maxActive).toBe(1);
    expect(markStaged).toHaveBeenCalledOnce();
    expect(markStaged).toHaveBeenCalledWith(ids, NOW);
    expect(markDeleting).not.toHaveBeenCalled();
  });

  it("moves the complete reservation batch to deleting after any object write fails", async () => {
    const reserveUploads = vi.fn().mockResolvedValue(undefined);
    const markStaged = vi.fn().mockResolvedValue(undefined);
    const markDeleting = vi.fn().mockResolvedValue(undefined);
    const putIfAbsent = vi.fn().mockRejectedValueOnce(new Error("injected write failure"));
    const service = new MediaService(
      { reserveUploads, markStaged, markDeleting } as unknown as MediaStore,
      { putIfAbsent } as unknown as BlobStore,
    );
    const image = minimalWebP();

    await expect(service.uploadImages(
      authenticatedContext(),
      "gallery_image",
      Array.from({ length: 2 }, () => ({ full: image, view: image })),
      1_024,
    )).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 503 });

    const reservations = reserveUploads.mock.calls[0]?.[0] as readonly { id: string }[];
    expect(markStaged).not.toHaveBeenCalled();
    expect(markDeleting).toHaveBeenCalledOnce();
    expect(markDeleting).toHaveBeenCalledWith(reservations.map(({ id }) => id), NOW);
  });

  it("preserves both the upload and cleanup errors when marking reservations for deletion fails", async () => {
    const uploadError = new Error("injected write failure");
    const cleanupError = new Error("injected cleanup failure");
    const reserveUploads = vi.fn().mockResolvedValue(undefined);
    const markStaged = vi.fn().mockResolvedValue(undefined);
    const markDeleting = vi.fn().mockRejectedValue(cleanupError);
    const putIfAbsent = vi.fn().mockRejectedValue(uploadError);
    const service = new MediaService(
      { reserveUploads, markStaged, markDeleting } as unknown as MediaStore,
      { putIfAbsent } as unknown as BlobStore,
    );

    let thrown: unknown;
    try {
      await service.uploadImages(
        authenticatedContext(),
        "gallery_image",
        [{ full: minimalWebP(), view: minimalWebP() }],
        1_024,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "UPSTREAM_ERROR", status: 503 });
    const cause = (thrown as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors).toEqual([uploadError, cleanupError]);
  });
});

describe("MediaService garbage collection", () => {
  it("finishes the claimed batch and rejects when any deletion fails", async () => {
    const claims = [
      { mediaId: "media-1", claimToken: "claim-1", objectKeys: ["media/1"] },
      { mediaId: "media-2", claimToken: "claim-2", objectKeys: ["media/2"] },
      { mediaId: "media-3", claimToken: "claim-3", objectKeys: ["media/3"] },
    ];
    const claimGarbage = vi.fn().mockResolvedValue(claims);
    const finalizeDeletion = vi.fn().mockResolvedValue(undefined);
    const deleteObjects = vi.fn(async (keys: readonly string[]) => {
      if (keys.includes("media/2")) throw new Error("injected object deletion failure");
    });
    const service = new MediaService(
      { claimGarbage, finalizeDeletion } as unknown as MediaStore,
      { delete: deleteObjects } as unknown as BlobStore,
    );

    await expect(service.collectGarbage(anonymousContext(), NOW, () => ({} as never)))
      .rejects.toMatchObject({
        name: "AggregateError",
        message: "Media garbage collection deleted 2 item(s) and failed 1: media-2",
      });

    expect(claimGarbage).toHaveBeenCalledWith(NOW, 10);
    expect(deleteObjects).toHaveBeenCalledTimes(3);
    expect(finalizeDeletion).toHaveBeenCalledTimes(2);
    expect(finalizeDeletion.mock.calls.map(([mediaId]) => mediaId)).toEqual(["media-1", "media-3"]);
  });
});

function mediaService(
  overrides: Partial<MediaReadFacts>,
  blobs: Partial<BlobStore>,
): Readonly<{ service: MediaService; describeRead: ReturnType<typeof vi.fn> }> {
  const describeRead = vi.fn().mockResolvedValue({ ...facts, ...overrides });
  const store = { describeRead } as unknown as MediaStore;
  return { service: new MediaService(store, blobs as BlobStore), describeRead };
}

function anonymousContext() {
  return createRequestContext({
    requestId: "request-media",
    authorization: createAuthorizationContext(null),
    now: NOW,
  });
}

function authenticatedContext(userId = "owner-1", permissions: readonly string[] = []) {
  return createRequestContext({
    requestId: "request-media-upload",
    authorization: createAuthorizationContext({
      userId,
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 1,
      permissions,
    }),
    now: NOW,
  });
}

function stream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function minimalWebP(): Uint8Array {
  return Uint8Array.from(
    atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="),
    (value) => value.charCodeAt(0),
  );
}
