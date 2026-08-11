import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { BlobStore } from "@guild/kernel";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { SystemTestService } from "@guild/server/modules/system-test";
import { SYSTEM_TEST_ARTIFACT_TYPES } from "@guild/shared/schemas/system-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SqlBatchStatement,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "@guild/kernel";
import { SqliteSystemTestArtifactCleaner } from "./system-test-artifact-cleaner.js";
import { SqliteSystemTestStore } from "./system-test-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const SYSTEM_TEST_TRIGGERS = readFileSync(
  fileURLToPath(new URL("../schema/system-test.invariants.sql", import.meta.url)),
  "utf8",
);
const databases: DatabaseSync[] = [];

class TestExecutor implements SqlExecutor {
  constructor(readonly database: DatabaseSync) {}
  async execute(statement: SqlStatement): Promise<SqlResult> { return this.run(statement); }
  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.run(statement));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  private run(statement: SqlStatement): SqlResult {
    const prepared = this.database.prepare(statement.sql);
    const params = [...(statement.params ?? [])] as SQLInputValue[];
    if (statement.method === "run") {
      const result = prepared.run(...params);
      return { rows: [], lastInsertRowId: result.lastInsertRowid };
    }
    prepared.setReturnArrays(true);
    if (statement.method === "get") return { rows: prepared.get(...params) as unknown as SqlRow | undefined };
    return { rows: prepared.all(...params) as unknown as readonly SqlRow[] };
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(SCHEMA);
  database.exec(SYSTEM_TEST_TRIGGERS);
  database.exec(`CREATE TRIGGER audit_log_system_test_delete
    BEFORE DELETE ON audit_log
    WHEN NOT EXISTS (
      SELECT 1 FROM system_test_artifacts AS artifacts
      JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
      WHERE artifacts.artifact_type = 'audit_log'
        AND artifacts.artifact_key = OLD.id
        AND runs.status = 'cleaning'
    )
    BEGIN SELECT RAISE(ABORT, 'audit immutable'); END;`);
  database.prepare("INSERT INTO users (id, username) VALUES ('admin-1', 'admin'), ('admin-2', 'other')").run();
  const executor = new TestExecutor(database);
  const store = new SqliteSystemTestStore(executor);
  const artifacts = new SqliteSystemTestArtifactCleaner(executor);
  const deleteBlobs = vi.fn();
  const service = new SystemTestService(store, artifacts, { delete: deleteBlobs } as unknown as BlobStore);
  return { database, executor, store, artifacts, service, deleteBlobs };
}

function context(userId = "admin-1", requestId: string = crypto.randomUUID()) {
  return createRequestContext({
    requestId,
    authorization: createAuthorizationContext({
      userId,
      sessionId: `session-${userId}`,
      roleId: "admin",
      roleLevel: 1,
      permissions: ["admin.status.view"],
    }),
    now: NOW,
  });
}

describe("SqliteSystemTestStore", () => {
  it("observes expired-run backlog with one bounded indexed read", async () => {
    const { store } = harness();
    await store.createRun({
      id: "run-expired",
      actorUserId: "admin-1",
      createdAt: "2026-08-07T12:00:00.000Z",
      expiresAt: "2026-08-08T12:00:00.000Z",
    });

    await expect(store.inspectExpiredBacklog(NOW)).resolves.toEqual({
      status: "known",
      pendingCount: 1,
      countPrecision: "exact",
      oldestPendingAt: "2026-08-08T12:00:00.000Z",
    });
  });

  it("registers exact domain and audit IDs from the active request in the mutation transaction", async () => {
    const { database, executor, service } = harness();
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);

    await executor.batch([
      { method: "run", sql: "INSERT INTO wiki_categories (id, name) VALUES ('category-test', 'Test')" },
      {
        method: "run",
        sql: "INSERT INTO error_log (id, request_id, created_at) VALUES ('error-test', 'request-run', ?)",
        params: [NOW],
      },
      {
        method: "run",
        sql: `INSERT INTO audit_log
          (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
          VALUES ('audit-test', 'request-run', 'admin-1', 'wiki_category', 'category-test', 'create', ?)`,
        params: [NOW],
      },
    ]);

    expect(database.prepare("SELECT artifact_type, artifact_key FROM system_test_artifacts ORDER BY artifact_type").all())
      .toEqual([
        { artifact_type: "audit_log", artifact_key: "audit-test" },
        { artifact_type: "error_log", artifact_key: "error-test" },
        { artifact_type: "wiki_category", artifact_key: "category-test" },
      ]);
  });

  it("maps every direct create audit to its exact cleanup root", async () => {
    const { database, service } = harness();
    const owner = context("admin-1", "request-map-all");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);
    const cases = [
      ["user", "create", "user-created", "user"],
      ["invite_link", "create", "invite-created", "invite_link"],
      ["role", "create", "role-created", "role"],
      ["event", "create", "event-created", "event"],
      ["recurring_template", "create", "template-created", "recurring_template"],
      ["announcement", "create", "announcement-created", "announcement"],
      ["gallery_item", "create_video", "gallery-created", "gallery_item"],
      ["guild_war_history", "conclude", "war-created", "guild_war"],
      ["wiki_category", "create", "wiki-category-created", "wiki_category"],
      ["wiki_article", "create", "wiki-created", "wiki_article"],
      ["member_badge", "create", "badge-created", "badge"],
      ["storage", "create", "storage-created", "storage"],
      ["storage_category", "create", "storage-category-created", "storage_category"],
      ["storage_item", "create", "item-created", "storage_item"],
      ["storage_transaction", "intake", "batch-created", "storage_batch"],
      ["media_asset", "upload", "media-created", "media_asset"],
      ["class_catalog", "create", "class-created", "class_catalog"],
      ["class_tag", "create", "tag-created", "class_tag"],
      ["member_absence", "create", "absence-created", "member_absence"],
    ] as const;
    const insert = database.prepare(`INSERT INTO audit_log
      (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
      VALUES (?, ?, 'admin-1', ?, ?, ?, ?)`);
    cases.forEach(([entityType, action, entityId], index) => {
      insert.run(`audit-map-${index}`, owner.requestId, entityType, entityId, action, NOW);
    });

    const actual = database.prepare(`SELECT artifact_type, artifact_key
      FROM system_test_artifacts
      WHERE run_id = ? AND artifact_type <> 'audit_log'
      ORDER BY artifact_type, artifact_key`).all(runId);
    const expected = cases
      .map(([, , key, type]) => ({ artifact_type: type, artifact_key: key }))
      .sort((left, right) => (
        left.artifact_type.localeCompare(right.artifact_type)
        || left.artifact_key.localeCompare(right.artifact_key)
      ));
    expect(actual).toEqual(expected);
  });

  it("resolves multi-row gallery and active-war audit targets to exact stored IDs", async () => {
    const { database, executor, service } = harness();
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);

    await executor.batch([
      { method: "run", sql: "INSERT INTO gallery_items (id) VALUES ('gallery-a'), ('gallery-b')" },
      {
        method: "run",
        sql: `INSERT INTO audit_log
          (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
          VALUES ('audit-gallery', 'request-run', 'admin-1', 'gallery_item', 'gallery-a,gallery-b', 'upload_images', ?)`,
        params: [NOW],
      },
      { method: "run", sql: "INSERT INTO guild_wars (id, event_id) VALUES ('war-exact', 'event-public')" },
      {
        method: "run",
        sql: `INSERT INTO audit_log
          (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
          VALUES ('audit-war', 'request-run', 'admin-1', 'guild_war', 'event-public', 'init', ?)`,
        params: [NOW],
      },
    ]);

    expect(database.prepare(`SELECT artifact_type, artifact_key FROM system_test_artifacts
      WHERE artifact_type <> 'audit_log' ORDER BY artifact_type, artifact_key`).all()).toEqual([
      { artifact_type: "gallery_item", artifact_key: "gallery-a" },
      { artifact_type: "gallery_item", artifact_key: "gallery-b" },
      { artifact_type: "guild_war", artifact_key: "war-exact" },
    ]);
  });

  it("deletes every registered artifact type and only the rows owned by that run", async () => {
    const { database, service, deleteBlobs } = harness();
    const owner = context("admin-1", "request-clean-all");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);

    database.exec(`
      INSERT INTO users (id, username) VALUES ('user-created', 'created');
      INSERT INTO roles (id) VALUES ('role-created');
      INSERT INTO events (id) VALUES ('event-created');
      INSERT INTO recurring_templates (id) VALUES ('template-created');
      INSERT INTO storage_batches (id) VALUES ('batch-created');
      INSERT INTO storage_items (id) VALUES ('item-created');
      INSERT INTO storage_categories (id) VALUES ('storage-category-created');
      INSERT INTO storages (id) VALUES ('storage-created');
      INSERT INTO storage_ledger_entries (id, batch_id, item_id)
        VALUES ('ledger-created', 'batch-created', 'item-created');
      INSERT INTO wiki_categories (id, name) VALUES ('wiki-category-created', 'Created');
      INSERT INTO wiki_articles (id) VALUES ('wiki-created');
      INSERT INTO wiki_revisions (id, article_id) VALUES ('revision-created', 'wiki-created');
      INSERT INTO wiki_revision_media (revision_id) VALUES ('revision-created');
      INSERT INTO announcements (id) VALUES ('announcement-created');
      INSERT INTO gallery_items (id) VALUES ('gallery-created');
      INSERT INTO guild_wars (id, event_id) VALUES ('war-created', 'event-created');
      INSERT INTO member_badges (id, sort_order, updated_at) VALUES ('badge-created', 0, '${NOW}');
      INSERT INTO invite_links (id) VALUES ('invite-created');
      INSERT INTO member_absences (id) VALUES ('absence-created');
      INSERT INTO class_tags (id, sort_order, owner_kind, updated_at)
        VALUES ('tag-created', 0, NULL, '${NOW}');
      INSERT INTO class_catalog (id, sort_order, updated_at)
        VALUES ('class-created', 0, '${NOW}');
      INSERT INTO media_assets (id) VALUES ('media-created');
      INSERT INTO media_variants (media_id, variant, object_key)
        VALUES ('media-created', 'full', 'media/media-created/full.webp');
      INSERT INTO media_links (media_id, entity_type, entity_id) VALUES
        ('media-created', 'event', 'event-created'),
        ('media-created', 'recurring_template', 'template-created'),
        ('media-created', 'storage_item', 'item-created'),
        ('media-created', 'wiki_article', 'wiki-created'),
        ('media-created', 'announcement', 'announcement-created'),
        ('media-created', 'gallery_item', 'gallery-created');
    `);

    const artifacts = [
      ["guild_war", "war-created"],
      ["event", "event-created"],
      ["recurring_template", "template-created"],
      ["storage_batch", "batch-created"],
      ["storage_item", "item-created"],
      ["storage_category", "storage-category-created"],
      ["storage", "storage-created"],
      ["wiki_article", "wiki-created"],
      ["wiki_category", "wiki-category-created"],
      ["announcement", "announcement-created"],
      ["gallery_item", "gallery-created"],
      ["badge", "badge-created"],
      ["invite_link", "invite-created"],
      ["member_absence", "absence-created"],
      ["user", "user-created"],
      ["role", "role-created"],
      ["class_tag", "tag-created"],
      ["class_catalog", "class-created"],
      ["media_asset", "media-created"],
    ] as const;
    expect([...artifacts.map(([type]) => type), "audit_log", "error_log"].sort())
      .toEqual([...SYSTEM_TEST_ARTIFACT_TYPES].sort());
    const register = database.prepare(`INSERT INTO system_test_artifacts
      (run_id, artifact_type, artifact_key, request_id, created_at)
      VALUES (?, ?, ?, ?, ?)`);
    for (const [type, key] of artifacts) register.run(runId, type, key, owner.requestId, NOW);
    database.prepare(`INSERT INTO audit_log
      (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
      VALUES ('audit-created', ?, 'admin-1', 'system_test_probe', 'probe', 'probe', ?)`)
      .run(owner.requestId, NOW);
    database.prepare("INSERT INTO error_log (id, request_id, created_at) VALUES ('error-created', ?, ?)")
      .run(owner.requestId, NOW);

    await service.endRequest(owner.requestId);
    expect(await service.cleanupRun(owner, runId)).toEqual({ ok: true, status: "completed", attempts: 1 });
    await service.finalizeRun(owner, runId);

    expect(deleteBlobs).toHaveBeenCalledOnce();
    expect(deleteBlobs).toHaveBeenCalledWith(["media/media-created/full.webp"]);
    expect(database.prepare("SELECT id FROM users ORDER BY id").all()).toEqual([
      { id: "admin-1" },
      { id: "admin-2" },
    ]);
    for (const table of [
      "roles", "events", "recurring_templates", "storage_batches", "storage_items",
      "storage_categories", "storages", "storage_ledger_entries", "wiki_articles",
      "wiki_revisions", "wiki_revision_media", "wiki_categories", "announcements",
      "gallery_items", "guild_wars", "member_badges", "invite_links", "member_absences",
      "class_tags", "class_catalog", "media_assets", "media_variants", "media_links",
      "audit_log", "error_log", "system_test_before_images", "system_test_artifacts",
      "system_test_requests", "system_test_runs",
    ]) {
      expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get(), table)
        .toEqual({ count: 0 });
    }
  });

  it("does not register a forged request_id and rolls registry rows back with a failed mutation", async () => {
    const { database, executor, service } = harness();
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);

    database.prepare(`INSERT INTO audit_log
      (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
      VALUES ('audit-forged', 'forged-request', 'admin-1', 'wiki_category', 'forged', 'create', ?)`).run(NOW);
    expect(database.prepare("SELECT count(*) AS count FROM system_test_artifacts WHERE artifact_key = 'forged'").get())
      .toMatchObject({ count: 0 });

    await expect(executor.batch([
      { method: "run", sql: "INSERT INTO wiki_categories (id, name) VALUES ('rolled-back', 'Rollback')" },
      {
        method: "run",
        sql: `INSERT INTO audit_log
          (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
          VALUES ('audit-rollback', 'request-run', 'admin-1', 'wiki_category', 'rolled-back', 'create', ?)`,
        params: [NOW],
      },
      { method: "run", sql: "INSERT INTO wiki_categories (id, name) VALUES ('rolled-back', 'Duplicate')" },
    ])).rejects.toThrow();
    expect(database.prepare("SELECT count(*) AS count FROM wiki_categories WHERE id = 'rolled-back'").get())
      .toMatchObject({ count: 0 });
    expect(database.prepare("SELECT count(*) AS count FROM system_test_artifacts WHERE artifact_key = 'rolled-back'").get())
      .toMatchObject({ count: 0 });
  });

  it("rejects cleanup while active, binds the run actor, then cleans and finalizes with zero residue", async () => {
    const { database, executor, service } = harness();
    database.prepare("INSERT INTO wiki_categories (id, name) VALUES ('category-existing', '[systemtest] existing')").run();
    const before = {
      users: database.prepare("SELECT count(*) AS count FROM users").get(),
      categories: database.prepare("SELECT count(*) AS count FROM wiki_categories").get(),
      audits: database.prepare("SELECT count(*) AS count FROM audit_log").get(),
      errors: database.prepare("SELECT count(*) AS count FROM error_log").get(),
    };
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);
    await executor.batch([
      { method: "run", sql: "INSERT INTO wiki_categories (id, name) VALUES ('category-test', 'Test')" },
      {
        method: "run",
        sql: "INSERT INTO error_log (id, request_id, created_at) VALUES ('error-test', 'request-run', ?)",
        params: [NOW],
      },
      {
        method: "run",
        sql: `INSERT INTO audit_log
          (id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at)
          VALUES ('audit-test', 'request-run', 'admin-1', 'wiki_category', 'category-test', 'create', ?)`,
        params: [NOW],
      },
    ]);

    await expect(service.cleanupRun(context("admin-2"), runId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await service.cleanupRun(owner, runId)).toMatchObject({ ok: false, status: "running" });
    await service.endRequest(owner.requestId);
    expect(await service.cleanupRun(owner, runId)).toMatchObject({ ok: true, status: "completed" });
    expect(await service.cleanupRun(owner, runId)).toMatchObject({ ok: true, status: "completed" });
    await service.finalizeRun(owner, runId);

    expect(database.prepare("SELECT count(*) AS count FROM users").get()).toEqual(before.users);
    expect(database.prepare("SELECT count(*) AS count FROM wiki_categories").get()).toEqual(before.categories);
    expect(database.prepare("SELECT count(*) AS count FROM audit_log").get()).toEqual(before.audits);
    expect(database.prepare("SELECT count(*) AS count FROM error_log").get()).toEqual(before.errors);
    expect(database.prepare("SELECT id FROM wiki_categories").all()).toEqual([{ id: "category-existing" }]);
    for (const table of ["system_test_before_images", "system_test_artifacts", "system_test_requests", "system_test_runs"]) {
      expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get(), table).toMatchObject({ count: 0 });
    }
  });

  it("restores bounded class, tag, and badge before-images with compare-and-swap", async () => {
    const { database, service } = harness();
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);
    const beforeAt = "2026-08-08T12:00:00.000Z";
    const insertClass = database.prepare(
      "INSERT INTO class_catalog (id, sort_order, updated_at) VALUES (?, ?, ?)",
    );
    const insertImage = database.prepare(`INSERT INTO system_test_before_images (
      run_id, target_type, target_id, before_sort_order, before_updated_at,
      expected_sort_order, expected_updated_at, request_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 0; index < 49; index += 1) {
      const id = `class-${index}`;
      insertClass.run(id, 100 + index, beforeAt);
      insertImage.run(runId, "class_catalog", id, 100 + index, beforeAt, index, NOW, owner.requestId, NOW);
      database.prepare("UPDATE class_catalog SET sort_order = ?, updated_at = ? WHERE id = ?").run(index, NOW, id);
    }
    database.prepare("INSERT INTO class_tags (id, sort_order, owner_kind, updated_at) VALUES ('tag-1', 200, NULL, ?)").run(beforeAt);
    insertImage.run(runId, "class_tag", "tag-1", 200, beforeAt, 0, NOW, owner.requestId, NOW);
    database.prepare("UPDATE class_tags SET sort_order = 0, updated_at = ? WHERE id = 'tag-1'").run(NOW);
    database.prepare("INSERT INTO member_badges (id, sort_order, updated_at) VALUES ('badge-1', 300, ?)").run(beforeAt);
    insertImage.run(runId, "badge", "badge-1", 300, beforeAt, 0, NOW, owner.requestId, NOW);
    database.prepare("UPDATE member_badges SET sort_order = 0, updated_at = ? WHERE id = 'badge-1'").run(NOW);
    await service.endRequest(owner.requestId);

    expect(await service.cleanupRun(owner, runId)).toEqual({ ok: false, status: "cleaning", attempts: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM system_test_before_images").get()).toMatchObject({ count: 1 });
    expect(await service.cleanupRun(owner, runId)).toEqual({ ok: true, status: "completed", attempts: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM class_catalog WHERE sort_order >= 100 AND updated_at = ?").get(beforeAt))
      .toMatchObject({ count: 49 });
    expect(database.prepare("SELECT sort_order, updated_at FROM class_tags WHERE id = 'tag-1'").get())
      .toEqual({ sort_order: 200, updated_at: beforeAt });
    expect(database.prepare("SELECT sort_order, updated_at FROM member_badges WHERE id = 'badge-1'").get())
      .toEqual({ sort_order: 300, updated_at: beforeAt });
  });

  it("fails cleanup explicitly when a before-image target has drifted", async () => {
    const { database, service } = harness();
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);
    const beforeAt = "2026-08-08T12:00:00.000Z";
    database.prepare("INSERT INTO class_catalog (id, sort_order, updated_at) VALUES ('class-1', 30, ?)").run(beforeAt);
    database.prepare(`INSERT INTO system_test_before_images (
      run_id, target_type, target_id, before_sort_order, before_updated_at,
      expected_sort_order, expected_updated_at, request_id, created_at
    ) VALUES (?, 'class_catalog', 'class-1', 30, ?, 0, ?, ?, ?)`)
      .run(runId, beforeAt, NOW, owner.requestId, NOW);
    database.prepare("UPDATE class_catalog SET sort_order = 0, updated_at = ? WHERE id = 'class-1'").run(NOW);
    await service.endRequest(owner.requestId);
    database.prepare("UPDATE class_catalog SET sort_order = 99, updated_at = '2026-08-10T00:00:00.000Z' WHERE id = 'class-1'").run();

    expect(await service.cleanupRun(owner, runId)).toEqual({ ok: false, status: "cleanup_failed", attempts: 1 });
    expect(database.prepare("SELECT sort_order FROM class_catalog WHERE id = 'class-1'").get()).toEqual({ sort_order: 99 });
    expect(database.prepare("SELECT count(*) AS count FROM system_test_before_images WHERE run_id = ?").get(runId))
      .toMatchObject({ count: 1 });
    expect(database.prepare("SELECT last_error FROM system_test_runs WHERE id = ?").get(runId))
      .toMatchObject({ last_error: expect.stringContaining("before-image conflict") });
  });

  it("finalizes a cleaned full run with one summary audit and no run registry residue", async () => {
    const { database, service } = harness();
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    expect(await service.cleanupRun(owner, runId)).toEqual({ ok: true, status: "completed", attempts: 1 });
    await service.finalizeRun(owner, runId, { total: 1, passed: 1, failed: 0, errors: [] });

    expect(database.prepare("SELECT entity_type, action, detail_json FROM audit_log").get()).toEqual({
      entity_type: "system_test",
      action: "run",
      detail_json: JSON.stringify({ total: 1, passed: 1, failed: 0, errors: [] }),
    });
    for (const table of ["system_test_before_images", "system_test_artifacts", "system_test_requests", "system_test_runs"]) {
      expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get(), table).toMatchObject({ count: 0 });
    }
  });

  it("continues bounded cleanup pages without incrementing the same attempt", async () => {
    const { database, executor, service } = harness();
    const owner = context("admin-1", "request-run");
    const { runId } = await service.createRun(owner);
    await service.beginRequest(owner, runId);
    const statements: SqlBatchStatement[] = [];
    for (let index = 0; index < 51; index += 1) {
      const id = `category-${index}`;
      statements.push({ method: "run", sql: "INSERT INTO wiki_categories (id, name) VALUES (?, ?)", params: [id, id] });
      statements.push({
        method: "run",
        sql: `INSERT INTO system_test_artifacts
          (run_id, artifact_type, artifact_key, request_id, created_at)
          VALUES (?, 'wiki_category', ?, ?, ?)`,
        params: [runId, id, owner.requestId, NOW],
      });
    }
    await executor.batch(statements);
    await service.endRequest(owner.requestId);

    expect(await service.cleanupRun(owner, runId)).toEqual({ ok: false, status: "cleaning", attempts: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM wiki_categories").get()).toMatchObject({ count: 1 });
    expect(await service.cleanupRun(owner, runId)).toEqual({ ok: true, status: "completed", attempts: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM wiki_categories").get()).toMatchObject({ count: 0 });
  });

  it("bounds expired-run discovery", async () => {
    const { database, store } = harness();
    const insert = database.prepare(`INSERT INTO system_test_runs
      (id, actor_user_id, status, cleanup_attempts, expires_at, created_at, updated_at)
      VALUES (?, 'admin-1', 'running', 0, ?, ?, ?)`);
    for (let index = 0; index < 60; index += 1) {
      insert.run(`run-${index}`, "2026-08-08T00:00:00.000Z", "2026-08-07T00:00:00.000Z", "2026-08-07T00:00:00.000Z");
    }
    expect(await store.listExpiredRunIds(NOW, 50)).toHaveLength(50);
  });
});

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, actor_username TEXT,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    summary TEXT, detail_json TEXT, occurred_at TEXT NOT NULL
  );
  CREATE TABLE error_log (id TEXT PRIMARY KEY, request_id TEXT, created_at TEXT NOT NULL);
  CREATE TABLE wiki_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE roles (id TEXT PRIMARY KEY);
  CREATE TABLE events (id TEXT PRIMARY KEY);
  CREATE TABLE recurring_templates (id TEXT PRIMARY KEY);
  CREATE TABLE storage_batches (id TEXT PRIMARY KEY);
  CREATE TABLE storage_items (id TEXT PRIMARY KEY);
  CREATE TABLE storage_categories (id TEXT PRIMARY KEY);
  CREATE TABLE storages (id TEXT PRIMARY KEY);
  CREATE TABLE storage_ledger_entries (id TEXT PRIMARY KEY, batch_id TEXT, item_id TEXT);
  CREATE TABLE wiki_articles (id TEXT PRIMARY KEY);
  CREATE TABLE wiki_revisions (id TEXT PRIMARY KEY, article_id TEXT NOT NULL);
  CREATE TABLE wiki_revision_media (revision_id TEXT NOT NULL);
  CREATE TABLE announcements (id TEXT PRIMARY KEY);
  CREATE TABLE gallery_items (id TEXT PRIMARY KEY);
  CREATE TABLE guild_wars (id TEXT PRIMARY KEY, event_id TEXT UNIQUE);
  CREATE TABLE invite_links (id TEXT PRIMARY KEY);
  CREATE TABLE member_absences (id TEXT PRIMARY KEY);
  CREATE TABLE class_catalog (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE class_tags (
    id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, owner_kind TEXT, updated_at TEXT NOT NULL
  );
  CREATE TABLE member_badges (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE media_assets (id TEXT PRIMARY KEY);
  CREATE TABLE media_variants (
    media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    variant TEXT NOT NULL,
    object_key TEXT NOT NULL
  );
  CREATE TABLE media_links (media_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL);
  CREATE TABLE system_test_runs (
    id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'running', cleanup_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, completed_at TEXT,
    CHECK(status IN ('running', 'cleaning', 'cleanup_failed', 'completed')),
    CHECK((status = 'completed' AND completed_at IS NOT NULL) OR (status <> 'completed' AND completed_at IS NULL))
  );
  CREATE TABLE system_test_requests (
    request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES system_test_runs(id) ON DELETE CASCADE,
    actor_user_id TEXT REFERENCES users(id), started_at TEXT NOT NULL
  );
  CREATE TABLE system_test_artifacts (
    run_id TEXT NOT NULL REFERENCES system_test_runs(id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL, artifact_key TEXT NOT NULL, request_id TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(run_id, artifact_type, artifact_key)
  );
  CREATE TABLE system_test_before_images (
    run_id TEXT NOT NULL REFERENCES system_test_runs(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK(target_type IN ('class_catalog', 'class_tag', 'badge')),
    target_id TEXT NOT NULL, before_sort_order INTEGER NOT NULL, before_updated_at TEXT NOT NULL,
    expected_sort_order INTEGER NOT NULL, expected_updated_at TEXT NOT NULL,
    request_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(run_id, target_type, target_id)
  );
`;
