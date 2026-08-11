import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_SQL_BATCH_STATEMENTS, assertSqlBatch, createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditMutation } from "@guild/server/modules/audit";
import type { GalleryRecord } from "@guild/server/modules/gallery";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlRow, SqlStatement } from "@guild/kernel";
import { SqliteGalleryStore } from "./gallery-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const OWNER = "owner-1";
const MEDIA_IDS = ["ddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeee"] as const;
const FRESH_MIGRATION = readFileSync(
  fileURLToPath(new URL("../migrations/generated/0000_core.sql", import.meta.url)),
  "utf8",
).replaceAll("--> statement-breakpoint", "");
const databases: DatabaseSync[] = [];

class SerialTestExecutor implements SqlExecutor {
  private tail: Promise<void> = Promise.resolve();
  readonly batches: SqlBatchStatement[][] = [];

  constructor(private readonly database: DatabaseSync) {}

  execute(statement: SqlStatement): Promise<SqlResult> {
    return this.enqueue(() => this.executeNow(statement));
  }

  batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    return this.enqueue(() => {
      assertSqlBatch(statements);
      this.batches.push([...statements]);
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => this.executeNow(statement));
        this.database.exec("COMMIT");
        return results;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    });
  }

  private enqueue<T>(operation: () => T): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private executeNow(statement: SqlStatement): SqlResult {
    const prepared = this.database.prepare(statement.sql);
    prepared.setReturnArrays(true);
    const params = [...(statement.params ?? [])] as SQLInputValue[];
    if (statement.method === "run") {
      prepared.run(...params);
      return { rows: [] };
    }
    if (statement.method === "get") {
      return { rows: prepared.get(...params) as unknown as SqlRow | undefined };
    }
    return { rows: prepared.all(...params) as unknown as readonly SqlRow[] };
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteGalleryStore quota claims", () => {
  it("admits only one competing image batch and leaves the losing blob staged for GC", async () => {
    const { database, store } = fixture();
    for (const mediaId of MEDIA_IDS) insertMedia(database, mediaId);

    const results = await Promise.allSettled(MEDIA_IDS.map((mediaId, index) => store.createImages({
      records: [record(`gallery-${index + 1}`, mediaId)],
      mediaIds: [mediaId],
      ownerUserId: OWNER,
      maxItems: 1,
      audit: audit(`gallery-${index + 1}`),
    })));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "VALIDATION_ERROR", status: 400 },
    });
    expect(number(database, "SELECT COUNT(*) FROM gallery_items WHERE uploaded_by = ? AND type = 'image'", OWNER)).toBe(1);
    const linked = text(database, "SELECT media_id FROM media_links WHERE entity_type = 'gallery_item'");
    const loser = MEDIA_IDS.find((mediaId) => mediaId !== linked)!;
    expect(text(database, "SELECT state FROM media_assets WHERE id = ?", loser)).toBe("staged");
  });

  it("uses the owner/type covering index for quota claims", () => {
    const { database } = fixture();
    database.exec(`DROP INDEX idx_gallery_items_owner_created;
      CREATE INDEX idx_gallery_items_owner_created
      ON gallery_items(uploaded_by, type, created_at, id);`);
    const plan = database.prepare(`EXPLAIN QUERY PLAN
      SELECT COUNT(*) FROM gallery_items WHERE uploaded_by = ? AND type = 'image'`)
      .all(OWNER) as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join("\n")).toContain("COVERING INDEX idx_gallery_items_owner_created");
  });

  it("keeps a maximum image set bounded and rolls every parent and link back when audit insertion fails", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => galleryMediaId(index));
    const records = ids.map((mediaId, index) => record(`gallery-max-${String(index).padStart(2, "0")}`, mediaId));

    const success = fixture();
    ids.forEach((id) => insertMedia(success.database, id));
    await success.store.createImages({
      records,
      mediaIds: ids,
      ownerUserId: OWNER,
      maxItems: 50,
      audit: audit("gallery-max"),
    });
    expect(success.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(success.database.prepare("SELECT count(*) AS count FROM gallery_items").get()).toMatchObject({ count: 50 });
    expect(success.database.prepare("SELECT count(*) AS count FROM media_links").get()).toMatchObject({ count: 50 });
    expect(success.database.prepare("SELECT count(*) AS count FROM media_assets WHERE state = 'attached'").get())
      .toMatchObject({ count: 50 });

    const failed = fixture();
    ids.forEach((id) => insertMedia(failed.database, id));
    const rejectedAudit = audit("gallery-max-failed");
    failed.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      rejectedAudit.id,
      rejectedAudit.requestId,
      rejectedAudit.actorUserId,
      rejectedAudit.entityType,
      rejectedAudit.entityId,
      rejectedAudit.action,
      rejectedAudit.occurredAt,
    );
    await expect(failed.store.createImages({
      records,
      mediaIds: ids,
      ownerUserId: OWNER,
      maxItems: 50,
      audit: rejectedAudit,
    })).rejects.toThrow(/UNIQUE/i);
    expect(failed.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(failed.database.prepare("SELECT count(*) AS count FROM gallery_items").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_links").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_assets WHERE state = 'staged'").get())
      .toMatchObject({ count: 50 });
  });
});

function fixture(): { database: DatabaseSync; executor: SerialTestExecutor; store: SqliteGalleryStore } {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(FRESH_MIGRATION);
  database.prepare(`INSERT INTO users (id, username, role_id, revision_token)
    VALUES (?, 'Owner', 'member', 'owner-revision-0001')`).run(OWNER);
  const executor = new SerialTestExecutor(database);
  return { database, executor, store: new SqliteGalleryStore(executor) };
}

function insertMedia(database: DatabaseSync, mediaId: string): void {
  database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
  ) VALUES (?, ?, 'gallery_image', 'image', 'staged', '2026-08-10T12:00:00.000Z', ?, ?)`)
    .run(mediaId, OWNER, NOW, NOW);
}

function record(id: string, mediaId: string): GalleryRecord {
  return {
    id,
    type: "image",
    media_id: mediaId,
    url: null,
    caption: null,
    uploaded_by: OWNER,
    uploaded_by_name: null,
    created_at: NOW,
    revisionToken: `revision-${id}-0001`,
  };
}

function galleryMediaId(index: number): string {
  return `g${String(index).padStart(20, "0")}`;
}

function audit(entityId: string) {
  return createAuditMutation(requestContext(), {
    entityType: "gallery_item",
    entityId,
    action: "upload_images",
  });
}

function requestContext() {
  return createRequestContext({
    requestId: crypto.randomUUID(),
    authorization: createAuthorizationContext({
      userId: OWNER,
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: [],
    }),
    now: NOW,
  });
}

function text(database: DatabaseSync, sql: string, value?: string): string {
  const row = database.prepare(sql).get(...(value === undefined ? [] : [value])) as Record<string, unknown> | undefined;
  const result = row ? Object.values(row)[0] : undefined;
  if (typeof result !== "string") throw new TypeError("Expected text result");
  return result;
}

function number(database: DatabaseSync, sql: string, value: string): number {
  const row = database.prepare(sql).get(value) as Record<string, unknown> | undefined;
  const result = row ? Object.values(row)[0] : undefined;
  if (typeof result !== "number") throw new TypeError("Expected numeric result");
  return result;
}
