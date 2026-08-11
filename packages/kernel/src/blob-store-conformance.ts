import { describe, expect, it } from "vitest";
import {
  BlobWriteConflictError,
  type BlobInventory,
  type BlobPutInput,
  type BlobStore,
} from "./ports.js";

export function blobStoreConformance(
  name: string,
  createStore: () => BlobStore | Promise<BlobStore>,
): void {
  describe(name, () => {
    it("writes only an absent key, accepts identical metadata, and rejects conflicting metadata", async () => {
      const store = await createStore();
      const bytes = new TextEncoder().encode("immutable");
      const input = await putInput(bytes, "text/plain");
      const created = await store.putIfAbsent("contract/item.txt", input);
      const unchanged = await store.putIfAbsent("contract/item.txt", await putInput(bytes, "text/plain"));

      expect(unchanged).toEqual(created);
      for (const conflict of [
        { ...await putInput(bytes, "application/octet-stream") },
        { ...await putInput(new TextEncoder().encode("different"), "text/plain") },
        { ...await putInput(bytes, "text/plain"), size: bytes.byteLength + 1 },
      ]) {
        await expect(store.putIfAbsent("contract/item.txt", conflict))
          .rejects.toBeInstanceOf(BlobWriteConflictError);
      }

      const object = await store.get("contract/item.txt");
      expect(object?.metadata).toEqual(created);
      expect(await readStream(object!.body)).toEqual(bytes);
    });

    it("keeps one immutable winner under concurrent conflicting writes", async () => {
      const store = await createStore();
      const first = new TextEncoder().encode("first");
      const second = new TextEncoder().encode("second");
      const results = await Promise.allSettled([
        store.putIfAbsent("contract/race.txt", await putInput(first, "text/plain")),
        store.putIfAbsent("contract/race.txt", await putInput(second, "text/plain")),
      ]);

      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
      const winner = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<unknown>;
      const object = await store.get("contract/race.txt");
      expect(object?.metadata).toEqual(winner.value);
      expect([first, second]).toContainEqual(await readStream(object!.body));
    });

    it("returns one normalized ranged body and deletes idempotently", async () => {
      const store = await createStore();
      const bytes = new TextEncoder().encode("0123456789");
      await store.putIfAbsent("contract/range.txt", await putInput(bytes, "text/plain"));

      const object = await store.get("contract/range.txt", { offset: 7, length: 10 });
      expect(object?.range).toEqual({ offset: 7, length: 3, total: 10 });
      expect(await readStream(object!.body)).toEqual(new TextEncoder().encode("789"));
      await store.delete(["contract/range.txt"]);
      await store.delete("contract/range.txt");
      await expect(store.get("contract/range.txt")).resolves.toBeNull();
    });
  });
}

export function blobInventoryConformance(
  name: string,
  createStore: () => (BlobStore & BlobInventory) | Promise<BlobStore & BlobInventory>,
): void {
  describe(name, () => {
    it("lists one prefix in stable checkpointed pages with canonical metadata", async () => {
      const store = await createStore();
      const mediaA = await store.putIfAbsent(
        "media/a.txt",
        await putInput(new TextEncoder().encode("a"), "text/plain"),
      );
      const mediaB = await store.putIfAbsent(
        "media/b.txt",
        await putInput(new TextEncoder().encode("b"), "text/plain"),
      );
      await store.putIfAbsent(
        "audit/2026/08/a.ndjson",
        await putInput(new TextEncoder().encode("audit"), "application/x-ndjson"),
      );

      const first = await store.listPrefix({ prefix: "media/", limit: 1 });
      expect(first.objects).toEqual([mediaA]);
      expect(first.nextCheckpoint).toEqual(expect.any(String));

      const second = await store.listPrefix({
        prefix: "media/",
        checkpoint: first.nextCheckpoint!,
        limit: 1,
      });
      expect(second).toEqual({ objects: [mediaB], nextCheckpoint: null });
    });

    it("rejects an unbounded inventory page", async () => {
      const store = await createStore();
      await expect(store.listPrefix({ prefix: "media/", limit: 1_001 })).rejects.toThrow("between 1 and 1000");
    });
  });
}

async function putInput(bytes: Uint8Array, contentType: string): Promise<BlobPutInput> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return {
    body: bytesStream(bytes),
    size: bytes.byteLength,
    contentType,
    sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
