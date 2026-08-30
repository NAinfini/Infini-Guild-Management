import { AppError, type BlobMetadata, type BlobRead, type BlobStore, type ScheduledJobBacklog } from "@guild/kernel";
import type { AuditEvent } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { RequestContext } from "@guild/kernel";
import type { AuditEventWrite } from "./audit.js";

export const AUDIT_ARCHIVE_BATCH_SIZE = 100;
export const AUDIT_ARCHIVE_CLEANUP_BATCH_SIZE = 16;
const AUDIT_ARCHIVE_LEASE_MS = 10 * 60 * 1_000;
export const AUDIT_ARCHIVE_CONTENT_TYPE = "application/x-ndjson; charset=UTF-8";

export type AuditArchiveClaim = Readonly<{
  id: string;
  leaseToken: string;
  objectKey: string;
  month: string;
  entries: readonly AuditEvent[];
}>;

export type AuditArchiveManifest = Readonly<{
  id: string;
  month: string;
  objectKey: string;
  rowCount: number;
  startsAt: string;
  endsAt: string;
  sizeBytes: number;
  sha256: string;
  completedAt: string;
}>;

export type AuditArchiveAuditFactory = (archiveId: string, rowCount: number) => AuditEventWrite;

export interface AuditArchiveStore {
  claim(input: Readonly<{
    id: string;
    leaseToken: string;
    objectKey: string;
    month: string;
    before: string;
    now: string;
    leaseExpiresAt: string;
    limit: number;
  }>): Promise<AuditArchiveClaim | null>;
  finalize(input: Readonly<{
    id: string;
    leaseToken: string;
    sizeBytes: number;
    sha256: string;
    completedAt: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  inspectBacklog(before: string): Promise<ScheduledJobBacklog>;
  inspectExpiredBacklog(completedBefore: string): Promise<ScheduledJobBacklog>;
  listExpired(completedBefore: string, limit: number): Promise<readonly AuditArchiveManifest[]>;
  deleteExpired(input: Readonly<{
    id: string;
    completedBefore: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  listMonths(): Promise<readonly string[]>;
  listReady(month: string): Promise<readonly AuditArchiveManifest[]>;
  getReady(id: string): Promise<AuditArchiveManifest | null>;
}

export class AuditArchiveService {
  constructor(
    private readonly store: AuditArchiveStore,
    private readonly blobs: BlobStore,
  ) {}

  async archiveBatch(
    before: string,
    now: string,
    createAudit: AuditArchiveAuditFactory,
  ): Promise<Readonly<{ archived: number; archiveId: string | null }>> {
    assertIsoDate(before, "Archive cutoff");
    assertIsoDate(now, "Archive time");
    if (before >= now) throw validation("Archive cutoff must be before archive time");

    const id = crypto.randomUUID();
    const leaseToken = crypto.randomUUID();
    const month = now.slice(0, 7);
    const claim = await this.store.claim({
      id,
      leaseToken,
      objectKey: `audit/${now.slice(0, 4)}/${now.slice(5, 7)}/${id}.ndjson`,
      month,
      before,
      now,
      leaseExpiresAt: new Date(Date.parse(now) + AUDIT_ARCHIVE_LEASE_MS).toISOString(),
      limit: AUDIT_ARCHIVE_BATCH_SIZE,
    });
    if (!claim) return { archived: 0, archiveId: null };

    const archive = measureNdjson(claim.entries);
    const metadata = await this.blobs.putIfAbsent(claim.objectKey, {
      body: ndjsonStream(claim.entries),
      size: archive.size,
      contentType: AUDIT_ARCHIVE_CONTENT_TYPE,
      sha256: archive.sha256,
    });
    if (
      metadata.key !== claim.objectKey
      || metadata.size !== archive.size
      || metadata.contentType !== AUDIT_ARCHIVE_CONTENT_TYPE
      || metadata.sha256 !== archive.sha256
    ) {
      throw new AppError({
        code: "UPSTREAM_ERROR",
        status: 503,
        message: "Audit archive object verification failed",
      });
    }
    if (!await this.store.finalize({
      id: claim.id,
      leaseToken: claim.leaseToken,
      sizeBytes: archive.size,
      sha256: archive.sha256,
      completedAt: now,
      audit: createAudit(claim.id, claim.entries.length),
    })) {
      throw new AppError({
        code: "CONFLICT",
        status: 409,
        message: "Audit archive lease expired before finalization",
      });
    }
    return { archived: claim.entries.length, archiveId: claim.id };
  }

  inspectBacklog(before: string): Promise<ScheduledJobBacklog> {
    return this.store.inspectBacklog(before);
  }

  async cleanupExpired(
    completedBefore: string,
    limit: number,
    createAudit: AuditArchiveAuditFactory,
  ): Promise<Readonly<{ deleted: number }>> {
    assertIsoDate(completedBefore, "Archive retention cutoff");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUDIT_ARCHIVE_CLEANUP_BATCH_SIZE) {
      throw new TypeError(`Audit archive cleanup limit must be between 1 and ${AUDIT_ARCHIVE_CLEANUP_BATCH_SIZE}`);
    }
    const expired = await this.store.listExpired(completedBefore, limit);
    let deleted = 0;
    for (const manifest of expired) {
      await this.blobs.delete(manifest.objectKey);
      if (!await this.store.deleteExpired({
        id: manifest.id,
        completedBefore,
        audit: createAudit(manifest.id, manifest.rowCount),
      })) {
        throw new AppError({
          code: "CONFLICT",
          status: 409,
          message: "Audit archive changed before retention cleanup",
        });
      }
      deleted += 1;
    }
    return { deleted };
  }

  async inspectCombinedBacklog(
    archiveBefore: string,
    expiredBefore: string,
  ): Promise<ScheduledJobBacklog> {
    assertIsoDate(archiveBefore, "Archive cutoff");
    assertIsoDate(expiredBefore, "Archive retention cutoff");
    const expired = await this.store.inspectExpiredBacklog(expiredBefore);
    if (expired.status === "unknown" || expired.pendingCount > 0) return expired;
    return this.store.inspectBacklog(archiveBefore);
  }

  listMonths(context: RequestContext): Promise<readonly string[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    return this.store.listMonths();
  }

  listFiles(context: RequestContext, month: string): Promise<readonly AuditArchiveManifest[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    assertMonth(month);
    return this.store.listReady(month);
  }

  async read(
    context: RequestContext,
    archiveId: string,
    range?: Readonly<{ offset: number; length: number }>,
  ): Promise<BlobRead> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    const manifest = await this.store.getReady(archiveId);
    if (!manifest) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Audit archive not found" });
    const object = await this.blobs.get(manifest.objectKey, range);
    if (!object) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Audit archive object not found" });
    if (!matchesManifest(object.metadata, manifest)) {
      try { await object.body.cancel(); } catch { /* Preserve the integrity error. */ }
      throw new AppError({
        code: "UPSTREAM_ERROR",
        status: 503,
        message: "Audit archive object failed integrity validation",
      });
    }
    return object;
  }

  async head(context: RequestContext, archiveId: string): Promise<BlobMetadata> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    const manifest = await this.store.getReady(archiveId);
    if (!manifest) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Audit archive not found" });
    const metadata = await this.blobs.head(manifest.objectKey);
    if (!metadata) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Audit archive object not found" });
    if (!matchesManifest(metadata, manifest)) {
      throw new AppError({
        code: "UPSTREAM_ERROR",
        status: 503,
        message: "Audit archive object failed integrity validation",
      });
    }
    return metadata;
  }
}

function matchesManifest(metadata: BlobMetadata, manifest: AuditArchiveManifest): boolean {
  return metadata.key === manifest.objectKey
    && metadata.size === manifest.sizeBytes
    && metadata.contentType === AUDIT_ARCHIVE_CONTENT_TYPE
    && metadata.sha256 === manifest.sha256;
}

const ndjsonEncoder = new TextEncoder();

function measureNdjson(entries: readonly AuditEvent[]): Readonly<{ size: number; sha256: string }> {
  if (entries.length < 1 || entries.length > AUDIT_ARCHIVE_BATCH_SIZE) {
    throw new TypeError("Audit archive claim must be bounded and non-empty");
  }
  const hash = new IncrementalSha256();
  let size = 0;
  for (const entry of entries) {
    const bytes = encodeNdjsonEntry(entry);
    size += bytes.byteLength;
    hash.update(bytes);
  }
  return { size, sha256: hash.hex() };
}

function ndjsonStream(entries: readonly AuditEvent[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const entry = entries[index];
      if (!entry) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(encodeNdjsonEntry(entry));
    },
    cancel() {
      index = entries.length;
    },
  });
}

function encodeNdjsonEntry(entry: AuditEvent): Uint8Array {
  return ndjsonEncoder.encode(`${JSON.stringify(entry)}\n`);
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class IncrementalSha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private blockLength = 0;
  private byteLength = 0;

  update(bytes: Uint8Array): void {
    this.byteLength += bytes.byteLength;
    let offset = 0;
    while (offset < bytes.byteLength) {
      const length = Math.min(this.block.byteLength - this.blockLength, bytes.byteLength - offset);
      this.block.set(bytes.subarray(offset, offset + length), this.blockLength);
      this.blockLength += length;
      offset += length;
      if (this.blockLength === this.block.byteLength) {
        this.compress();
        this.blockLength = 0;
      }
    }
  }

  hex(): string {
    const bitLength = this.byteLength * 8;
    this.block[this.blockLength] = 0x80;
    this.blockLength += 1;
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength);
      this.compress();
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength, 56);
    const view = new DataView(this.block.buffer);
    view.setUint32(56, Math.floor(bitLength / 0x1_0000_0000), false);
    view.setUint32(60, bitLength >>> 0, false);
    this.compress();
    const output = new Uint8Array(32);
    const outputView = new DataView(output.buffer);
    this.state.forEach((value, index) => outputView.setUint32(index * 4, value, false));
    return [...output].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private compress(): void {
    const words = new Uint32Array(64);
    const view = new DataView(this.block.buffer);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(index * 4, false);
    for (let index = 16; index < words.length; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < words.length; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a!) >>> 0;
    this.state[1] = (this.state[1]! + b!) >>> 0;
    this.state[2] = (this.state[2]! + c!) >>> 0;
    this.state[3] = (this.state[3]! + d!) >>> 0;
    this.state[4] = (this.state[4]! + e!) >>> 0;
    this.state[5] = (this.state[5]! + f!) >>> 0;
    this.state[6] = (this.state[6]! + g!) >>> 0;
    this.state[7] = (this.state[7]! + h!) >>> 0;
  }
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function assertIsoDate(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw validation(`${label} must be an ISO timestamp`);
  }
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw validation("Archive month is invalid");
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}
