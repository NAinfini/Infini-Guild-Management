import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { ImportantNoticeService } from "@guild/server/modules/important-notices";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteImportantNoticeStore } from "./important-notice-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const OWNER = "important-notice-owner";
const MEMBER = "important-notice-member";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteImportantNoticeStore", () => {
  it("persists create, update, publish, withdraw, and delete audits in their business mutations", async () => {
    const { database, service } = fixture();
    const created = await service.create(context("2026-08-09T12:00:00.000Z"), noticeInput({
      title: "Maintenance",
    }));
    const updated = await service.update(context("2026-08-09T12:01:00.000Z"), created.id, {
      expected_revision_token: created.revision_token,
      title: "Maintenance window",
    });
    const published = await service.publish(context("2026-08-09T12:02:00.000Z"), created.id);
    const withdrawn = await service.withdraw(context("2026-08-09T12:03:00.000Z"), created.id);
    await service.update(context("2026-08-09T12:04:00.000Z"), created.id, {
      expected_revision_token: withdrawn.revision_token,
      body_json: '{"type":"doc","content":[{"type":"paragraph"}]}',
    });
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
    const scheduled = await service.create(context(), noticeInput({
      title: "Scheduled",
      status: "scheduled",
      publish_at: "2026-08-10T12:00:00.000Z",
    }));
    const manuallyPublished = await service.publish(context(), scheduled.id);
    expect(manuallyPublished.publication_revision).toBe(1);

    const withdrawn = await service.withdraw(context(), scheduled.id);
    const editedDraft = await service.update(context(), scheduled.id, {
      expected_revision_token: withdrawn.revision_token,
      title: "Scheduled again",
    });
    expect(editedDraft).toMatchObject({ status: "draft", publication_revision: 1 });
    const republished = await service.publish(context(), scheduled.id);
    expect(republished.publication_revision).toBe(2);

    const draft = await service.create(context(), noticeInput({
      title: "Schedule a draft",
    }));
    const newlyScheduled = await service.update(context(), draft.id, {
      expected_revision_token: draft.revision_token,
      publish_at: "2026-08-10T12:00:00.000Z",
    });
    expect(newlyScheduled).toMatchObject({ status: "scheduled", publication_revision: 1 });

    const due = await service.create(context(), noticeInput({
      title: "Due",
      status: "scheduled",
      publish_at: "2026-08-10T12:00:00.000Z",
    }));
    const records = await service.listAdmin(context("2026-08-11T12:00:00.000Z"));
    expect(records.find(({ id }) => id === due.id)).toMatchObject({
      status: "published",
      publication_revision: 1,
    });
  });

  it("acknowledges one notice identity idempotently", async () => {
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
        requires_acknowledgement: true,
        audience_scope: "all",
        audience_role_ids: [],
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
      roleId: "admin",
      id: "important-notice-ack",
      now: NOW,
    })).resolves.toBe(true);
    await expect(store.acknowledge({
      userId: OWNER,
      roleId: "admin",
      id: "important-notice-ack",
      now: NOW,
    })).resolves.toBe(true);
    expect(database.prepare("SELECT COUNT(*) AS count FROM important_notice_receipts").get())
      .toMatchObject({ count: 1 });
    expect(database.prepare(`SELECT read_at, read_publication_revision, acknowledged_at
      FROM important_notice_receipts`).get())
      .toEqual({ read_at: NOW, read_publication_revision: 1, acknowledged_at: NOW });
  });

  it("rejects a stale draft without changing the notice or its audit trail", async () => {
    const { database, service } = fixture();
    const created = await service.create(context(), noticeInput({
      title: "Original",
    }));
    const updated = await service.update(context("2026-08-09T12:01:00.000Z"), created.id, {
      expected_revision_token: created.revision_token,
      title: "Newer edit",
    });
    await expect(service.update(context("2026-08-09T12:01:30.000Z"), created.id, {
      expected_revision_token: updated.revision_token,
      title: "Newer edit",
    })).resolves.toMatchObject({ revision_token: updated.revision_token });

    await expect(service.update(context("2026-08-09T12:02:00.000Z"), created.id, {
      expected_revision_token: created.revision_token,
      title: "Stale edit",
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    await expect(service.getAdmin(context(), created.id)).resolves.toMatchObject({
      title: "Newer edit",
      revision_token: updated.revision_token,
    });
    expect(database.prepare("SELECT action FROM audit_log WHERE subject_type = 'important_notice' ORDER BY occurred_at, id")
      .all().map(({ action }) => action)).toEqual(["create", "update"]);
  });

  it("returns only active notices in stable order and keeps one acknowledgement across republishing", async () => {
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
      expect.objectContaining({ id: "active-scheduled", read_at: null, acknowledged_at: null }),
      expect.objectContaining({ id: "active-published", read_at: null, acknowledged_at: null }),
    ]);

    const created = await service.create(context(), noticeInput({
      title: "Revision notice",
      requires_acknowledgement: true,
    }));
    const firstPublication = await service.publish(context(), created.id);
    await service.acknowledge(context(), created.id);
    expect((await service.listActive(context())).find(({ id }) => id === created.id))
      .toMatchObject({ read_at: NOW, acknowledged_at: NOW });

    await service.withdraw(context("2026-08-09T12:01:00.000Z"), created.id);
    const secondPublication = await service.publish(context("2026-08-09T12:02:00.000Z"), created.id);
    expect(secondPublication.publication_revision).toBe(firstPublication.publication_revision + 1);
    expect((await service.listActive(context("2026-08-09T12:03:00.000Z"))).find(({ id }) => id === created.id))
      .toMatchObject({ read_at: null, acknowledged_at: NOW });
    await service.markRead(context("2026-08-09T12:04:00.000Z"), { ids: [created.id] });
    expect((await service.listActive(context("2026-08-09T12:05:00.000Z"))).find(({ id }) => id === created.id))
      .toMatchObject({ read_at: "2026-08-09T12:04:00.000Z", acknowledged_at: NOW });
  });

  it("filters role audiences and keeps read separate from acknowledgement", async () => {
    const { database, service, store } = fixture();
    await store.create({
      record: record("member-notice", "published", NOW, null, 1, {
        requiresAcknowledgement: true,
        audienceScope: "roles",
        audienceRoleIds: ["member"],
      }),
      audit: audit("create", "member-notice"),
    });
    await store.create({
      record: record("all-notice", "published", NOW, null, 1),
      audit: audit("create", "all-notice"),
    });

    expect((await service.listActive(context())).map(({ id }) => id)).toEqual(["all-notice"]);
    const memberContext = context(NOW, MEMBER, "member");
    expect((await service.listActive(memberContext)).map(({ id }) => id)).toEqual([
      "all-notice",
      "member-notice",
    ]);

    await expect(service.markRead(memberContext, { ids: ["member-notice"] })).resolves.toEqual({ updated: 1 });
    expect((await service.listActive(memberContext)).find(({ id }) => id === "member-notice"))
      .toMatchObject({ read_at: NOW, acknowledged_at: null });
    expect(database.prepare("SELECT COUNT(*) AS count FROM important_notice_receipts").get())
      .toEqual({ count: 1 });

    await service.acknowledge(memberContext, "member-notice");
    expect((await service.listActive(memberContext)).find(({ id }) => id === "member-notice"))
      .toMatchObject({ read_at: NOW, acknowledged_at: NOW });
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
  database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
    VALUES (?, 'Important Notice Member', 'member', 'important-notice-member-revision-0001')`).run(MEMBER);
  const store = new SqliteImportantNoticeStore(new SqliteTestExecutor(database));
  return {
    database,
    store,
    service: new ImportantNoticeService(
      store,
      { publish: async () => undefined },
      { defer: () => undefined },
    ),
  };
}

function context(now = NOW, userId = OWNER, roleId = "admin") {
  return createRequestContext({
    requestId: crypto.randomUUID(),
    authorization: createAuthorizationContext({
      userId,
      sessionId: "important-notice-session",
      roleId,
      roleLevel: roleId === "admin" ? 1_000 : 100,
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
  options: Readonly<{
    requiresAcknowledgement?: boolean;
    audienceScope?: "all" | "roles";
    audienceRoleIds?: string[];
  }> = {},
) {
  return {
    id,
    title: id,
    body_json: '{"type":"doc","content":[]}',
    status,
    publish_at: publishAt,
    expires_at: expiresAt,
    publication_revision: publicationRevision,
    requires_acknowledgement: options.requiresAcknowledgement ?? false,
    audience_scope: options.audienceScope ?? "all",
    audience_role_ids: options.audienceRoleIds ?? [],
    revisionToken: `${id}-revision-token-0001`,
    createdBy: OWNER,
    updatedBy: OWNER,
    created_at: NOW,
    updated_at: NOW,
  } as const;
}

function noticeInput(overrides: Partial<{
  title: string;
  body_json: string;
  status: "draft" | "scheduled";
  publish_at: string;
  expires_at: string | null;
  requires_acknowledgement: boolean;
  audience_scope: "all" | "roles";
  audience_role_ids: string[];
}> = {}) {
  return {
    title: "Notice",
    body_json: '{"type":"doc","content":[]}',
    status: "draft" as "draft" | "scheduled",
    requires_acknowledgement: false,
    audience_scope: "all" as "all" | "roles",
    audience_role_ids: [] as string[],
    ...overrides,
  };
}
