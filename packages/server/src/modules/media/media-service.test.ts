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
  entityTypes: [],
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
    })).resolves.toMatchObject({ range: { offset: 2, length: 4, total: 10 } });

    expect(describeRead).toHaveBeenCalledOnce();
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

  it("rejects private media before touching BlobStore", async () => {
    const head = vi.fn();
    const get = vi.fn();
    const { service } = mediaService({ audience: "private", ownerUserId: "owner-1" }, { head, get });

    await expect(service.head(anonymousContext(), "media-1", "view"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(head).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("MediaService uploads", () => {
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
    expect(reserveUploads.mock.calls[0]?.[0]).toHaveLength(3);
    expect(reserveUploads.mock.calls[0]?.[1]).toHaveLength(3);
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

function authenticatedContext() {
  return createRequestContext({
    requestId: "request-media-upload",
    authorization: createAuthorizationContext({
      userId: "owner-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 1,
      permissions: new Set(),
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
  const bytes = new Uint8Array(26);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8L"), 8);
  new DataView(bytes.buffer).setUint32(16, 5, true);
  bytes[20] = 0x2f;
  return bytes;
}
