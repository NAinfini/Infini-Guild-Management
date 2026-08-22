import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaReservation } from "@guild/server/modules/media";
import { MAX_SQL_BATCH_STATEMENTS } from "@guild/kernel";
import { createSchedulerAuditFactory } from "@guild/server/modules/jobs";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { assertMediaAttachments } from "./media-link-statements.js";
import { SqliteMediaStore } from "./media-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const MEDIA_ID = "abcdefghijklmnopqrstu";
const SECOND_MEDIA_ID = "vwxyzabcdefghijklmnop";
const WIKI_REVISION_MEDIA_TABLE = `CREATE TABLE IF NOT EXISTS wiki_revision_media (
  revision_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  audience TEXT NOT NULL
)`;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteMediaStore shared asset links", () => {
  it("keeps a shared asset attached until its final target is removed", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.exec(WIKI_REVISION_MEDIA_TABLE);
    database.prepare(`INSERT INTO users (id, username, role_id, revision_token)
      VALUES ('owner-1', 'Owner', 'member', 'owner-revision-0001')`).run();
    database.prepare(`INSERT INTO recurring_templates (
      id, type, title, start_time, recurrence_frequency, recurrence_interval, created_by
    ) VALUES ('template-1', 'other', 'Template', '12:00', 'weekly', 1, 'owner-1')`).run();
    database.prepare(`INSERT INTO events (id, type, title, start_at, created_by)
      VALUES ('event-1', 'other', 'Event', ?, 'owner-1')`).run(NOW);
    database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
    ) VALUES (?, 'owner-1', 'event_image', 'image', 'staged', ?, ?, ?)`)
      .run(MEDIA_ID, "2026-08-10T12:00:00.000Z", NOW, NOW);
    database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`)
      .run(MEDIA_ID, `media/${MEDIA_ID}/view.webp`, "a".repeat(64));

    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'recurring_template', 'template-1', 'attachment', 'private', 0)`)
      .run(MEDIA_ID);
    const sql = new SqliteTestExecutor(database);
    await expect(assertMediaAttachments(sql, {
      actorUserId: "owner-1",
      entityType: "event",
      entityId: "event-1",
      slot: "attachment",
      purpose: "event_image",
      audience: "public",
      mediaIds: [MEDIA_ID],
      maxItems: 1,
    })).resolves.toEqual([MEDIA_ID]);
    await expect(assertMediaAttachments(sql, {
      actorUserId: "other-user",
      entityType: "event",
      entityId: "event-1",
      slot: "attachment",
      purpose: "event_image",
      audience: "public",
      mediaIds: [MEDIA_ID],
      maxItems: 1,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertMediaAttachments(sql, {
      actorUserId: "owner-1",
      entityType: "event",
      entityId: "event-1",
      slot: "attachment",
      purpose: "announcement_image",
      audience: "public",
      mediaIds: [MEDIA_ID],
      maxItems: 1,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'announcement', 'announcement-1', 'body', 'private', 0)`).run(MEDIA_ID))
      .toThrow("media purpose does not support target");
    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'event', 'event-1', 'attachment', 'public', 0)`)
      .run(MEDIA_ID);

    const store = new SqliteMediaStore(sql);
    const publicFacts = await store.describeRead(MEDIA_ID, "view", NOW);
    expect(publicFacts).toMatchObject({
      objectKey: `media/${MEDIA_ID}/view.webp`,
      byteSize: 10,
      contentType: "image/webp",
      sha256: "a".repeat(64),
      audience: "public",
      ownerUserId: "owner-1",
    });
    expect(new Set(publicFacts?.entityTypes)).toEqual(new Set(["recurring_template", "event"]));

    database.prepare("DELETE FROM media_links WHERE entity_type = 'event' AND entity_id = 'event-1'").run();
    expect(database.prepare("SELECT state FROM media_assets WHERE id = ?").get(MEDIA_ID))
      .toMatchObject({ state: "attached" });
    expect((await store.describeRead(MEDIA_ID, "view", NOW))?.audience).toBe("private");

    database.prepare("DELETE FROM media_links WHERE entity_type = 'recurring_template'").run();
    expect(database.prepare("SELECT state FROM media_assets WHERE id = ?").get(MEDIA_ID))
      .toMatchObject({ state: "deleting" });
  });

  it("reserves multiple uploads in one transaction and stages them with one mutation", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.prepare(`INSERT INTO users (id, username, role_id, revision_token)
      VALUES ('owner-1', 'Owner', 'member', 'owner-revision-0001')`).run();
    const executor = new SqliteTestExecutor(database);
    const store = new SqliteMediaStore(executor);
    const reservations = [reservation(MEDIA_ID), reservation(SECOND_MEDIA_ID)];

    await store.reserveUploads(reservations);
    expect(executor.batches).toHaveLength(1);
    expect(executor.batches[0]).toHaveLength(2);
    const beforeStage = executor.statements.length;
    await store.markStaged([MEDIA_ID, SECOND_MEDIA_ID], NOW);

    expect(executor.statements).toHaveLength(beforeStage + 1);
    expect(database.prepare("SELECT state FROM media_assets ORDER BY id").all())
      .toEqual([{ state: "staged" }, { state: "staged" }]);
  });

  it("keeps the maximum upload reservation set bounded and rolls it back on a late variant failure", async () => {
    const success = mediaFixture();
    const reservations = Array.from({ length: 50 }, (_, index) => imageReservation(mediaId(index)));

    await success.store.reserveUploads(reservations);
    expect(success.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(success.database.prepare("SELECT count(*) AS count FROM media_assets").get()).toMatchObject({ count: 50 });
    expect(success.database.prepare("SELECT count(*) AS count FROM media_variants").get()).toMatchObject({ count: 100 });

    const failed = mediaFixture();
    const last = reservations.at(-1)!;
    const invalid = [...reservations.slice(0, -1), { ...last, variants: [last.variants[0]!, last.variants[0]!] }];

    await expect(failed.store.reserveUploads(invalid)).rejects.toThrow(/UNIQUE/i);
    expect(failed.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_assets").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_variants").get()).toMatchObject({ count: 0 });
  });

  it("uses media-id indexes for every read-link source", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    const sql = new SqliteTestExecutor(database);
    const store = new SqliteMediaStore(sql);

    await store.describeRead(MEDIA_ID, "view", NOW);
    const statement = sql.statements.at(-1);
    expect(statement).toBeDefined();
    const details = database.prepare(`EXPLAIN QUERY PLAN ${statement!.sql}`)
      .all(...[...(statement!.params ?? [])] as SQLInputValue[])
      .map((row) => String((row as Record<string, unknown>).detail));

    expect(details.some((detail) => detail.includes("SEARCH media_links USING INDEX idx_media_links_asset"))).toBe(true);
    expect(details.some((detail) => detail.includes("SEARCH wiki_revision_media USING INDEX idx_wiki_revision_media_asset"))).toBe(true);
    expect(details.some((detail) => /SCAN (media_links|wiki_revision_media)\b/.test(detail))).toBe(false);
  });

  it("commits garbage-collection deletion and its scheduler audit atomically", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.exec(WIKI_REVISION_MEDIA_TABLE);
    const insert = database.prepare(`INSERT INTO media_assets (
      id, purpose, media_type, state, delete_claim_token, delete_claim_until, created_at, updated_at
    ) VALUES (?, 'event_image', 'image', 'deleting', ?, ?, ?, ?)`);
    insert.run(MEDIA_ID, "claim-success", "2026-08-09T12:10:00.000Z", NOW, NOW);
    const store = new SqliteMediaStore(new SqliteTestExecutor(database));
    await store.finalizeDeletion(
      MEDIA_ID,
      "claim-success",
      createSchedulerAuditFactory("media-success", NOW)({
        subjectType: "media_cleanup",
        subjectId: MEDIA_ID,
        action: "delete",
      }),
    );
    expect(database.prepare("SELECT id FROM media_assets WHERE id = ?").get(MEDIA_ID)).toBeUndefined();
    expect(database.prepare("SELECT actor_id FROM audit_log WHERE subject_id = ?").get(MEDIA_ID))
      .toMatchObject({ actor_id: "system:scheduler" });

    const failedId = SECOND_MEDIA_ID;
    insert.run(failedId, "claim-failure", "2026-08-09T12:10:00.000Z", NOW, NOW);
    database.exec(`CREATE TRIGGER reject_media_cleanup_audit
      BEFORE INSERT ON audit_log WHEN NEW.subject_id = '${failedId}'
      BEGIN SELECT RAISE(ABORT, 'media audit rejected'); END;`);
    await expect(store.finalizeDeletion(
      failedId,
      "claim-failure",
      createSchedulerAuditFactory("media-failure", NOW)({
        subjectType: "media_cleanup",
        subjectId: failedId,
        action: "delete",
      }),
    )).rejects.toThrow("media audit rejected");
    expect(database.prepare("SELECT id FROM media_assets WHERE id = ?").get(failedId))
      .toMatchObject({ id: failedId });
  });

  it("claims a bounded garbage-collection batch with one shared claim token", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    const expiresAt = "2026-08-09T11:00:00.000Z";
    const insertAsset = database.prepare(`INSERT INTO media_assets (
      id, purpose, media_type, state, expires_at, created_at, updated_at
    ) VALUES (?, 'event_image', 'image', 'staged', ?, ?, ?)`);
    const insertVariant = database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`);
    for (const mediaId of [MEDIA_ID, SECOND_MEDIA_ID]) {
      insertAsset.run(mediaId, expiresAt, expiresAt, expiresAt);
      insertVariant.run(mediaId, `media/${mediaId}/view.webp`, "b".repeat(64));
    }

    const store = new SqliteMediaStore(new SqliteTestExecutor(database));
    await expect(store.inspectGarbageBacklog(NOW)).resolves.toEqual({
      status: "known",
      pendingCount: 2,
      countPrecision: "exact",
      oldestPendingAt: expiresAt,
    });
    const claims = await store.claimGarbage(NOW, 2);

    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.mediaId)).toEqual([MEDIA_ID, SECOND_MEDIA_ID]);
    expect(new Set(claims.map((claim) => claim.claimToken))).toHaveLength(1);
    expect(claims.every((claim) => claim.objectKeys.length === 1)).toBe(true);
  });
});

function reservation(id: string): MediaReservation {
  return {
    id,
    ownerUserId: "owner-1",
    purpose: "event_image",
    mediaType: "image",
    originalName: null,
    expiresAt: "2026-08-10T12:00:00.000Z",
    createdAt: NOW,
    variants: [{
      variant: "view",
      objectKey: `media/${id}/view.webp`,
      contentType: "image/webp",
      byteSize: 10,
      sha256: "c".repeat(64),
      width: 1,
      height: 1,
    }],
  };
}

function mediaFixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  database.prepare(`INSERT INTO users (id, username, role_id, revision_token)
    VALUES ('owner-1', 'Owner', 'member', 'owner-revision-0001')`).run();
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqliteMediaStore(executor) };
}

function mediaId(index: number): string {
  return `m${String(index).padStart(20, "0")}`;
}

function imageReservation(id: string): MediaReservation {
  return {
    ...reservation(id),
    variants: (["full", "view"] as const).map((variant) => ({
      variant,
      objectKey: `media/${id}/${variant}.webp`,
      contentType: "image/webp" as const,
      byteSize: 10,
      sha256: "d".repeat(64),
      width: 1,
      height: 1,
    })),
  };
}
