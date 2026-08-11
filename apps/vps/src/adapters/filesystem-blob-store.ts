import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, mkdirSync, realpathSync, type Dirent } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  opendir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  SHA256_HEX_PATTERN,
  assertBlobKey,
  assertBlobInventoryRequest,
  assertBlobPutInput,
  assertBlobPutMatches,
  normalizeBlobRange,
  type BlobInventory,
  type BlobInventoryPage,
  type BlobInventoryRequest,
  type BlobMetadata,
  type BlobPutInput,
  type BlobRange,
  type BlobRead,
  type BlobStore,
} from "@guild/kernel";

const FILE_MAGIC = Buffer.from("IGB1");
const PREFIX_BYTES = 8;
const MAX_HEADER_BYTES = 4_096;

type StoredHeader = Omit<BlobMetadata, "key">;
type InventoryEntry = Readonly<{ entry: Dirent; key: string; sortKey: string }>;

export type FilesystemBlobStoreOptions = Readonly<{
  createRoot?: boolean;
}>;

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function writeAll(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await handle.write(bytes, written, bytes.byteLength - written, position + written);
    if (result.bytesWritten === 0) throw new Error("Filesystem stopped accepting blob bytes");
    written += result.bytesWritten;
  }
}

async function readExact(handle: FileHandle, bytes: Uint8Array, position: number): Promise<boolean> {
  let read = 0;
  while (read < bytes.byteLength) {
    const result = await handle.read(bytes, read, bytes.byteLength - read, position + read);
    if (result.bytesRead === 0) return false;
    read += result.bytesRead;
  }
  return true;
}

function encodeHeader(header: StoredHeader): Uint8Array {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  if (json.byteLength > MAX_HEADER_BYTES) throw new Error("Blob metadata header is too large");
  const bytes = Buffer.allocUnsafe(PREFIX_BYTES + json.byteLength);
  FILE_MAGIC.copy(bytes, 0);
  bytes.writeUInt32BE(json.byteLength, FILE_MAGIC.byteLength);
  json.copy(bytes, PREFIX_BYTES);
  return bytes;
}

function parseHeader(value: unknown): StoredHeader {
  if (!value || typeof value !== "object") throw new Error("Blob metadata is corrupt");
  const header = value as Partial<StoredHeader>;
  if (
    !Number.isSafeInteger(header.size)
    || (header.size ?? -1) < 0
    || typeof header.contentType !== "string"
    || !header.contentType
    || typeof header.sha256 !== "string"
    || !SHA256_HEX_PATTERN.test(header.sha256)
    || typeof header.etag !== "string"
    || !header.etag
    || typeof header.lastModified !== "string"
    || !Number.isFinite(Date.parse(header.lastModified))
  ) {
    throw new Error("Blob metadata is corrupt");
  }
  return header as StoredHeader;
}

async function readHeader(handle: FileHandle, key: string): Promise<{ metadata: BlobMetadata; bodyOffset: number }> {
  const prefix = Buffer.alloc(PREFIX_BYTES);
  if (!await readExact(handle, prefix, 0) || !prefix.subarray(0, 4).equals(FILE_MAGIC)) {
    throw new Error(`Blob ${key} has an invalid file header`);
  }
  const headerLength = prefix.readUInt32BE(4);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
    throw new Error(`Blob ${key} has an invalid metadata length`);
  }
  const headerBytes = Buffer.alloc(headerLength);
  if (!await readExact(handle, headerBytes, PREFIX_BYTES)) throw new Error(`Blob ${key} metadata is truncated`);
  const header = parseHeader(JSON.parse(headerBytes.toString("utf8")) as unknown);
  const bodyOffset = PREFIX_BYTES + headerLength;
  const stats = await handle.stat();
  if (stats.size !== bodyOffset + header.size) throw new Error(`Blob ${key} body is truncated`);
  return { metadata: { key, ...header }, bodyOffset };
}

function emptyBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

export class FilesystemBlobStore implements BlobStore, BlobInventory {
  private readonly root: string;

  constructor(rootDirectory: string, options: FilesystemBlobStoreOptions = {}) {
    if (!rootDirectory.trim()) throw new TypeError("Blob root directory is required");
    const resolved = path.resolve(rootDirectory);
    if (options.createRoot !== false) mkdirSync(resolved, { recursive: true });
    else {
      try {
        lstatSync(resolved);
      } catch (error) {
        if (isErrno(error, "ENOENT")) throw new Error("Blob root directory does not exist", { cause: error });
        throw error;
      }
    }
    this.root = realpathSync.native(resolved);
    if (!lstatSync(this.root).isDirectory()) throw new Error("Blob root path is not a directory");
  }

  async putIfAbsent(key: string, input: BlobPutInput): Promise<BlobMetadata> {
    assertBlobKey(key);
    assertBlobPutInput(input);
    const existing = await this.head(key);
    if (existing) {
      await input.body.cancel().catch(() => undefined);
      assertBlobPutMatches(existing, key, input);
      return existing;
    }

    const target = await this.prepareTarget(key);
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    const lastModified = new Date().toISOString();
    const stored: StoredHeader = {
      size: input.size,
      contentType: input.contentType,
      sha256: input.sha256,
      etag: input.sha256,
      lastModified,
    };
    const header = encodeHeader(stored);
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await writeAll(handle, header, 0);
      const hash = createHash("sha256");
      const reader = input.body.getReader();
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (!(next.value instanceof Uint8Array)) throw new TypeError("Blob streams must contain Uint8Array chunks");
          size += next.value.byteLength;
          if (size > input.size) throw new RangeError("Blob stream exceeds its declared size");
          hash.update(next.value);
          await writeAll(handle, next.value, header.byteLength + size - next.value.byteLength);
        }
      } catch (error) {
        try {
          await reader.cancel(error);
        } catch {
          // The original read or validation error remains authoritative.
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
      if (size !== input.size) throw new RangeError("Blob stream does not match its declared size");
      if (hash.digest("hex") !== input.sha256) throw new Error("Blob sha256 does not match its content");
      await handle.sync();
      await handle.close();
      try {
        await link(temp, target);
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
        const winner = await this.head(key);
        if (!winner) throw new Error(`Blob ${key} disappeared after an exclusive write conflict`);
        assertBlobPutMatches(winner, key, input);
        return winner;
      }
      return { key, ...stored };
    } finally {
      try {
        await handle.close();
      } catch {
        // The write failure remains authoritative.
      }
      try {
        await unlink(temp);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
    }
  }

  async head(key: string): Promise<BlobMetadata | null> {
    const opened = await this.openObject(key);
    if (!opened) return null;
    try {
      return (await readHeader(opened, key)).metadata;
    } finally {
      await opened.close();
    }
  }

  async get(key: string, requestedRange?: BlobRange): Promise<BlobRead | null> {
    const opened = await this.openObject(key);
    if (!opened) return null;
    try {
      const { metadata, bodyOffset } = await readHeader(opened, key);
      const range = requestedRange ? normalizeBlobRange(requestedRange, metadata.size) : undefined;
      if (metadata.size === 0) {
        await opened.close();
        return { metadata, body: emptyBody() };
      }
      const stream = opened.createReadStream({
        start: bodyOffset + (range?.offset ?? 0),
        ...(range ? { end: bodyOffset + range.offset + range.length - 1 } : {}),
        autoClose: true,
      });
      const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
      return {
        metadata,
        body,
        ...(range ? { range: { ...range, total: metadata.size } } : {}),
      };
    } catch (error) {
      try {
        await opened.close();
      } catch {
        // The read or validation error remains authoritative.
      }
      throw error;
    }
  }

  async delete(keyOrKeys: string | readonly string[]): Promise<void> {
    const keys = typeof keyOrKeys === "string" ? [keyOrKeys] : [...keyOrKeys];
    keys.forEach(assertBlobKey);
    for (const key of keys) {
      const target = await this.existingTarget(key);
      if (!target) continue;
      try {
        await unlink(target);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
    }
  }

  async listPrefix(request: BlobInventoryRequest): Promise<BlobInventoryPage> {
    assertBlobInventoryRequest(request);
    const keys: string[] = [];
    for await (const key of this.inventoryKeys(
      this.root,
      "",
      request.prefix,
      request.limit + 1,
      request.checkpoint,
    )) {
      keys.push(key);
      if (keys.length === request.limit + 1) break;
    }
    const hasMore = keys.length > request.limit;
    const selected = hasMore ? keys.slice(0, request.limit) : keys;
    const objects: BlobMetadata[] = [];
    for (const key of selected) {
      const metadata = await this.head(key);
      if (metadata) objects.push(metadata);
    }
    return {
      objects,
      nextCheckpoint: hasMore ? selected.at(-1)! : null,
    };
  }

  private target(key: string): string {
    assertBlobKey(key);
    return path.join(this.root, ...key.split("/"));
  }

  private async prepareTarget(key: string): Promise<string> {
    const segments = key.split("/");
    let current = this.root;
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      try {
        const stats = await lstat(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Blob key crosses a non-directory path");
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
        try {
          await mkdir(current);
        } catch (mkdirError) {
          if (!isErrno(mkdirError, "EEXIST")) throw mkdirError;
        }
        const stats = await lstat(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Blob key crosses a non-directory path");
      }
    }
    const target = this.target(key);
    try {
      const stats = await lstat(target);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Blob key resolves to a non-file path");
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }
    return target;
  }

  private async existingTarget(key: string): Promise<string | null> {
    const segments = key.split("/");
    let current = this.root;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      try {
        const stats = await lstat(current);
        const leaf = index === segments.length - 1;
        if (stats.isSymbolicLink() || (leaf ? !stats.isFile() : !stats.isDirectory())) {
          throw new Error("Blob key crosses a non-file path");
        }
      } catch (error) {
        if (isErrno(error, "ENOENT")) return null;
        throw error;
      }
    }
    return current;
  }

  private async openObject(key: string): Promise<FileHandle | null> {
    assertBlobKey(key);
    const target = await this.existingTarget(key);
    if (!target) return null;
    try {
      return await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null;
      throw error;
    }
  }

  private async *inventoryKeys(
    directory: string,
    prefix: string,
    requestedPrefix: string,
    batchSize: number,
    checkpoint?: string,
  ): AsyncGenerator<string> {
    let after: string | undefined;
    while (true) {
      const entries = await this.selectInventoryEntries(
        directory,
        prefix,
        requestedPrefix,
        batchSize,
        checkpoint,
        after,
      );
      if (entries.length === 0) return;
      for (const { entry, key } of entries) {
        if (entry.isDirectory()) {
          yield* this.inventoryKeys(
            path.join(directory, entry.name),
            key,
            requestedPrefix,
            batchSize,
            checkpoint,
          );
        } else {
          yield key;
        }
      }
      if (entries.length < batchSize) return;
      after = entries.at(-1)!.sortKey;
    }
  }

  private async selectInventoryEntries(
    directory: string,
    prefix: string,
    requestedPrefix: string,
    limit: number,
    checkpoint?: string,
    after?: string,
  ): Promise<readonly InventoryEntry[]> {
    const selected: InventoryEntry[] = [];
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (entry.isSymbolicLink()) throw new Error("Blob inventory cannot cross a symbolic link");
      if (!entry.isDirectory() && !entry.isFile()) {
        throw new Error("Blob inventory found an unsupported filesystem entry");
      }
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      const sortKey = entry.isDirectory() ? `${key}/` : key;
      if (after && sortKey <= after) continue;
      if (entry.isDirectory()) {
        if (
          !requestedPrefix.startsWith(sortKey)
          && !sortKey.startsWith(requestedPrefix)
        ) continue;
        if (checkpoint && checkpoint >= sortKey && !checkpoint.startsWith(sortKey)) continue;
      } else if (!key.startsWith(requestedPrefix) || (checkpoint && key <= checkpoint)) {
        continue;
      }
      offerInventoryEntry(selected, { entry, key, sortKey }, limit);
    }
    return selected.sort(compareInventoryEntries);
  }
}

function offerInventoryEntry(heap: InventoryEntry[], value: InventoryEntry, limit: number): void {
  if (heap.length < limit) {
    heap.push(value);
    siftInventoryUp(heap, heap.length - 1);
  } else if (value.sortKey < heap[0]!.sortKey) {
    heap[0] = value;
    siftInventoryDown(heap, 0);
  }
}

function siftInventoryUp(heap: InventoryEntry[], start: number): void {
  let index = start;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent]!.sortKey >= heap[index]!.sortKey) return;
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
}

function siftInventoryDown(heap: InventoryEntry[], start: number): void {
  let index = start;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let largest = index;
    if (left < heap.length && heap[left]!.sortKey > heap[largest]!.sortKey) largest = left;
    if (right < heap.length && heap[right]!.sortKey > heap[largest]!.sortKey) largest = right;
    if (largest === index) return;
    [heap[index], heap[largest]] = [heap[largest]!, heap[index]!];
    index = largest;
  }
}

function compareInventoryEntries(left: InventoryEntry, right: InventoryEntry): number {
  return left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0;
}
