import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  assertSqlResultColumns,
  assertSqlStatement,
  type SqlExecutor,
  type SqlResult,
  type SqlStatement,
} from "@guild/kernel";
import { describe, expect, it } from "vitest";
import { SqliteBlobManifestStore } from "./blob-manifest-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const SHA = "a".repeat(64);
const CORE = readFileSync(
  fileURLToPath(new URL("../migrations/generated/0000_core.sql", import.meta.url)),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

describe("SqliteBlobManifestStore", () => {
  it("pages stable media and ready-audit descriptors and resolves inventory keys set-wise", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(CORE);
      insertMedia(database, "abcdefghijklmnopqrstu", "staged");
      insertMedia(database, "vwxyzabcdefghijklmnop", "uploading");
      insertAudit(database, "archive-1", "audit/2026/08/archive-1.ndjson");
      const store = new SqliteBlobManifestStore(new TestExecutor(database));

      const first = await store.listPage({ limit: 1 });
      expect(first.descriptors).toEqual([expect.objectContaining({
        source: "audit",
        objectKey: "audit/2026/08/archive-1.ndjson",
        contentType: "application/x-ndjson; charset=UTF-8",
      })]);
      expect(first.nextCheckpoint).toBe("audit/2026/08/archive-1.ndjson");

      const second = await store.listPage({ checkpoint: first.nextCheckpoint!, limit: 2 });
      expect(second.descriptors).toEqual([expect.objectContaining({
        source: "media",
        objectKey: "media/abcdefghijklmnopqrstu/view.webp",
      })]);
      expect(second.nextCheckpoint).toBeNull();

      await expect(store.findByObjectKeys([
        "media/abcdefghijklmnopqrstu/view.webp",
        "audit/2026/08/archive-1.ndjson",
      ])).resolves.toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("resumes across audit and media phases without gaps or duplicates", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(CORE);
      insertAudit(database, "archive-1", "audit/2026/08/archive-1.ndjson");
      insertAudit(database, "archive-2", "audit/2026/08/archive-2.ndjson");
      insertMedia(database, "abcdefghijklmnopqrstu", "staged");
      insertMedia(database, "bcdefghijklmnopqrstuv", "staged");
      insertMedia(database, "cdefghijklmnopqrstuvw", "staged");

      const first = await new SqliteBlobManifestStore(new TestExecutor(database)).listPage({ limit: 2 });
      const second = await new SqliteBlobManifestStore(new TestExecutor(database)).listPage({
        checkpoint: first.nextCheckpoint!,
        limit: 2,
      });
      const third = await new SqliteBlobManifestStore(new TestExecutor(database)).listPage({
        checkpoint: second.nextCheckpoint!,
        limit: 2,
      });

      const keys = [...first.descriptors, ...second.descriptors, ...third.descriptors]
        .map(({ objectKey }) => objectKey);
      expect(keys).toEqual([
        "audit/2026/08/archive-1.ndjson",
        "audit/2026/08/archive-2.ndjson",
        "media/abcdefghijklmnopqrstu/view.webp",
        "media/bcdefghijklmnopqrstuv/view.webp",
        "media/cdefghijklmnopqrstuvw/view.webp",
      ]);
      expect(new Set(keys).size).toBe(keys.length);
      expect(third.nextCheckpoint).toBeNull();
    } finally {
      database.close();
    }
  });

  it("uses each phase's object-key index without materialization or temporary sorting", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(CORE);
      insertAudit(database, "archive-1", "audit/2026/08/archive-1.ndjson");
      insertMedia(database, "abcdefghijklmnopqrstu", "staged");
      const executor = new TestExecutor(database);
      const store = new SqliteBlobManifestStore(executor);

      await store.listPage({ checkpoint: "audit/2026/07/before.ndjson", limit: 50 });
      await store.listPage({ checkpoint: "media/000000000000000000000/before.webp", limit: 50 });

      const audit = executor.statements.find(({ sql }) => sql.includes("archives.object_key > ?"))!;
      const media = executor.statements.find(({ sql }) => sql.includes("variants.object_key > ?"))!;
      const auditPlan = explain(database, audit);
      const mediaPlan = explain(database, media);
      expect(auditPlan).toMatch(/SEARCH archives USING INDEX ux_audit_archives_object_key/i);
      expect(mediaPlan).toMatch(/SEARCH variants USING INDEX ux_media_variants_object_key/i);
      for (const plan of [auditPlan, mediaPlan]) {
        expect(plan).not.toMatch(/MATERIALIZE|USE TEMP B-TREE|\bSCAN\b/i);
      }
      expect(audit.params?.at(-1)).toBe(51);
    } finally {
      database.close();
    }
  });
});

class TestExecutor implements SqlExecutor {
  readonly statements: SqlStatement[] = [];

  constructor(private readonly database: DatabaseSync) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    assertSqlStatement(statement);
    this.statements.push(statement);
    const prepared = this.database.prepare(statement.sql);
    prepared.setReturnArrays(true);
    assertSqlResultColumns(statement, prepared.columns().map(({ name }) => name));
    const params = [...(statement.params ?? [])] as SQLInputValue[];
    if (statement.method === "run") {
      prepared.run(...params);
      return { rows: [] };
    }
    return {
      rows: statement.method === "get"
        ? prepared.get(...params) as never
        : prepared.all(...params) as never,
    };
  }

  async batch(): Promise<readonly SqlResult[]> {
    throw new Error("Batch is not used by this store");
  }
}

function explain(database: DatabaseSync, statement: SqlStatement): string {
  return (database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
    .all(...[...(statement.params ?? [])] as SQLInputValue[]) as Array<{ detail: string }>)
    .map(({ detail }) => detail)
    .join("\n");
}

function insertAudit(database: DatabaseSync, id: string, objectKey: string): void {
  database.prepare(`INSERT INTO audit_archives (
    id, month, status, object_key, row_count, starts_at, ends_at,
    size_bytes, sha256, created_at, completed_at
  ) VALUES (?, '2026-08', 'ready', ?, 1, ?, ?, 12, ?, ?, ?)`)
    .run(id, objectKey, NOW, NOW, SHA, NOW, NOW);
}

function insertMedia(database: DatabaseSync, id: string, state: "uploading" | "staged"): void {
  database.prepare(`INSERT INTO media_assets (
    id, purpose, media_type, state, expires_at, created_at, updated_at
  ) VALUES (?, 'event_image', 'image', ?, ?, ?, ?)`).run(
    id,
    state,
    "2026-08-10T12:00:00.000Z",
    NOW,
    NOW,
  );
  database.prepare(`INSERT INTO media_variants (
    media_id, variant, object_key, content_type, byte_size, sha256, width, height
  ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`).run(
    id,
    `media/${id}/view.webp`,
    SHA,
  );
}
