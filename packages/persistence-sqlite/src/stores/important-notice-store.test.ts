import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { ImportantNoticeService } from "@guild/server/modules/important-notices";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteImportantNoticeStore } from "./important-notice-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const OWNER = "important-notice-owner";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteImportantNoticeStore", () => {
  it("persists create, update, publish, withdraw, and delete audits in their business mutations", async () => {
    const { database, service } = fixture();
    const created = await service.create(context("2026-08-09T12:00:00.000Z"), {
      title: "Maintenance",
      body_json: '{"type":"doc","content":[]}',
      status: "draft",
    });
    const updated = await service.update(context("2026-08-09T12:01:00.000Z"), created.id, { title: "Maintenance window" });
    const published = await service.publish(context("2026-08-09T12:02:00.000Z"), created.id);
    await service.withdraw(context("2026-08-09T12:03:00.000Z"), created.id);
    await service.update(context("2026-08-09T12:04:00.000Z"), created.id, { body_json: '{"type":"doc","content":[{"type":"paragraph"}]}' });
    await service.delete(context("2026-08-09T12:05:00.000Z"), created.id);

    expect(updated.status).toBe("draft");
    expect(published.publication_revision).toBe(1);
    expect(database.prepare("SELECT action FROM audit_log WHERE subject_type = 'important_notice' ORDER BY occurred_at, id")
      .all().map(({ action }) => action)).toEqual([
      "create", "update", "publish", "withdraw", "update", "delete",
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM important_notices").get()).toMatchObject({ count: 0 });
  });

  it("keeps the initial scheduled revision through manual or due publication, then increments only after withdrawal", async () => {
    const { service } = fixture();
    const scheduled = await service.create(context(), {
      title: "Scheduled",
      body_json: '{"type":"doc","content":[]}',
      status: "scheduled",
      publish_at: "2026-08-10T12:00:00.000Z",
    });
    const manuallyPublished = await service.publish(context(), scheduled.id);
    expect(manuallyPublished.publication_revision).toBe(1);

    await service.withdraw(context(), scheduled.id);
    const editedDraft = await service.update(context(), scheduled.id, { title: "Scheduled again" });
    expect(editedDraft).toMatchObject({ status: "draft", publication_revision: 1 });
    const republished = await service.publish(context(), scheduled.id);
    expect(republished.publication_revision).toBe(2);

    const draft = await service.create(context(), {
      title: "Schedule a draft",
      body_json: '{"type":"doc","content":[]}',
      status: "draft",
    });
    const newlyScheduled = await service.update(context(), draft.id, {
      publish_at: "2026-08-10T12:00:00.000Z",
    });
    expect(newlyScheduled).toMatchObject({ status: "scheduled", publication_revision: 1 });

    const due = await service.create(context(), {
      title: "Due",
      body_json: '{"type":"doc","content":[]}',
      status: "scheduled",
      publish_at: "2026-08-10T12:00:00.000Z",
    });
    const records = await service.listAdmin(context("2026-08-11T12:00:00.000Z"));
    expect(records.find(({ id }) => id === due.id)).toMatchObject({
      status: "published",
      publication_revision: 1,
    });
  });

  it("acknowledges one active publication revision idempotently", async () => {
    const { database, store } = fixture();
    const created = await store.create({
      record: {
        id: "important-notice-ack",
        title: "Acknowledge",
        body_json: '{"type":"doc","content":[]}',
        status: "published",
        publish_at: NOW,
        expires_at: null,
        publication_revision: 1,
        revisionToken: "important-notice-ack-revision-0001",
        createdBy: OWNER,
        updatedBy: OWNER,
        created_at: NOW,
        updated_at: NOW,
      },
      audit: audit("create", "important-notice-ack"),
    });
    expect(created).toBeUndefined();

    await expect(store.acknowledge({
      userId: OWNER,
      id: "important-notice-ack",
      publicationRevision: 1,
      now: NOW,
    })).resolves.toBe(true);
    await expect(store.acknowledge({
      userId: OWNER,
      id: "important-notice-ack",
      publicationRevision: 1,
      now: NOW,
    })).resolves.toBe(true);
    await expect(store.acknowledge({
      userId: OWNER,
      id: "important-notice-ack",
      publicationRevision: 2,
      now: NOW,
    })).resolves.toBe(false);
    expect(database.prepare("SELECT COUNT(*) AS count FROM important_notice_acknowledgements").get())
      .toMatchObject({ count: 1 });
  });

  it("returns only active notices in stable order and invalidates acknowledgements after republishing", async () => {
    const { service, store } = fixture();
    await Promise.all([
      store.create({ record: record("active-scheduled", "scheduled", "2026-08-09T10:00:00.000Z", null, 1), audit: audit("create", "active-scheduled") }),
      store.create({ record: record("active-published", "published", "2026-08-09T11:00:00.000Z", null, 1), audit: audit("create", "active-published") }),
      store.create({ record: record("draft", "draft", null, null, 0), audit: audit("create", "draft") }),
      store.create({ record: record("future", "scheduled", "2026-08-09T13:00:00.000Z", null, 1), audit: audit("create", "future") }),
      store.create({ record: record("expired", "published", "2026-08-09T10:00:00.000Z", "2026-08-09T11:00:00.000Z", 1), audit: audit("create", "expired") }),
      store.create({ record: record("withdrawn", "withdrawn", "2026-08-09T10:00:00.000Z", null, 1), audit: audit("create", "withdrawn") }),
    ]);

    expect(await service.listActive(context())).toEqual([
      expect.objectContaining({ id: "active-scheduled", publication_revision: 1 }),
      expect.objectContaining({ id: "active-published", publication_revision: 1 }),
    ]);

    const created = await service.create(context(), {
      title: "Revision notice",
      body_json: '{"type":"doc","content":[]}',
      status: "draft",
    });
    const firstPublication = await service.publish(context(), created.id);
    await service.acknowledge(context(), created.id, firstPublication.publication_revision);
    expect(await service.listAcknowledgements(context())).toContainEqual({
      notice_id: created.id,
      publication_revision: firstPublication.publication_revision,
    });

    await service.withdraw(context(), created.id);
    const secondPublication = await service.publish(context(), created.id);
    expect(secondPublication.publication_revision).toBe(firstPublication.publication_revision + 1);
    await expect(service.acknowledge(context(), created.id, firstPublication.publication_revision))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.listAcknowledgements(context())).not.toContainEqual({
      notice_id: created.id,
      publication_revision: secondPublication.publication_revision,
    });
    await service.acknowledge(context(), created.id, secondPublication.publication_revision);
    expect(await service.listAcknowledgements(context())).toContainEqual({
      notice_id: created.id,
      publication_revision: secondPublication.publication_revision,
    });
  });
});

function fixture(): {
  database: DatabaseSync;
  store: SqliteImportantNoticeStore;
  service: ImportantNoticeService;
} {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
    VALUES (?, 'Important Notice Owner', 'admin', 'important-notice-owner-revision-0001')`).run(OWNER);
  const store = new SqliteImportantNoticeStore(new SqliteTestExecutor(database));
  return { database, store, service: new ImportantNoticeService(store) };
}

function context(now = NOW) {
  return createRequestContext({
    requestId: crypto.randomUUID(),
    authorization: createAuthorizationContext({
      userId: OWNER,
      sessionId: "important-notice-session",
      roleId: "admin",
      roleLevel: 1_000,
      permissions: ["admin.importantNotices.manage"],
    }),
    now,
  });
}

function audit(action: "create", subjectId: string) {
  return {
    eventId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    actorKind: "user" as const,
    actorId: OWNER,
    actorLabel: "Important Notice Owner",
    subjectType: "important_notice" as const,
    subjectId,
    subjectLabel: "Acknowledge",
    action,
    payload: { schema_version: 2 as const, changes: [], context: [] },
    occurredAt: NOW,
  };
}

function record(
  id: string,
  status: "draft" | "scheduled" | "published" | "withdrawn",
  publishAt: string | null,
  expiresAt: string | null,
  publicationRevision: number,
) {
  return {
    id,
    title: id,
    body_json: '{"type":"doc","content":[]}',
    status,
    publish_at: publishAt,
    expires_at: expiresAt,
    publication_revision: publicationRevision,
    revisionToken: `${id}-revision-token-0001`,
    createdBy: OWNER,
    updatedBy: OWNER,
    created_at: NOW,
    updated_at: NOW,
  } as const;
}
