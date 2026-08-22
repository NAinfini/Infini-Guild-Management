import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAdminOperationsStore } from "./admin-operations-store.js";

const databases: DatabaseSync[] = [];
const NOW = "2026-08-12T12:00:00.000Z";

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  const store = new SqliteAdminOperationsStore(new SqliteTestExecutor(database));
  return { database, store };
}

describe("SqliteAdminOperationsStore", () => {
  it("keeps one latest row per job and reports active leases plus bounded metadata usage", async () => {
    const { database, store } = harness();
    await store.recordRunning({ name: "media-gc", startedAt: "2026-08-12T11:59:59.000Z" });
    await store.recordOutcome({
      startedAt: "2026-08-12T11:59:59.000Z",
      finishedAt: NOW,
      durationMs: 1_000,
      outcome: {
        name: "media-gc",
        status: "completed",
        processed: 3,
        batches: 1,
        hasMore: false,
        backlog: {
          status: "known",
          countPrecision: "exact",
          pendingCount: 0,
          oldestPendingAt: null,
        },
      },
    });
    database.prepare(`INSERT INTO scheduled_job_leases
      (job_name, lease_token, acquired_at, expires_at)
      VALUES ('media-gc', 'active-lease-token', '2026-08-12T11:55:00.000Z', '2026-08-12T12:05:00.000Z')`).run();
    seedUsage(database);

    const snapshot = await store.read(NOW);

    expect(snapshot.statuses).toEqual([expect.objectContaining({
      name: "media-gc",
      status: "completed",
      durationMs: 1_000,
      processed: 3,
      batches: 1,
      hasMore: false,
      backlog: { status: "known", countPrecision: "exact", pendingCount: 0, oldestPendingAt: null },
    })]);
    expect(snapshot.leases).toEqual([{
      name: "media-gc",
      acquiredAt: "2026-08-12T11:55:00.000Z",
      expiresAt: "2026-08-12T12:05:00.000Z",
    }]);
    expect(snapshot.usage).toEqual({
      mediaByState: [
        { state: "attached", assetCount: 1, variantCount: 1, logicalBytes: 30 },
        { state: "staged", assetCount: 1, variantCount: 2, logicalBytes: 30 },
        { state: "uploading", assetCount: 1, variantCount: 0, logicalBytes: 0 },
      ],
      auditLogCount: 1,
      auditArchiveCount: 1,
      auditArchiveBytes: 40,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM scheduled_job_statuses WHERE job_name = 'media-gc'").get())
      .toMatchObject({ count: 1 });
  });

  it("persists a bounded failed outcome instead of leaving the job running", async () => {
    const { store } = harness();
    await store.recordRunning({ name: "audit-archive", startedAt: "2026-08-12T11:59:59.000Z" });
    await store.recordOutcome({
      startedAt: "2026-08-12T11:59:59.000Z",
      finishedAt: NOW,
      durationMs: 1_000,
      outcome: {
        name: "audit-archive",
        status: "failed",
        processed: null,
        batches: null,
        hasMore: null,
        backlog: {
          status: "unknown",
          countPrecision: "unknown",
          pendingCount: null,
          oldestPendingAt: null,
          reason: "job-failed",
          detail: "archive unavailable",
        },
        error: "archive unavailable",
      },
    });

    await expect(store.read(NOW)).resolves.toMatchObject({
      statuses: [{ status: "failed", errorSummary: "archive unavailable" }],
    });
  });

  it("does not let a competing lease-held attempt overwrite the active run marker", async () => {
    const { store } = harness();
    await store.recordRunning({ name: "media-gc", startedAt: "2026-08-12T11:58:00.000Z" });
    await store.recordOutcome({
      startedAt: "2026-08-12T11:59:00.000Z",
      finishedAt: NOW,
      durationMs: 1_000,
      outcome: {
        name: "media-gc",
        status: "lease-held",
        processed: 0,
        batches: 0,
        hasMore: true,
        backlog: {
          status: "unknown",
          countPrecision: "unknown",
          pendingCount: null,
          oldestPendingAt: null,
          reason: "lease-held",
        },
      },
    });

    await expect(store.read(NOW)).resolves.toMatchObject({
      statuses: [{
        name: "media-gc",
        status: "running",
        startedAt: "2026-08-12T11:58:00.000Z",
      }],
    });
  });
});

function seedUsage(database: DatabaseSync): void {
  const insertAsset = database.prepare(`INSERT INTO media_assets
    (id, purpose, media_type, state, original_name, expires_at, created_at, updated_at)
    VALUES (?, 'member_avatar', 'image', ?, NULL, ?, ?, ?)`);
  insertAsset.run("uploading_asset_00001", "uploading", "2026-08-13T00:00:00.000Z", NOW, NOW);
  insertAsset.run("staged_asset_00000001", "staged", "2026-08-13T00:00:00.000Z", NOW, NOW);
  insertAsset.run("attached_asset_000001", "attached", null, NOW, NOW);
  const insertVariant = database.prepare(`INSERT INTO media_variants
    (media_id, variant, object_key, content_type, byte_size, sha256, width, height)
    VALUES (?, ?, ?, 'image/webp', ?, ?, 1, 1)`);
  insertVariant.run("staged_asset_00000001", "full", "media/staged-full.webp", 10, "a".repeat(64));
  insertVariant.run("staged_asset_00000001", "view", "media/staged-view.webp", 20, "b".repeat(64));
  insertVariant.run("attached_asset_000001", "full", "media/attached-full.webp", 30, "c".repeat(64));
  database.prepare(`INSERT INTO audit_log
    (id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
     subject_label, action, payload_json, occurred_at)
    VALUES (
      'audit-1', 'request-1', 'system', 'system:scheduler', 'Scheduler',
      'media_cleanup', 'media-1', NULL, 'delete',
      '{"schema_version":2,"changes":[],"context":[]}', ?
    )`).run(NOW);
  database.prepare(`INSERT INTO audit_archives
    (id, month, status, object_key, row_count, starts_at, ends_at, size_bytes, sha256, created_at, completed_at)
    VALUES ('archive-1', '2026-07', 'ready', 'audit/2026/07/archive-1.ndjson', 1, ?, ?, 40, ?, ?, ?)`).run(
      NOW, NOW, "d".repeat(64), NOW, NOW,
    );
}
