import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditEvent, type AuditEventWrite } from "@guild/server/modules/audit";
import { type TemplateCreateWrite } from "@guild/server/modules/events";
import {
  createSchedulerAuditFactory,
  ScheduledRaffleAutoDrawJob,
} from "@guild/server/modules/jobs";
import { LIMITS } from "@guild/shared";
import { createAppDatabase } from "../database.js";
import type { SqlExecutor, SqlStatement } from "@guild/kernel";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteEventMediaPort, SqliteEventsStore } from "./events-store.js";
import { SqliteRaffleAutoDrawStore } from "./scheduled-job-store.js";

const NOW = "2026-08-09T13:00:00.000Z";
const databases: DatabaseSync[] = [];

const BASE_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
  );
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
    actor_label TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_label TEXT,
    action TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
  );
  CREATE TABLE class_tags (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    owner_kind TEXT, owner_id TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE class_tag_members (
    tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL, PRIMARY KEY(tag_id, class_id)
  );
  CREATE TABLE recurring_templates (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    start_time TEXT NOT NULL, duration_minutes INTEGER, capacity INTEGER,
    recurrence_frequency TEXT NOT NULL, recurrence_interval INTEGER NOT NULL,
    recurrence_day_of_month INTEGER, recurrence_end_after INTEGER, recurrence_end_at TEXT,
    visibility_offset_minutes INTEGER NOT NULL DEFAULT 0,
    auto_archive INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id), last_generated_date TEXT,
    generation_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_recurring_templates_active ON recurring_templates(paused, id);
  CREATE TABLE recurring_template_weekdays (
    template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL, PRIMARY KEY(template_id, weekday)
  );
  CREATE TABLE events (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    start_at TEXT NOT NULL, end_at TEXT, capacity INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0, signup_locked INTEGER NOT NULL DEFAULT 0,
    auto_archive INTEGER NOT NULL DEFAULT 0, auto_archived INTEGER NOT NULL DEFAULT 0,
    visible_at TEXT, archived_at TEXT, created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT REFERENCES users(id), series_id TEXT REFERENCES recurring_templates(id) ON DELETE SET NULL,
    instance_date TEXT, winner_count INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(series_id, instance_date),
    CHECK((series_id IS NULL AND instance_date IS NULL) OR (series_id IS NOT NULL AND instance_date IS NOT NULL))
  );
  CREATE INDEX idx_events_public_start ON events(archived_at, visible_at, start_at, id);
  CREATE INDEX idx_events_list_start ON events(start_at, id);
  CREATE INDEX idx_events_raffle_due ON events(type, archived_at, end_at, id);
  CREATE TABLE event_class_quotas (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES class_tags(id), required INTEGER NOT NULL,
    PRIMARY KEY(event_id, tag_id)
  );
  CREATE TABLE recurring_template_class_quotas (
    template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES class_tags(id), required INTEGER NOT NULL,
    PRIMARY KEY(template_id, tag_id)
  );
  CREATE TABLE event_participants (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id), joined_at TEXT NOT NULL,
    UNIQUE(event_id, user_id)
  );
  CREATE TABLE event_polls (
    event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    results_visibility TEXT NOT NULL, show_voter_names INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE event_poll_options (
    id TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES event_polls(event_id) ON DELETE CASCADE,
    label TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(event_id, id), UNIQUE(event_id, sort_order)
  );
  CREATE TABLE event_poll_votes (
    event_id TEXT NOT NULL, option_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, PRIMARY KEY(event_id, option_id, user_id),
    FOREIGN KEY(event_id, option_id) REFERENCES event_poll_options(event_id, id) ON DELETE CASCADE
  );
  CREATE TABLE event_raffle_draws (
    event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    winner_count INTEGER NOT NULL, drawn_by TEXT NOT NULL REFERENCES users(id),
    drawn_at TEXT NOT NULL, mutation_token TEXT NOT NULL UNIQUE
  );
  CREATE TABLE event_raffle_winners (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES event_raffle_draws(event_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id), drawn_at TEXT NOT NULL,
    UNIQUE(event_id, user_id)
  );
  CREATE TABLE media_assets (
    id TEXT PRIMARY KEY, owner_user_id TEXT REFERENCES users(id), purpose TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'image', state TEXT NOT NULL,
    original_name TEXT, expires_at TEXT, delete_claim_token TEXT, delete_claim_until TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE media_links (
    media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, slot TEXT NOT NULL,
    audience TEXT NOT NULL, sort_order INTEGER NOT NULL, attached_at TEXT NOT NULL DEFAULT '${NOW}',
    PRIMARY KEY(entity_type, entity_id, slot, media_id),
    UNIQUE(entity_type, entity_id, slot, sort_order)
  );
`;
const EVENT_INVARIANTS = readFileSync(
  fileURLToPath(new URL("../schema/events.invariants.sql", import.meta.url)),
  "utf8",
).replaceAll("__RECURRING_TEMPLATE_CATALOG_MAX__", String(LIMITS.content.recurringTemplateCatalog.max));
const RENDERED_EVENT_INVARIANTS = EVENT_INVARIANTS.replaceAll(
  "__EVENT_PARTICIPANTS_PER_EVENT_MAX__",
  String(LIMITS.content.eventParticipantsPerEvent.max),
);

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteEventMediaPort", () => {
  it("keeps the legal 100-event page below D1's parameter limit", async () => {
    let captured: SqlStatement | undefined;
    const executor: SqlExecutor = {
      async execute(statement) {
        captured = statement;
        return { rows: [] };
      },
      async batch() {
        return [];
      },
    };
    const port = new SqliteEventMediaPort(executor);
    const maximumIds = Array.from(
      { length: LIMITS.pagination.events },
      (_, index) => `event-${index}`,
    );

    await port.list("event", maximumIds);
    expect(captured?.params).toEqual(["event", JSON.stringify(maximumIds)]);
    expect(captured?.sql).toContain("json_each(?)");
    await expect(port.list("event", [...maximumIds, "event-over-limit"]))
      .rejects.toThrow(/at most 100 targets/);
  });
});

function harness(includeEventsInvariants = true) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(BASE_SCHEMA);
  if (includeEventsInvariants) database.exec(RENDERED_EVENT_INVARIANTS);
  database.prepare("INSERT INTO users (id, username) VALUES (?, ?), (?, ?), (?, ?)")
    .run("admin-1", "Admin", "user-1", "One", "user-2", "Two");
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqliteEventsStore(createAppDatabase(executor), executor) };
}

function context(requestId: string) {
  return createRequestContext({
    requestId,
    authorization: createAuthorizationContext({
      userId: "admin-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 1,
      permissions: ["events.edit", "events.templates"],
    }),
    now: NOW,
  });
}

function eventAudit(requestId: string, eventId: string, action: "create" | "raffle_draw"): AuditEventWrite {
  return createAuditEvent(context(requestId), {
    subjectType: "event",
    subjectId: eventId,
    subjectLabel: eventId,
    action,
  });
}

function participantAudit(
  requestId: string,
  eventId: string,
  userId: string,
  action: "join" | "leave" | "batch_add_by_moderator" | "batch_remove_by_moderator",
): AuditEventWrite {
  return createAuditEvent(context(requestId), {
    subjectType: "event_participant",
    subjectId: `${eventId}:${userId}`,
    subjectLabel: "Participant event",
    action,
    context: [{
      field: "event_id",
      value: { type: "reference", value: { id: eventId, label: "Participant event" } },
    }],
  });
}

function auditFactory(requestPrefix: string) {
  let sequence = 0;
  return (input: Parameters<typeof createAuditEvent>[1]) => createAuditEvent(
    context(`${requestPrefix}:${++sequence}`),
    input,
  );
}

function templateAudit(requestId: string, templateId: string): AuditEventWrite {
  return createAuditEvent(context(requestId), {
    subjectType: "recurring_template",
    subjectId: templateId,
    subjectLabel: templateId,
    action: "create",
  });
}

function templateWrite(
  id: string,
  audit: AuditEventWrite,
  mediaIds: readonly string[] = [],
): TemplateCreateWrite {
  return {
    id,
    type: "social",
    title: id,
    description: null,
    startTime: "12:00",
    durationMinutes: null,
    capacity: null,
    recurrenceRule: { frequency: "daily", interval: 1 },
    visibilityOffsetMinutes: 0,
    autoArchive: false,
    actorUserId: "admin-1",
    now: NOW,
    quotas: [],
    mediaIds,
    audit,
  };
}

function seedEventMedia(database: DatabaseSync, id: string): void {
  database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, state, expires_at, created_at, updated_at
  ) VALUES (?, 'admin-1', 'event_image', 'staged', '2026-08-10T00:00:00.000Z', ?, ?)`)
    .run(id, NOW, NOW);
}

function seedTemplate(
  database: DatabaseSync,
  input: Readonly<{
    id?: string;
    endAfter?: number | null;
    endAt?: string | null;
    visibilityOffsetMinutes?: number;
  }> = {},
): string {
  const id = input.id ?? "template-1";
  database.prepare(`INSERT INTO recurring_templates (
    id, type, title, start_time, recurrence_frequency, recurrence_interval,
    recurrence_end_after, recurrence_end_at, visibility_offset_minutes,
    created_by, created_at, updated_at
  ) VALUES (?, 'social', 'Daily', '12:00', 'daily', 1, ?, ?, ?, 'admin-1', ?, ?)`)
    .run(
      id,
      input.endAfter ?? null,
      input.endAt ?? null,
      input.visibilityOffsetMinutes ?? 0,
      "2026-08-01T09:00:00.000Z",
      "2026-08-01T09:00:00.000Z",
    );
  return id;
}

function seedTemplateCatalog(database: DatabaseSync, count: number): void {
  for (let index = 0; index < count; index += 1) {
    seedTemplate(database, { id: `catalog-${String(index).padStart(3, "0")}` });
  }
}

describe("SqliteEventsStore raffle claims", () => {
  it("keeps guild-war lifecycle DML out of SqliteEventsStore", () => {
    const source = readFileSync(fileURLToPath(new URL("./events-store.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/(?:DELETE|UPDATE|INSERT)\s+(?:FROM\s+|INTO\s+)?(?:guild_wars|war_teams|war_members)/i);
  });

  it("commits one event-level draw and gives the loser zero winner or audit side effects", async () => {
    const { database, store } = harness();
    database.prepare(`INSERT INTO events (
      id, type, title, start_at, end_at, winner_count, created_by, created_at, updated_at
    ) VALUES ('raffle-1', 'raffle', 'Draw', ?, '2027-01-01T00:00:00.000Z', 1, 'admin-1', ?, ?)`)
      .run(NOW, NOW, NOW);
    database.prepare(`INSERT INTO event_participants (id, event_id, user_id, joined_at)
      VALUES ('p-1', 'raffle-1', 'user-1', ?), ('p-2', 'raffle-1', 'user-2', ?)`)
      .run(NOW, NOW);
    const candidates = [
      { userId: "user-1", rowId: "winner-a", audit: eventAudit("draw-a", "raffle-1", "raffle_draw") },
      { userId: "user-2", rowId: "winner-b", audit: eventAudit("draw-b", "raffle-1", "raffle_draw") },
    ];
    const outcomes = await Promise.allSettled(candidates.map((candidate) => store.drawRaffle(
      "raffle-1",
      [candidate.userId],
      [candidate.rowId],
      NOW,
      "admin-1",
      candidate.audit,
    )));
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const winner = candidates[outcomes.findIndex(({ status }) => status === "fulfilled")]!;
    expect(text(database, "SELECT user_id FROM event_raffle_winners WHERE event_id = 'raffle-1'")).toBe(winner.userId);
    expect(text(database, "SELECT mutation_token FROM event_raffle_draws WHERE event_id = 'raffle-1'")).toBe(winner.audit.eventId);
    expect(text(database, "SELECT request_id FROM audit_log WHERE action = 'raffle_draw'")).toBe(winner.audit.requestId);
    expect(scalar(database, "SELECT signup_locked FROM events WHERE id = 'raffle-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM event_raffle_winners")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE action = 'raffle_draw'")).toBe(1);
    expect(auditContext(database, winner.audit.requestId, "winner_count")).toEqual({ type: "number", value: 1 });
    expect(auditContext(database, winner.audit.requestId, "winner_user_ids")).toEqual({
      type: "list",
      value: [{
        type: "reference",
        value: { id: winner.userId, label: winner.userId === "user-1" ? "One" : "Two" },
      }],
    });
  });

  it("makes manual and scheduled draws compete on the same claim and notifies only a scheduled winner", async () => {
    const { database, executor, store } = harness();
    database.prepare(`INSERT INTO events (
      id, type, title, start_at, end_at, winner_count, created_by, created_at, updated_at
    ) VALUES ('raffle-1', 'raffle', 'Draw', '2026-08-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z', 1, 'admin-1', ?, ?)`)
      .run(NOW, NOW);
    database.prepare(`INSERT INTO event_participants (id, event_id, user_id, joined_at)
      VALUES ('p-1', 'raffle-1', 'user-1', ?), ('p-2', 'raffle-1', 'user-2', ?)`)
      .run(NOW, NOW);
    const drawNow = "2027-01-02T00:00:00.000Z";
    const publish = async () => undefined;
    const job = new ScheduledRaffleAutoDrawJob(
      new SqliteRaffleAutoDrawStore(executor, store),
      { publish },
      { random: () => 0, createId: () => "scheduled-winner-1" },
    );
    const scheduled = job.run({
      now: drawNow,
      limit: 25,
      audit: createSchedulerAuditFactory("scheduled-raffle", drawNow),
    });
    const manual = store.drawRaffle(
      "raffle-1",
      ["user-2"],
      ["manual-winner-1"],
      drawNow,
      "admin-1",
      eventAudit("manual-raffle", "raffle-1", "raffle_draw"),
    );
    const [scheduledResult, manualResult] = await Promise.allSettled([scheduled, manual]);

    expect(scheduledResult.status).toBe("fulfilled");
    expect(manualResult.status).toBe("fulfilled");
    expect(scheduledResult).toMatchObject({ value: { processed: 0 } });
    expect(scalar(database, "SELECT count(*) FROM event_raffle_draws WHERE event_id = 'raffle-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM event_raffle_winners WHERE event_id = 'raffle-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_id = 'raffle-1' AND action = 'raffle_draw'")).toBe(1);

    database.prepare(`INSERT INTO events (
      id, type, title, start_at, end_at, signup_locked, winner_count, created_by, created_at, updated_at
    ) VALUES ('raffle-2', 'raffle', 'Locked draw', '2026-08-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z', 0, 1, 'admin-1', ?, ?)`)
      .run(NOW, NOW);
    database.prepare(`INSERT INTO event_participants (id, event_id, user_id, joined_at)
      VALUES ('p-3', 'raffle-2', 'user-1', ?)`)
      .run(NOW);
    database.prepare("UPDATE events SET signup_locked = 1 WHERE id = 'raffle-2'").run();
    const notifications: unknown[] = [];
    const successfulJob = new ScheduledRaffleAutoDrawJob(
      new SqliteRaffleAutoDrawStore(executor, store),
      { publish: async (message) => { notifications.push(message); } },
      { random: () => 0, createId: () => "scheduled-winner-2" },
    );
    await expect(successfulJob.run({
      now: drawNow,
      limit: 25,
      audit: createSchedulerAuditFactory("scheduled-raffle-success", drawNow),
    })).resolves.toEqual({ processed: 1, hasMore: false });
    expect(text(database, "SELECT actor_id FROM audit_log WHERE subject_id = 'raffle-2'")).toBe("system:scheduler");
    expect(notifications).toEqual([expect.objectContaining({ hint: "raffle_drawn", entity_id: "raffle-2" })]);
  });
});

describe("SqliteEventsStore media transaction", () => {
  it("rolls back the parent and link when the audited create fails", async () => {
    const { database, store } = harness();
    database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, state, expires_at, created_at, updated_at
    ) VALUES ('media-create', 'admin-1', 'event_image', 'staged', '2026-08-10T00:00:00.000Z', ?, ?)`)
      .run(NOW, NOW);
    const duplicate = eventAudit("duplicate-create", "event-media", "create");
    database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, subject_type, subject_id, action, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        duplicate.eventId,
        duplicate.requestId,
        duplicate.actorKind,
        duplicate.actorId,
        duplicate.subjectType,
        duplicate.subjectId,
        duplicate.action,
        JSON.stringify(duplicate.payload),
        duplicate.occurredAt,
      );
    const create = (audit: AuditEventWrite) => store.create({
      id: "event-media",
      type: "social",
      title: "Media event",
      description: null,
      startAt: "2026-08-10T12:00:00.000Z",
      endAt: null,
      capacity: null,
      autoArchive: false,
      winnerCount: null,
      actorUserId: "admin-1",
      now: NOW,
      quotas: [],
      poll: null,
      mediaIds: ["media-create"],
      audit,
    });
    await expect(create(duplicate)).rejects.toThrow();
    expect(scalar(database, "SELECT count(*) FROM events WHERE id = 'event-media'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE entity_id = 'event-media'")).toBe(0);

    await create(eventAudit("create-ok", "event-media", "create"));
    expect(scalar(database, "SELECT count(*) FROM events WHERE id = 'event-media'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE entity_id = 'event-media'")).toBe(1);
  });
});

describe("SqliteEventsStore participant audit no-ops", () => {
  it("audits only participants changed by the same batch and skips all no-ops", async () => {
    const { database, store } = harness();
    database.prepare(`INSERT INTO events (
      id, type, title, start_at, end_at, created_by, created_at, updated_at
    ) VALUES ('participant-event', 'social', 'Participant event',
      '2027-08-10T12:00:00.000Z', '2027-08-11T12:00:00.000Z', 'admin-1', ?, ?)`).run(NOW, NOW);

    await store.addParticipants(
      "participant-event",
      ["user-1"],
      ["participant-1"],
      NOW,
      "moderator",
      participantAudit("participant-add-1", "participant-event", "user-1", "join"),
    );
    await store.addParticipants(
      "participant-event",
      ["user-1", "user-2"],
      ["participant-duplicate", "participant-2"],
      NOW,
      "moderator",
      participantAudit("participant-add-2", "participant-event", "user-1", "batch_add_by_moderator"),
    );
    await store.addParticipants(
      "participant-event",
      ["user-1", "user-2"],
      ["participant-noop-1", "participant-noop-2"],
      NOW,
      "moderator",
      participantAudit("participant-add-3", "participant-event", "user-1", "batch_add_by_moderator"),
    );
    expect(scalar(database, "SELECT count(*) FROM event_participants WHERE event_id = 'participant-event'")).toBe(2);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE action = 'batch_add_by_moderator'")).toBe(1);
    expect(auditContext(database, "participant-add-2", "user_count")).toEqual({ type: "number", value: 1 });
    expect(auditContext(database, "participant-add-2", "user_ids")).toEqual({
      type: "list",
      value: [{ type: "reference", value: { id: "user-2", label: "Two" } }],
    });

    await expect(store.removeParticipants(
      "participant-event",
      ["user-1", "admin-1"],
      participantAudit("participant-remove-1", "participant-event", "user-1", "batch_remove_by_moderator"),
    )).resolves.toBe(1);
    await expect(store.removeParticipants(
      "participant-event",
      ["user-1", "admin-1"],
      participantAudit("participant-remove-2", "participant-event", "user-1", "batch_remove_by_moderator"),
    )).resolves.toBe(0);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE action = 'batch_remove_by_moderator'")).toBe(1);
    expect(auditContext(database, "participant-remove-1", "user_count")).toEqual({ type: "number", value: 1 });
    expect(auditContext(database, "participant-remove-1", "user_ids")).toEqual({
      type: "list",
      value: [{ type: "reference", value: { id: "user-1", label: "One" } }],
    });
  });
});

describe("SqliteEventsStore recurring template catalog", () => {
  it("allows the 100th template", async () => {
    const { database, executor, store } = harness();
    seedTemplateCatalog(database, LIMITS.content.recurringTemplateCatalog.max - 1);

    await expect(store.createTemplate(templateWrite("catalog-100", templateAudit("catalog-100", "catalog-100"))))
      .resolves.toMatchObject({ template: { id: "catalog-100" } });

    await expect(store.listTemplates()).resolves.toHaveLength(LIMITS.content.recurringTemplateCatalog.max);
    expect(executor.batches.at(-1)?.length ?? 0).toBeLessThanOrEqual(50);
  });

  it("rejects the 101st template without child, media, or audit side effects", async () => {
    const { database, executor, store } = harness();
    seedTemplateCatalog(database, LIMITS.content.recurringTemplateCatalog.max);
    seedEventMedia(database, "catalog-101-media");
    const audit = templateAudit("catalog-101", "catalog-101");

    await expect(store.createTemplate({
      ...templateWrite("catalog-101", audit, ["catalog-101-media"]),
      recurrenceRule: { frequency: "weekly", interval: 1, daysOfWeek: [1] },
      quotas: [{
        tagId: "catalog-101-tag",
        required: 1,
        oneTime: { id: "catalog-101-tag", label: "Catalog tag", classIds: ["class-1"] },
      }],
    })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: `Recurring template catalog is limited to ${LIMITS.content.recurringTemplateCatalog.max} templates`,
    });

    expect(scalar(database, "SELECT count(*) FROM recurring_templates")).toBe(LIMITS.content.recurringTemplateCatalog.max);
    expect(scalar(database, "SELECT count(*) FROM recurring_template_weekdays WHERE template_id = 'catalog-101'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM class_tags WHERE id = 'catalog-101-tag'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE entity_id = 'catalog-101'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE id = ?", [audit.eventId])).toBe(0);
    expect(executor.batches.at(-1)?.length ?? 0).toBeLessThanOrEqual(50);
  });

  it("does not mutate an existing template when a full catalog rejects its duplicate id", async () => {
    const { database, store } = harness();
    seedTemplateCatalog(database, LIMITS.content.recurringTemplateCatalog.max);
    seedEventMedia(database, "catalog-existing-media");
    database.prepare(`INSERT INTO media_links (
      media_id, entity_type, entity_id, slot, audience, sort_order
    ) VALUES ('catalog-existing-media', 'recurring_template', 'catalog-000', 'attachment', 'private', 0)`).run();
    const audit = templateAudit("catalog-duplicate", "catalog-000");

    await expect(store.createTemplate(templateWrite("catalog-000", audit))).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: `Recurring template catalog is limited to ${LIMITS.content.recurringTemplateCatalog.max} templates`,
    });

    expect(scalar(database, "SELECT count(*) FROM recurring_templates")).toBe(LIMITS.content.recurringTemplateCatalog.max);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE entity_id = 'catalog-000'")).toBe(1);
    expect(scalar(database, "SELECT sort_order FROM media_links WHERE entity_id = 'catalog-000'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE id = ?", [audit.eventId])).toBe(0);
  });

  it("fails explicitly when persisted catalog data exceeds the limit", async () => {
    const { database, store } = harness(false);
    seedTemplateCatalog(database, LIMITS.content.recurringTemplateCatalog.max + 1);

    await expect(store.listTemplates()).rejects.toMatchObject({
      code: "SERVER_ERROR",
      status: 500,
      message: `Recurring template catalog data invariant violated: maximum is ${LIMITS.content.recurringTemplateCatalog.max}`,
    });
  });

  it("rolls back the template and media link when auditing fails", async () => {
    const { database, store } = harness();
    seedEventMedia(database, "template-media");
    const duplicate = templateAudit("template-duplicate", "template-media");
    database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, subject_type, subject_id, action, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        duplicate.eventId,
        duplicate.requestId,
        duplicate.actorKind,
        duplicate.actorId,
        duplicate.subjectType,
        duplicate.subjectId,
        duplicate.action,
        JSON.stringify(duplicate.payload),
        duplicate.occurredAt,
      );

    await expect(store.createTemplate(templateWrite("template-media", duplicate, ["template-media"]))).rejects.toThrow();

    expect(scalar(database, "SELECT count(*) FROM recurring_templates WHERE id = 'template-media'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE entity_id = 'template-media'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE id = ?", [duplicate.eventId])).toBe(1);
  });

  it("keeps published instances as independent snapshots when deleting a template", async () => {
    const { database, store } = harness();
    seedTemplate(database);
    database.prepare(`INSERT INTO events (
      id, type, title, description, start_at, capacity, created_by, series_id, instance_date, created_at, updated_at
    ) VALUES ('future-instance', 'social', 'Published title', 'Published detail',
      '2026-12-01T12:00:00.000Z', 25, 'admin-1', 'template-1', '2026-12-01', ?, ?)`)
      .run(NOW, NOW);

    await store.deleteTemplate("template-1", templateAudit("delete-template", "template-1"));

    expect(scalar(database, "SELECT count(*) FROM recurring_templates WHERE id = 'template-1'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM events WHERE id = 'future-instance'")).toBe(1);
    expect(text(database, "SELECT series_id FROM events WHERE id = 'future-instance'")).toBeNull();
    expect(text(database, "SELECT instance_date FROM events WHERE id = 'future-instance'")).toBeNull();
    expect(text(database, "SELECT title FROM events WHERE id = 'future-instance'")).toBe("Published title");
  });
});

describe("SqliteEventsStore statement budgets", () => {
  it("hydrates the 100-event, 20-quota, 200-class boundary with one row per quota", async () => {
    const { database, executor, store } = harness();
    const eventIds = Array.from(
      { length: LIMITS.pagination.events },
      (_, index) => `event-${String(index).padStart(3, "0")}`,
    );
    const classIds = Array.from(
      { length: LIMITS.content.classesPerTag.max },
      (_, index) => `class-${String(index).padStart(3, "0")}`,
    );
    const expectedQuotas = Array.from(
      { length: LIMITS.content.eventClassQuotas.max },
      (_, index) => ({
        tag_id: `tag-${String(index).padStart(2, "0")}`,
        label: `Tag ${index}`,
        class_ids: classIds,
        required: index + 1,
        one_time: false,
      }),
    );
    const insertEvent = database.prepare(`INSERT INTO events (
      id, type, title, start_at, created_by, created_at, updated_at
    ) VALUES (?, 'social', ?, ?, 'admin-1', ?, ?)`);
    const insertTag = database.prepare(
      "INSERT INTO class_tags (id, label, sort_order) VALUES (?, ?, ?)",
    );
    const insertMember = database.prepare(
      "INSERT INTO class_tag_members (tag_id, class_id) VALUES (?, ?)",
    );
    const insertQuota = database.prepare(
      "INSERT INTO event_class_quotas (event_id, tag_id, required) VALUES (?, ?, ?)",
    );

    database.exec("BEGIN");
    for (const [quotaIndex, quota] of expectedQuotas.entries()) {
      insertTag.run(quota.tag_id, quota.label, quotaIndex);
      for (const classId of classIds) insertMember.run(quota.tag_id, classId);
    }
    for (const eventId of eventIds) {
      insertEvent.run(eventId, eventId, NOW, NOW, NOW);
      for (const quota of expectedQuotas) insertQuota.run(eventId, quota.tag_id, quota.required);
    }
    database.exec("COMMIT");

    const aggregates = await store.getMany(eventIds);

    expect(aggregates).toHaveLength(LIMITS.pagination.events);
    for (const aggregate of aggregates) expect(aggregate.classQuotas).toEqual(expectedQuotas);
    const quotaRowLimit = LIMITS.pagination.events * LIMITS.content.eventClassQuotas.max;
    const memberRowLimit = LIMITS.content.classTags.max * LIMITS.content.classesPerTag.max;
    const quotaRead = executor.reads.find(({ sql }) => sql.includes("SELECT quotas.event_id AS owner_id"));
    const memberRead = executor.reads.find(({ sql }) => sql.includes("WITH involved_tags AS"));
    expect(quotaRead).toMatchObject({ rowCount: quotaRowLimit });
    expect(quotaRead?.params?.at(-1)).toBe(quotaRowLimit + 1);
    expect(memberRead).toMatchObject({
      rowCount: LIMITS.content.eventClassQuotas.max * LIMITS.content.classesPerTag.max,
    });
    expect(memberRead?.params?.at(-1)).toBe(memberRowLimit + 1);
    expect(executor.batches.at(-1)).toHaveLength(2);
    const sharedClassIds = aggregates[0]!.classQuotas[0]!.class_ids;
    for (const aggregate of aggregates) {
      expect(aggregate.classQuotas[0]!.class_ids).toBe(sharedClassIds);
    }
  });

  it("writes the maximum quota shape with a fixed-size SQL batch", async () => {
    const { executor, store } = harness();
    const quotas = Array.from({ length: 20 }, (_, quotaIndex) => ({
      tagId: `tag-${quotaIndex}`,
      required: 1,
      oneTime: {
        id: `tag-${quotaIndex}`,
        label: `Tag ${quotaIndex}`,
        classIds: Array.from({ length: 200 }, (_value, classIndex) => `class-${classIndex}`),
      },
    }));
    await store.create({
      id: "event-budget",
      type: "social",
      title: "Budget",
      description: null,
      startAt: "2026-08-10T12:00:00.000Z",
      endAt: null,
      capacity: null,
      autoArchive: false,
      winnerCount: null,
      actorUserId: "admin-1",
      now: NOW,
      quotas,
      poll: null,
      mediaIds: [],
      audit: eventAudit("event-budget", "event-budget", "create"),
    });
    expect(executor.batches.at(-1)?.length ?? 0).toBeLessThanOrEqual(10);
  });
});

describe("SqliteEventsStore recurrence materialization", () => {
  it("replays a bounded batch, honors endAfter, and is idempotent", async () => {
    const { database, store } = harness();
    seedTemplate(database, { endAfter: 2 });
    const first = await store.materializeDue(NOW, "template-1", auditFactory("first"));
    const second = await store.materializeDue(NOW, "template-1", auditFactory("second"));
    expect(first[0]?.createdEventIds).toHaveLength(1);
    expect(second).toEqual([]);
    expect(scalar(database, "SELECT count(*) FROM events WHERE series_id = 'template-1'")).toBe(1);
    expect(scalar(database, "SELECT generation_count FROM recurring_templates WHERE id = 'template-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'event'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'recurring_template' AND action = 'update'")).toBe(1);
    expect(text(database, "SELECT actor_label FROM audit_log WHERE subject_type = 'event' LIMIT 1")).toBe("Admin");
  });

  it("starts an ungenerated old template from today instead of backfilling history", async () => {
    const { database, store } = harness();
    seedTemplate(database, { endAfter: 1 });

    await store.materializeDue(NOW, "template-1", auditFactory("old-template"));

    expect(text(database, "SELECT instance_date FROM events WHERE series_id = 'template-1'")).toBe("2026-08-09");
    expect(scalar(database, "SELECT count(*) FROM events WHERE start_at < '2026-08-09T00:00:00.000Z'")).toBe(0);
  });

  it("advances the cursor without recounting existing instances", async () => {
    const { database, store } = harness();
    seedTemplate(database, { endAfter: 2 });
    await store.materializeDue(NOW, "template-1", auditFactory("seed"));
    database.prepare("UPDATE recurring_templates SET last_generated_date = NULL, generation_count = 0 WHERE id = 'template-1'").run();
    database.prepare("DELETE FROM audit_log").run();

    const replay = await store.materializeDue(NOW, "template-1", auditFactory("cursor-only"));

    expect(replay[0]).toMatchObject({ createdEventIds: [] });
    expect(scalar(database, "SELECT generation_count FROM recurring_templates WHERE id = 'template-1'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'event'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'recurring_template' AND action = 'update'")).toBe(1);
    expect(auditChanges(database, "recurring_template")).toEqual([
      { field: "last_generated_date", before: { type: "null", value: null }, after: { type: "date", value: "2026-08-09" } },
    ]);
  });

  it("keeps each template catch-up at ten occurrences and includes the end date", async () => {
    const { database, executor, store } = harness();
    seedTemplate(database, { id: "bounded", visibilityOffsetMinutes: 60 * 24 * 30 });
    seedTemplate(database, {
      id: "ended",
      endAt: "2026-08-10T23:59:59.999Z",
      visibilityOffsetMinutes: 60 * 24 * 2,
    });
    const bounded = await store.materializeDue(NOW, "bounded", auditFactory("bounded"));
    const ended = await store.materializeDue(NOW, "ended", auditFactory("ended"));
    expect(bounded[0]?.createdEventIds).toHaveLength(10);
    expect(ended[0]?.createdEventIds).toHaveLength(2);
    expect(text(database, "SELECT max(instance_date) FROM events WHERE series_id = 'ended'")).toBe("2026-08-10");
    expect(executor.batches.at(-1)?.length ?? 0).toBeLessThanOrEqual(8);
  });

  it("uses generation CAS so concurrent replays create and audit each occurrence once", async () => {
    const { database, store } = harness();
    seedTemplate(database, { endAfter: 1 });
    const outcomes = await Promise.all([
      store.materializeDue(NOW, "template-1", auditFactory("race-a")),
      store.materializeDue(NOW, "template-1", auditFactory("race-b")),
    ]);
    expect(outcomes.flatMap((rows) => rows).flatMap(({ createdEventIds }) => createdEventIds)).toHaveLength(1);
    expect(scalar(database, "SELECT count(*) FROM events WHERE series_id = 'template-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'event'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'recurring_template'")).toBe(1);
  });

  it("abandons a stale materialization when template metadata changes before its CAS", async () => {
    const { database, executor, store } = harness();
    seedTemplate(database, { endAfter: 1 });
    executor.beforeNextBatch = () => {
      database.prepare("UPDATE recurring_templates SET title = ?, updated_at = ? WHERE id = ?")
        .run("Changed title", NOW, "template-1");
    };

    await expect(store.materializeDue(NOW, "template-1", auditFactory("stale"))).resolves.toEqual([]);
    expect(scalar(database, "SELECT count(*) FROM events WHERE series_id = 'template-1'")).toBe(0);
    expect(scalar(database, "SELECT generation_count FROM recurring_templates WHERE id = 'template-1'")).toBe(0);

    const retry = await store.materializeDue(NOW, "template-1", auditFactory("fresh"));
    expect(retry[0]?.createdEventIds).toHaveLength(1);
    expect(text(database, "SELECT title FROM events WHERE series_id = 'template-1'")).toBe("Changed title");
  });

  it("does not claim a recurring event inserted after planning but before the materialization batch", async () => {
    const { database, executor, store } = harness();
    seedTemplate(database, { endAfter: 1 });
    let plannedEventId = "";
    let occurrenceAuditId = "";
    executor.beforeNextBatch = () => {
      database.prepare(`INSERT INTO events (
        id, type, title, start_at, created_by, series_id, instance_date, created_at, updated_at
      ) VALUES (?, 'social', 'Concurrent event', '2026-08-09T12:00:00.000Z',
        'admin-1', 'template-1', '2026-08-09', ?, ?)`).run(plannedEventId, NOW, NOW);
    };

    const materialized = await store.materializeDue(NOW, "template-1", (input) => {
      const audit = createAuditEvent(context(`concurrent:${input.subjectType}`), input);
      if (input.subjectType === "event") {
        plannedEventId = input.subjectId;
        occurrenceAuditId = audit.eventId;
      }
      return audit;
    });

    expect(materialized[0]).toEqual({
      templateId: "template-1",
      eventIds: [plannedEventId],
      createdEventIds: [],
    });
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE id = ?", [occurrenceAuditId])).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'event'")).toBe(0);
    expect(scalar(database, "SELECT generation_count FROM recurring_templates WHERE id = 'template-1'")).toBe(0);
  });

  it("advances a bounded keyset window so templates beyond the first batch are not starved", async () => {
    const { database, store } = harness();
    for (let index = 0; index < 26; index += 1) {
      seedTemplate(database, { id: `template-${String(index).padStart(2, "0")}`, endAfter: 1 });
    }
    const first = await store.materializeDueBatch(NOW, null, 25, 1, auditFactory("window-1"));
    const nextQuarter = new Date(Date.parse(NOW) + 15 * 60_000).toISOString();
    const second = await store.materializeDueBatch(
      nextQuarter,
      first.nextTemplateCursor,
      25,
      1,
      auditFactory("window-2"),
    );
    expect(first).toMatchObject({ inspected: 25, hasMore: true });
    expect(first.nextTemplateCursor).toBe("template-24");
    expect(second).toMatchObject({ inspected: 1, hasMore: false, nextTemplateCursor: null });
    expect(scalar(database, "SELECT count(*) FROM events")).toBe(26);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'event'")).toBe(26);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE subject_type = 'recurring_template'")).toBe(26);
  });

  it("rolls back parent, shared media links, and generation when an audit in the batch fails", async () => {
    const { database, store } = harness();
    seedTemplate(database, { endAfter: 2 });
    database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, state, created_at, updated_at
    ) VALUES ('media-1', 'admin-1', 'event_image', 'attached', ?, ?)`)
      .run(NOW, NOW);
    database.prepare(`INSERT INTO media_links (
      media_id, entity_type, entity_id, slot, audience, sort_order
    ) VALUES ('media-1', 'recurring_template', 'template-1', 'attachment', 'private', 0)`).run();
    const duplicateAudit = eventAudit("duplicate", "generated", "create");
    database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, subject_type, subject_id, action, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        duplicateAudit.eventId,
        duplicateAudit.requestId,
        duplicateAudit.actorKind,
        duplicateAudit.actorId,
        duplicateAudit.subjectType,
        duplicateAudit.subjectId,
        duplicateAudit.action,
        JSON.stringify(duplicateAudit.payload),
        duplicateAudit.occurredAt,
      );
    let sequence = 0;
    await expect(store.materializeDue(NOW, "template-1", (input) => input.subjectType === "recurring_template"
      ? { ...createAuditEvent(context("template-failure"), input), eventId: duplicateAudit.eventId }
      : createAuditEvent(context(`event-success-${++sequence}`), input))).rejects.toThrow();
    expect(scalar(database, "SELECT count(*) FROM events WHERE series_id = 'template-1'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE entity_type = 'event'")).toBe(0);
    expect(scalar(database, "SELECT generation_count FROM recurring_templates WHERE id = 'template-1'")).toBe(0);
    expect(scalar(database, `SELECT count(*) FROM audit_log
      WHERE request_id LIKE 'event-success-%' OR request_id = 'template-failure'`)).toBe(0);

    await store.materializeDue(NOW, "template-1", auditFactory("retry"));
    expect(scalar(database, "SELECT count(*) FROM events WHERE series_id = 'template-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE entity_type = 'event'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM media_links WHERE media_id = 'media-1'")).toBe(2);
  });

  it("uses stable keyset and event-list indexes", () => {
    const { database } = harness();
    expect(plan(database, "SELECT id FROM recurring_templates WHERE paused = 0 AND id > ? ORDER BY id LIMIT 25", "template-0"))
      .toContain("idx_recurring_templates_active");
    expect(plan(database, "SELECT id FROM events ORDER BY start_at, id LIMIT 50"))
      .toContain("idx_events_list_start");
  });
});

function scalar(database: DatabaseSync, sql: string, params: readonly SQLInputValue[] = []): number {
  const row = database.prepare(sql).get(...params) as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function text(database: DatabaseSync, sql: string): string | null {
  const row = database.prepare(sql).get() as Record<string, string | null>;
  return Object.values(row)[0] ?? null;
}

function auditContext(database: DatabaseSync, requestId: string, field: string): unknown {
  const payload = JSON.parse(text(database, `SELECT payload_json FROM audit_log WHERE request_id = '${requestId}'`) ?? "null") as {
    context: Array<{ field: string; value: unknown }>;
  };
  return payload.context.find((entry) => entry.field === field)?.value;
}

function auditChanges(database: DatabaseSync, subjectType: string): unknown[] {
  const payload = JSON.parse(text(database, `SELECT payload_json FROM audit_log WHERE subject_type = '${subjectType}'`) ?? "null") as {
    changes: unknown[];
  };
  return payload.changes;
}

function plan(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): string {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map(({ detail }) => detail).join("\n");
}
