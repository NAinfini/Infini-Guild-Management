import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertBlobPutMatches, type BlobMetadata, type BlobPutInput, type BlobRead, type BlobStore } from "@guild/kernel";
import { AuditArchiveService } from "@guild/server/modules/audit";
import { createSchedulerAuditFactory } from "@guild/server/modules/jobs";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAuditArchiveStore } from "./audit-archive-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const CUTOFF = "2026-07-01T00:00:00.000Z";
const databases: DatabaseSync[] = [];

class MemoryBlobs implements BlobStore {
  readonly objects = new Map<string, Readonly<{ bytes: Uint8Array; metadata: BlobMetadata }>>();
  failPuts = 0;
  metadataMismatch: "key" | "size" | "contentType" | "sha256" | null = null;

  async putIfAbsent(key: string, input: BlobPutInput): Promise<BlobMetadata> {
    if (this.failPuts > 0) {
      this.failPuts -= 1;
      throw new Error("injected blob failure");
    }
    const existing = this.objects.get(key);
    if (existing) {
      await input.body.cancel().catch(() => undefined);
      assertBlobPutMatches(existing.metadata, key, input);
      return existing.metadata;
    }
    const bytes = await readStream(input.body);
    if (bytes.byteLength !== input.size) throw new Error("size mismatch");
    const valid: BlobMetadata = {
      key,
      size: input.size,
      contentType: input.contentType,
      sha256: input.sha256,
      etag: input.sha256,
      lastModified: NOW,
    };
    const metadata: BlobMetadata = this.metadataMismatch === "key"
      ? { ...valid, key: `${key}.wrong` }
      : this.metadataMismatch === "size"
        ? { ...valid, size: valid.size + 1 }
        : this.metadataMismatch === "contentType"
          ? { ...valid, contentType: "application/octet-stream" }
        : this.metadataMismatch === "sha256"
          ? { ...valid, sha256: "f".repeat(64) }
          : valid;
    this.objects.set(key, { bytes, metadata: valid });
    return metadata;
  }

  async get(key: string): Promise<BlobRead | null> {
    const object = this.objects.get(key);
    return object ? { metadata: object.metadata, body: bytesToStream(object.bytes) } : null;
  }

  async head(key: string): Promise<BlobMetadata | null> {
    return this.objects.get(key)?.metadata ?? null;
  }

  async delete(key: string | readonly string[]): Promise<void> {
    for (const item of typeof key === "string" ? [key] : key) this.objects.delete(item);
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("audit archive", () => {
  it("archives a bounded oldest batch, verifies the object, then removes exactly those hot rows", async () => {
    const harness = setup(105, true);
    await expect(harness.store.inspectBacklog(CUTOFF)).resolves.toEqual({
      status: "known",
      pendingCount: 105,
      countPrecision: "exact",
      oldestPendingAt: "2026-06-01T00:00:00.000Z",
    });
    const result = await archive(harness.service, CUTOFF, NOW);

    expect(result.archived).toBe(100);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(7);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'ready'")).toBe(1);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_archive_items")).toBe(0);
    const object = [...harness.blobs.objects.values()][0]!;
    expect(new TextDecoder().decode(object.bytes).trim().split("\n")).toHaveLength(100);
    expect(() => harness.database.prepare("DELETE FROM audit_log WHERE id = 'audit-100'").run())
      .toThrow(/only be deleted after archive finalization/i);
    expect(() => harness.database.prepare("UPDATE audit_archives SET month = '2026-07' WHERE status = 'ready'").run())
      .toThrow(/ready audit archives are immutable/i);
    expect(() => harness.database.prepare("DELETE FROM audit_archives WHERE status = 'ready'").run())
      .toThrow(/ready audit archives cannot be deleted/i);

    expect(await archive(harness.service, CUTOFF, "2026-08-09T12:01:00.000Z"))
      .toMatchObject({ archived: 5 });
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(3);
    expect(scalar(harness.database, `SELECT COUNT(*) FROM audit_log
      WHERE actor_id = 'system:scheduler' AND subject_type = 'audit_archive_export'`)).toBe(2);
  });

  it("leaves hot rows intact across blob and finalize failures and resumes the same pending claim", async () => {
    const harness = setup(3, false);
    harness.blobs.failPuts = 1;
    await expect(archive(harness.service, CUTOFF, NOW)).rejects.toThrow(/injected blob failure/);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(3);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'pending'")).toBe(1);

    await expect(archive(harness.service, CUTOFF, "2026-08-09T12:11:00.000Z"))
      .resolves.toMatchObject({ archived: 3 });
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(1);

    const second = setup(2, false);
    second.database.exec(`CREATE TRIGGER injected_finalize_delete_failure
      BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'injected finalize delete failure'); END;`);
    await expect(archive(second.service, CUTOFF, NOW)).rejects.toThrow(/injected finalize delete failure/);
    expect(scalar(second.database, "SELECT COUNT(*) FROM audit_log")).toBe(2);
    expect(scalar(second.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'pending'")).toBe(1);
    expect(scalar(second.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'ready'")).toBe(0);
    expect(second.blobs.objects.size).toBe(1);
    const originalBytes = new TextDecoder().decode([...second.blobs.objects.values()][0]!.bytes);
    second.database.prepare("UPDATE users SET display_name = 'Renamed Admin' WHERE id = 'admin-1'").run();
    second.database.exec("DROP TRIGGER injected_finalize_delete_failure");
    await expect(archive(second.service, CUTOFF, "2026-08-09T12:11:00.000Z"))
      .resolves.toMatchObject({ archived: 2 });
    expect(new TextDecoder().decode([...second.blobs.objects.values()][0]!.bytes)).toBe(originalBytes);
    expect(originalBytes).toContain('"label":"Admin"');
    expect(originalBytes).not.toContain("Renamed Admin");
    expect(scalar(second.database, "SELECT COUNT(*) FROM audit_log")).toBe(1);
  });

  it("allows only one concurrent worker to own the pending batch", async () => {
    const harness = setup(20, false);
    const results = await Promise.all([
      archive(harness.service, CUTOFF, NOW),
      archive(harness.service, CUTOFF, NOW),
    ]);

    expect(results.map((result) => result.archived).sort((a, b) => a - b)).toEqual([0, 20]);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'ready'")).toBe(1);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(1);
  });

  it.each(["key", "size", "contentType", "sha256"] as const)(
    "rejects mismatched blob %s without deleting hot rows and resumes after the lease",
    async (mismatch) => {
    const harness = setup(2, false);
    harness.blobs.metadataMismatch = mismatch;
    await expect(archive(harness.service, CUTOFF, NOW)).rejects.toThrow(/verification failed/i);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(2);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'pending'")).toBe(1);

    harness.blobs.metadataMismatch = null;
    await expect(archive(harness.service, CUTOFF, "2026-08-09T12:11:00.000Z"))
      .resolves.toMatchObject({ archived: 2 });
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(1);
    },
  );

  it("rolls back archive finalization and hot-row deletion when its scheduler audit fails", async () => {
    const harness = setup(2, false);
    harness.database.exec(`CREATE TRIGGER reject_archive_scheduler_audit
      BEFORE INSERT ON audit_log WHEN NEW.actor_id = 'system:scheduler'
      BEGIN SELECT RAISE(ABORT, 'archive audit rejected'); END;`);

    await expect(archive(harness.service, CUTOFF, NOW)).rejects.toThrow("archive audit rejected");
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_log")).toBe(2);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'ready'")).toBe(0);
    expect(scalar(harness.database, "SELECT COUNT(*) FROM audit_archives WHERE status = 'pending'")).toBe(1);
  });

  it("uses the production covering indexes for bounded oldest-row claims", () => {
    const harness = setup(3, false);
    const plan = harness.database.prepare(`EXPLAIN QUERY PLAN
      SELECT logs.id
      FROM audit_log AS logs
      WHERE logs.occurred_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM audit_archive_items AS claimed WHERE claimed.audit_id = logs.id
        )
      ORDER BY logs.occurred_at, logs.id
      LIMIT ?`).all(CUTOFF, 100) as Array<Record<string, unknown>>;
    const details = plan.map((row) => String(row.detail ?? ""));
    expect(details.some((detail) => detail.includes("idx_audit_log_occurred"))).toBe(true);
    expect(details.some((detail) => detail.includes("ux_audit_archive_items_audit"))).toBe(true);
    expect(details.some((detail) => detail.includes("USE TEMP B-TREE"))).toBe(false);
  });
});

function archive(service: AuditArchiveService, before: string, now: string) {
  return service.archiveBatch(before, now, (archiveId, rowCount) => createSchedulerAuditFactory(
    `audit-archive-${now}`,
    now,
  )({
    subjectType: "audit_archive_export",
    subjectId: archiveId,
    action: "archive",
    context: [{ field: "row_count", value: { type: "number", value: rowCount } }],
  }));
}

function setup(oldRows: number, addRecent: boolean) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL);
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_label TEXT,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      subject_label TEXT,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX idx_audit_log_occurred ON audit_log(occurred_at, id);
    CREATE TABLE audit_archives (
      id TEXT PRIMARY KEY,
      month TEXT NOT NULL,
      status TEXT NOT NULL,
      object_key TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT,
      size_bytes INTEGER,
      sha256 TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE UNIQUE INDEX ux_audit_archives_object_key ON audit_archives(object_key);
    CREATE UNIQUE INDEX ux_audit_archives_one_pending ON audit_archives(status) WHERE status = 'pending';
    CREATE INDEX idx_audit_archives_month_ready ON audit_archives(month, status, created_at, id);
    CREATE TABLE audit_archive_items (
      archive_id TEXT NOT NULL REFERENCES audit_archives(id) ON DELETE CASCADE,
      audit_id TEXT NOT NULL REFERENCES audit_log(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY(archive_id, audit_id),
      UNIQUE(archive_id, position)
    );
    CREATE UNIQUE INDEX ux_audit_archive_items_audit ON audit_archive_items(audit_id);
    CREATE UNIQUE INDEX ux_audit_archive_items_position ON audit_archive_items(archive_id, position);
    CREATE TABLE system_test_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE system_test_artifacts (
      run_id TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_key TEXT NOT NULL
    );
  `);
  database.exec(readFileSync(fileURLToPath(new URL("../schema/audit-invariants.sql", import.meta.url)), "utf8"));
  database.prepare("INSERT INTO users (id, display_name) VALUES ('admin-1', 'Admin')").run();
  const insert = database.prepare(`INSERT INTO audit_log (
    id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
    subject_label, action, payload_json, occurred_at
  ) VALUES (?, ?, 'user', 'admin-1', 'Admin', 'member_profile', ?, ?, 'update',
    '{"schema_version":2,"changes":[],"context":[]}', ?)`);
  for (let index = 0; index < oldRows; index += 1) {
    insert.run(
      `audit-${String(index).padStart(3, "0")}`,
      `request-${index}`,
      `member-${index}`,
      `summary-${index}`,
      new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 1_000).toISOString(),
    );
  }
  if (addRecent) {
    insert.run("audit-recent", "request-recent", "member-recent", "recent", "2026-08-01T00:00:00.000Z");
  }
  const base = new SqliteTestExecutor(database);
  const blobs = new MemoryBlobs();
  const store = new SqliteAuditArchiveStore(base);
  return {
    database,
    blobs,
    store,
    service: new AuditArchiveService(store, blobs),
  };
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, unknown>;
  const value = Object.values(row)[0];
  if (typeof value !== "number") throw new TypeError("Expected numeric scalar");
  return value;
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
