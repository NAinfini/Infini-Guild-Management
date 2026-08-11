import { describe, expect, it, vi } from "vitest";
import { blobInventoryConformance, blobStoreConformance } from "@guild/kernel/testing";
import {
  R2BlobStore,
  type FixedLengthStreamFactory,
} from "./r2-blob-store.js";

type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  etag: string;
  uploaded: Date;
};

const TEST_SHA256 = "a".repeat(64);

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const fixedLengthStream: FixedLengthStreamFactory = (expectedLength) => {
  let received = 0;
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > expectedLength) throw new RangeError("Stream exceeded its fixed length");
      controller.enqueue(chunk);
    },
    flush() {
      if (received !== expectedLength) throw new RangeError("Stream did not reach its fixed length");
    },
  });
  return stream;
};

function objectMetadata(key: string, object: StoredObject): R2Object {
  return {
    key,
    version: object.etag,
    size: object.bytes.byteLength,
    etag: object.etag,
    httpEtag: `"${object.etag}"`,
    uploaded: object.uploaded,
    httpMetadata: { contentType: object.contentType },
    customMetadata: { sha256: object.sha256 },
    checksums: { toJSON: () => ({ sha256: object.sha256 }) },
    storageClass: "Standard",
    writeHttpMetadata() {},
  } as unknown as R2Object;
}

function objectBody(key: string, object: StoredObject, bytes = object.bytes): R2ObjectBody {
  return {
    ...objectMetadata(key, object),
    body: bytesStream(bytes),
  } as unknown as R2ObjectBody;
}

function objectWithSha256Sources(
  key: string,
  object: StoredObject,
  customSha256: string | undefined,
  checksumSha256: string | undefined,
): R2Object {
  return {
    ...objectMetadata(key, object),
    customMetadata: customSha256 === undefined ? {} : { sha256: customSha256 },
    checksums: {
      toJSON: () => checksumSha256 === undefined ? {} : { sha256: checksumSha256 },
    },
  } as unknown as R2Object;
}

function inMemoryBucket(): { bucket: R2Bucket; objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  let version = 0;
  const bucket = {
    async put(key: string, value: ReadableStream<Uint8Array>, options: R2PutOptions) {
      const bytes = await readStream(value);
      const onlyIf = options.onlyIf;
      if (
        onlyIf
        && !(onlyIf instanceof Headers)
        && onlyIf.etagDoesNotMatch === "*"
        && objects.has(key)
      ) return null;
      const object: StoredObject = {
        bytes,
        contentType: options.httpMetadata && !(options.httpMetadata instanceof Headers)
          ? options.httpMetadata.contentType ?? "application/octet-stream"
          : "application/octet-stream",
        sha256: options.customMetadata!.sha256!,
        etag: `v${version += 1}`,
        uploaded: new Date("2026-08-09T00:00:00.000Z"),
      };
      objects.set(key, object);
      return objectMetadata(key, object);
    },
    async head(key: string) {
      const object = objects.get(key);
      return object ? objectMetadata(key, object) : null;
    },
    async get(key: string, options?: R2GetOptions) {
      const object = objects.get(key);
      if (!object) return null;
      const range = options?.range;
      const bytes = range && !(range instanceof Headers) && "offset" in range
        ? object.bytes.slice(range.offset ?? 0, (range.offset ?? 0) + (range.length ?? object.bytes.byteLength))
        : object.bytes;
      return objectBody(key, object, bytes);
    },
    async delete(key: string | string[]) {
      for (const item of typeof key === "string" ? [key] : key) objects.delete(item);
    },
    async list(options: R2ListOptions) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(options.prefix ?? "")).sort();
      const start = Number(options.cursor ?? 0);
      const end = Math.min(start + (options.limit ?? 1_000), keys.length);
      return {
        objects: keys.slice(start, end).map((key) => objectMetadata(key, objects.get(key)!)),
        truncated: end < keys.length,
        ...(end < keys.length ? { cursor: String(end) } : {}),
        delimitedPrefixes: [],
      } as R2Objects;
    },
  } as unknown as R2Bucket;
  return { bucket, objects };
}

describe("R2BlobStore", () => {
  blobStoreConformance("immutable BlobStore contract", () => {
    const { bucket } = inMemoryBucket();
    return new R2BlobStore(bucket, fixedLengthStream);
  });

  blobInventoryConformance("read-only BlobInventory contract", () => {
    const { bucket } = inMemoryBucket();
    return new R2BlobStore(bucket, fixedLengthStream);
  });

  it("does not publish a missing key when its stream violates the declared length", async () => {
    const { bucket, objects } = inMemoryBucket();
    const store = new R2BlobStore(bucket, fixedLengthStream);
    const bytes = new TextEncoder().encode("invalid-length");
    await expect(store.putIfAbsent("media/item.bin", {
      body: bytesStream(bytes),
      size: bytes.byteLength - 1,
      contentType: "application/octet-stream",
      sha256: TEST_SHA256,
    })).rejects.toThrow();

    expect(objects.has("media/item.bin")).toBe(false);
  });

  it("performs a ranged read with one body lookup and no metadata lookup", async () => {
    const stored: StoredObject = {
      bytes: new TextEncoder().encode("second-version"),
      contentType: "text/plain",
      sha256: TEST_SHA256,
      etag: "v2",
      uploaded: new Date("2026-08-09T00:00:01.000Z"),
    };
    const head = vi.fn();
    const get = vi.fn().mockResolvedValue(objectBody("media/item.txt", stored, stored.bytes.slice(2, 6)));
    const store = new R2BlobStore({ head, get } as unknown as R2Bucket, fixedLengthStream);

    const result = await store.get("media/item.txt", { offset: 2, length: 4 });

    expect(head).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("media/item.txt", { range: { offset: 2, length: 4 } });
    expect(result?.metadata.etag).toBe("v2");
    expect(result?.range).toEqual({ offset: 2, length: 4, total: stored.bytes.byteLength });
    expect(await readStream(result!.body)).toEqual(stored.bytes.slice(2, 6));
  });

  it("accepts either sha256 source and rejects conflicting sources", async () => {
    const stored: StoredObject = {
      bytes: new Uint8Array([1]),
      contentType: "application/octet-stream",
      sha256: TEST_SHA256,
      etag: "v1",
      uploaded: new Date("2026-08-09T00:00:00.000Z"),
    };
    const conflictingSha256 = "b".repeat(64);
    const objects = new Map<string, R2Object>([
      ["media/custom.bin", objectWithSha256Sources("media/custom.bin", stored, TEST_SHA256, undefined)],
      ["media/checksum.bin", objectWithSha256Sources("media/checksum.bin", stored, undefined, TEST_SHA256)],
      ["media/conflict.bin", objectWithSha256Sources("media/conflict.bin", stored, TEST_SHA256, conflictingSha256)],
    ]);
    const store = new R2BlobStore({
      head: vi.fn(async (key: string) => objects.get(key) ?? null),
    } as unknown as R2Bucket, fixedLengthStream);

    await expect(store.head("media/custom.bin")).resolves.toMatchObject({ sha256: TEST_SHA256 });
    await expect(store.head("media/checksum.bin")).resolves.toMatchObject({ sha256: TEST_SHA256 });
    await expect(store.head("media/conflict.bin")).rejects.toThrow(/integrity validation/);
  });
});
