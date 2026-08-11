export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type BlobMetadata = Readonly<{
  key: string;
  size: number;
  contentType: string;
  sha256: string;
  etag: string;
  lastModified: string;
}>;

export type BlobRange = Readonly<{
  offset: number;
  length: number;
}>;

export type BlobRead = Readonly<{
  metadata: BlobMetadata;
  body: ReadableStream<Uint8Array>;
  range?: Readonly<BlobRange & { total: number }>;
}>;

export type BlobPutInput = Readonly<{
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
  sha256: string;
}>;

export class BlobWriteConflictError extends Error {
  constructor(readonly key: string) {
    super(`Blob ${key} already exists with different metadata`);
    this.name = "BlobWriteConflictError";
  }
}

export interface BlobStore {
  putIfAbsent(key: string, input: BlobPutInput): Promise<BlobMetadata>;
  get(key: string, range?: BlobRange): Promise<BlobRead | null>;
  head(key: string): Promise<BlobMetadata | null>;
  delete(key: string | readonly string[]): Promise<void>;
}

export type BlobInventoryRequest = Readonly<{
  prefix: string;
  checkpoint?: string;
  limit: number;
}>;

export type BlobInventoryPage = Readonly<{
  objects: readonly BlobMetadata[];
  nextCheckpoint: string | null;
}>;

/** Operational, read-only enumeration kept separate from the hot-path BlobStore. */
export interface BlobInventory {
  listPrefix(request: BlobInventoryRequest): Promise<BlobInventoryPage>;
}

export type NotificationMessage = Readonly<{
  type: string;
  [key: string]: JsonValue;
}>;

export interface NotificationPublisher {
  publish(message: NotificationMessage): Promise<void>;
}

export type DeferredTask = () => Promise<void>;

export interface DeferredTasks {
  defer(task: DeferredTask): void;
}

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds?: number;
}>;

export interface RateLimiter {
  consume(key: string): Promise<RateLimitDecision>;
}

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function assertBlobKey(key: string): void {
  if (
    !key
    || key.startsWith("/")
    || key.endsWith("/")
    || key.includes("\\")
    || key.includes("\0")
    || key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError("Blob key must be a relative, normalized path");
  }
}

export function assertBlobPutInput(input: BlobPutInput): void {
  if (!Number.isSafeInteger(input.size) || input.size < 0) {
    throw new TypeError("Blob size must be a non-negative safe integer");
  }
  if (!input.contentType.trim() || input.contentType.length > 255) {
    throw new TypeError("Blob contentType must be between 1 and 255 characters");
  }
  if (!SHA256_HEX_PATTERN.test(input.sha256)) {
    throw new TypeError("Blob sha256 must be 64 lowercase hexadecimal characters");
  }
}

export function assertBlobInventoryRequest(request: BlobInventoryRequest): void {
  if (
    request.prefix.length > 1_024
    || request.prefix.startsWith("/")
    || request.prefix.includes("\\")
    || request.prefix.includes("\0")
    || request.prefix.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError("Blob inventory prefix must be a normalized relative prefix");
  }
  if (
    request.checkpoint !== undefined
    && (request.checkpoint.length < 1 || request.checkpoint.length > 4_096)
  ) {
    throw new TypeError("Blob inventory checkpoint is invalid");
  }
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1_000) {
    throw new RangeError("Blob inventory limit must be between 1 and 1000");
  }
}

export function assertBlobPutMatches(
  metadata: BlobMetadata,
  key: string,
  input: BlobPutInput,
): void {
  if (
    metadata.key !== key
    || metadata.size !== input.size
    || metadata.contentType !== input.contentType
    || metadata.sha256 !== input.sha256
  ) {
    throw new BlobWriteConflictError(key);
  }
}

export function normalizeBlobRange(range: BlobRange, total: number): BlobRange {
  if (!Number.isSafeInteger(total) || total < 0) throw new TypeError("Blob size is invalid");
  if (
    !Number.isSafeInteger(range.offset)
    || !Number.isSafeInteger(range.length)
    || range.offset < 0
    || range.length < 1
    || range.offset >= total
  ) {
    throw new RangeError("Blob range is not satisfiable");
  }
  return {
    offset: range.offset,
    length: Math.min(range.length, total - range.offset),
  };
}
