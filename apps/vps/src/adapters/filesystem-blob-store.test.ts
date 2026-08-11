import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blobInventoryConformance, blobStoreConformance } from "@guild/kernel/testing";
import { FilesystemBlobStore } from "./filesystem-blob-store.js";

function bytesStream(bytes: Uint8Array, chunkSize = bytes.byteLength || 1): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function put(store: FilesystemBlobStore, key: string): Promise<void> {
  const body = new TextEncoder().encode(key);
  await store.putIfAbsent(key, {
    body: bytesStream(body),
    size: body.byteLength,
    contentType: "text/plain",
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}

describe("FilesystemBlobStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function fixture(): Promise<{ root: string; store: FilesystemBlobStore }> {
    const root = await mkdtemp(path.join(tmpdir(), "guild-blobs-"));
    roots.push(root);
    return { root, store: new FilesystemBlobStore(root) };
  }

  blobStoreConformance("immutable BlobStore contract", async () => (await fixture()).store);
  blobInventoryConformance("read-only BlobInventory contract", async () => (await fixture()).store);

  it("rejects traversal before touching paths outside the root", async () => {
    const { store } = await fixture();
    const body = new Uint8Array([1]);
    await expect(store.putIfAbsent("../escape", {
      body: bytesStream(body),
      size: 1,
      contentType: "application/octet-stream",
      sha256: createHash("sha256").update(body).digest("hex"),
    })).rejects.toThrow("relative, normalized path");
    await expect(store.head("C:\\escape")).rejects.toThrow("relative, normalized path");
  });

  it("streams a large object and reads only the requested range", async () => {
    const { store } = await fixture();
    const bytes = new Uint8Array(5 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    await store.putIfAbsent("media/large.bin", {
      body: bytesStream(bytes, 64 * 1024),
      size: bytes.byteLength,
      contentType: "application/octet-stream",
      sha256,
    });
    const read = await store.get("media/large.bin", { offset: bytes.length - 300, length: 500 });

    expect(read?.metadata).toEqual(expect.objectContaining({ size: bytes.length, sha256 }));
    expect(read?.range).toEqual({ offset: bytes.length - 300, length: 300, total: bytes.length });
    expect(await streamBytes(read!.body)).toEqual(bytes.slice(-300));
  });

  it("does not publish a missing object when streamed content fails digest validation", async () => {
    const { store } = await fixture();
    const original = new TextEncoder().encode("original");
    const originalHash = createHash("sha256").update(original).digest("hex");
    const replacement = new TextEncoder().encode("replacement");
    await expect(store.putIfAbsent("media/item.bin", {
      body: bytesStream(replacement, 2),
      size: replacement.byteLength,
      contentType: "application/octet-stream",
      sha256: originalHash,
    })).rejects.toThrow("sha256");

    await expect(store.get("media/item.bin")).resolves.toBeNull();
  });

  it("lists lexicographic prefix pages across directories", async () => {
    const { store } = await fixture();
    await Promise.all([
      put(store, "media/a/01.txt"),
      put(store, "media/a/02.txt"),
      put(store, "media/a.0.txt"),
      put(store, "media/b/01.txt"),
      put(store, "media/root.txt"),
    ]);

    const first = await store.listPrefix({ prefix: "media/", limit: 2 });
    expect(first.objects.map(({ key }) => key)).toEqual(["media/a.0.txt", "media/a/01.txt"]);
    expect(first.nextCheckpoint).toBe("media/a/01.txt");

    const second = await store.listPrefix({
      prefix: "media/",
      checkpoint: first.nextCheckpoint!,
      limit: 2,
    });
    expect(second.objects.map(({ key }) => key)).toEqual(["media/a/02.txt", "media/b/01.txt"]);
    expect(second.nextCheckpoint).toBe("media/b/01.txt");

    const third = await store.listPrefix({
      prefix: "media/",
      checkpoint: second.nextCheckpoint!,
      limit: 2,
    });
    expect(third.objects.map(({ key }) => key)).toEqual(["media/root.txt"]);
    expect(third.nextCheckpoint).toBeNull();

    await expect(store.listPrefix({ prefix: "media/b/", limit: 2 })).resolves.toMatchObject({
      objects: [expect.objectContaining({ key: "media/b/01.txt" })],
      nextCheckpoint: null,
    });
  });

  it("keeps a high-cardinality directory lexicographic while selecting one bounded page", async () => {
    const { store } = await fixture();
    await Promise.all(Array.from({ length: 300 }, (_, index) => (
      put(store, `media/crowded/${index.toString().padStart(3, "0")}.txt`)
    )));

    const first = await store.listPrefix({ prefix: "media/crowded/", limit: 3 });
    expect(first.objects.map(({ key }) => key)).toEqual([
      "media/crowded/000.txt",
      "media/crowded/001.txt",
      "media/crowded/002.txt",
    ]);
    await expect(store.listPrefix({
      prefix: "media/crowded/",
      checkpoint: first.nextCheckpoint!,
      limit: 3,
    })).resolves.toMatchObject({
      objects: [
        expect.objectContaining({ key: "media/crowded/003.txt" }),
        expect.objectContaining({ key: "media/crowded/004.txt" }),
        expect.objectContaining({ key: "media/crowded/005.txt" }),
      ],
    });
  });

  it("can require an existing blob root for read-only operations", async () => {
    const root = path.join(tmpdir(), `guild-blobs-missing-${crypto.randomUUID()}`);
    expect(() => new FilesystemBlobStore(root, { createRoot: false })).toThrow(/does not exist/i);
  });

  it("stops a bounded page before a later unrelated subtree", async () => {
    const { root, store } = await fixture();
    await put(store, "media/a-first.txt");
    await put(store, "media/b-next.txt");
    for (let index = 0; index < 64; index += 1) {
      await put(store, `media/z-unrelated/${index.toString().padStart(3, "0")}.txt`);
    }
    await symlink(
      path.join(root, "media"),
      path.join(root, "media", "z-unrelated", "must-not-enumerate"),
      "junction",
    );

    await expect(store.listPrefix({ prefix: "media/", limit: 1 })).resolves.toMatchObject({
      objects: [expect.objectContaining({ key: "media/a-first.txt" })],
      nextCheckpoint: "media/a-first.txt",
    });
  });

  it("rejects symbolic links during inventory without following them", async () => {
    const { root, store } = await fixture();
    await mkdir(path.join(root, "media"));
    await mkdir(path.join(root, "target"));
    await symlink(path.join(root, "target"), path.join(root, "media", "linked"), "junction");

    await expect(store.listPrefix({ prefix: "media/", limit: 1 })).rejects.toThrow("symbolic link");
  });
});
