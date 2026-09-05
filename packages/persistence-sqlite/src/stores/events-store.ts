import {
  and,
  asc,
  eq,
  gte,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql as dsql,
  type SQL,
} from "drizzle-orm";
import { AppError } from "@guild/kernel";
import { LIMITS } from "@guild/shared";
import {
  computeNextOccurrenceFromCursor,
  recurrenceCursorBefore,
} from "@guild/shared/utils/recurrence";
import type {
  EventAggregate,
  EventCreateWrite,
  EventListQuery,
  EventListResult,
  EventMediaPort,
  MaterializationAuditFactory,
  EventPollRecord,
  EventQuotaWrite,
  EventRecord,
  EventsStore,
  EventUpdateWrite,
  EventVisibilityScope,
  PollWrite,
  RecurrenceMaterialization,
  RecurringTemplateAggregate,
  RecurringTemplateRecord,
  TemplateCreateWrite,
  TemplateUpdateWrite,
} from "@guild/server/modules/events";
import { monotonicTimestamp } from "@guild/server/modules/events";
import type { AppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlReadBatchStatement, SqlResult, SqlRow, SqlValue } from "@guild/kernel";
import {
  eventClassQuotas,
  eventParticipants,
  eventPollOptions,
  eventPolls,
  eventPollVotes,
  eventRaffleDraws,
  eventRaffleWinners,
  events,
  recurringTemplateClassQuotas,
  recurringTemplates,
  recurringTemplateWeekdays,
} from "../schema/events.js";
import { users } from "../schema/auth.js";
import { classTagMembers, classTags } from "../schema/members.js";
import { auditInsertSelectStatement, auditInsertStatement } from "./audit-statement.js";
import { assertMediaAttachments, replaceMediaLinksStatements } from "./media-link-statements.js";
import { returnedRowCount, returnedRows } from "./sql-result.js";

type EventsSchema = {
  events: typeof events;
  recurringTemplates: typeof recurringTemplates;
  recurringTemplateWeekdays: typeof recurringTemplateWeekdays;
  eventClassQuotas: typeof eventClassQuotas;
  recurringTemplateClassQuotas: typeof recurringTemplateClassQuotas;
  eventParticipants: typeof eventParticipants;
  eventPolls: typeof eventPolls;
  eventPollOptions: typeof eventPollOptions;
  eventPollVotes: typeof eventPollVotes;
  eventRaffleDraws: typeof eventRaffleDraws;
  eventRaffleWinners: typeof eventRaffleWinners;
  classTags: typeof classTags;
  classTagMembers: typeof classTagMembers;
  users: typeof users;
};

const EVENT_FIELDS = {
  id: events.id,
  type: events.type,
  title: events.title,
  description: events.description,
  startAt: events.startAt,
  endAt: events.endAt,
  capacity: events.capacity,
  pinned: events.pinned,
  signupLocked: events.signupLocked,
  autoArchive: events.autoArchive,
  autoArchived: events.autoArchived,
  visibleAt: events.visibleAt,
  archivedAt: events.archivedAt,
  createdBy: events.createdBy,
  updatedBy: events.updatedBy,
  seriesId: events.seriesId,
  instanceDate: events.instanceDate,
  winnerCount: events.winnerCount,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

const TEMPLATE_FIELDS = {
  id: recurringTemplates.id,
  type: recurringTemplates.type,
  title: recurringTemplates.title,
  description: recurringTemplates.description,
  startTime: recurringTemplates.startTime,
  durationMinutes: recurringTemplates.durationMinutes,
  capacity: recurringTemplates.capacity,
  recurrenceFrequency: recurringTemplates.recurrenceFrequency,
  recurrenceInterval: recurringTemplates.recurrenceInterval,
  recurrenceDayOfMonth: recurringTemplates.recurrenceDayOfMonth,
  recurrenceEndAfter: recurringTemplates.recurrenceEndAfter,
  recurrenceEndAt: recurringTemplates.recurrenceEndAt,
  visibilityOffsetMinutes: recurringTemplates.visibilityOffsetMinutes,
  autoArchive: recurringTemplates.autoArchive,
  paused: recurringTemplates.paused,
  createdBy: recurringTemplates.createdBy,
  lastGeneratedDate: recurringTemplates.lastGeneratedDate,
  generationCount: recurringTemplates.generationCount,
  createdAt: recurringTemplates.createdAt,
  updatedAt: recurringTemplates.updatedAt,
};

const EVENT_SNAPSHOT_COLUMNS = [
  "id",
  "type",
  "title",
  "description",
  "startAt",
  "endAt",
  "capacity",
  "pinned",
  "signupLocked",
  "autoArchive",
  "autoArchived",
  "visibleAt",
  "archivedAt",
  "createdBy",
  "updatedBy",
  "seriesId",
  "instanceDate",
  "winnerCount",
  "createdAt",
  "updatedAt",
] as const;

const TEMPLATE_SNAPSHOT_COLUMNS = [
  "id",
  "type",
  "title",
  "description",
  "startTime",
  "durationMinutes",
  "capacity",
  "recurrenceFrequency",
  "recurrenceInterval",
  "recurrenceDayOfMonth",
  "recurrenceEndAfter",
  "recurrenceEndAt",
  "visibilityOffsetMinutes",
  "autoArchive",
  "paused",
  "createdBy",
  "lastGeneratedDate",
  "generationCount",
  "createdAt",
  "updatedAt",
] as const;

type HydratedPollRow = Readonly<{
  eventId: string;
  resultsVisibility: EventPollRecord["resultsVisibility"];
  showVoterNames: boolean;
  optionId: string;
  label: string;
  sortOrder: number;
  voterId: string | null;
}>;

type HydratedWinnerRow = Readonly<{ id: string; eventId: string; userId: string; drawnAt: string }>;
type HydratedParticipantRow = Readonly<{ id: string; eventId: string; userId: string; joinedAt: string }>;

const MATERIALIZE_TEMPLATE_BATCH = 25;
const MATERIALIZE_OCCURRENCES_PER_TEMPLATE = 10;
const RECURRING_TEMPLATE_CATALOG_LIMIT_ERROR = "recurring template catalog limit reached";
const CLASS_TAG_MEMBER_ROW_LIMIT = LIMITS.content.classTags.max * LIMITS.content.classesPerTag.max;

type EventRow = typeof events.$inferSelect;
type TemplateRow = typeof recurringTemplates.$inferSelect;
type SqlGuard = Readonly<{ sql: string; params: readonly SqlValue[] }>;

function failure(
  code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "SERVER_ERROR",
  status: 400 | 404 | 409 | 500,
  message: string,
  cause?: unknown,
): AppError {
  return new AppError({ code, status, message, ...(cause === undefined ? {} : { cause }) });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function sqlRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw failure("SERVER_ERROR", 500, "SQLite returned invalid rows");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function eventMediaTarget(
  actorUserId: string,
  entityType: "event" | "recurring_template",
  entityId: string,
  audience: "public" | "private",
  mediaIds: readonly string[],
) {
  return {
    actorUserId,
    entityType,
    entityId,
    slot: "attachment" as const,
    purpose: "event_image" as const,
    audience,
    mediaIds,
    maxItems: LIMITS.content.eventAttachments.max,
  };
}

function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    startAt: row.startAt,
    endAt: row.endAt,
    capacity: row.capacity,
    pinned: row.pinned,
    signupLocked: row.signupLocked,
    autoArchive: row.autoArchive,
    autoArchived: row.autoArchived,
    visibleAt: row.visibleAt,
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    seriesId: row.seriesId,
    instanceDate: row.instanceDate,
    winnerCount: row.winnerCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function recurrenceRule(
  row: TemplateRow,
  weekdays: readonly number[],
): RecurringTemplateRecord["recurrenceRule"] {
  const end = {
    ...(row.recurrenceEndAfter === null ? {} : { endAfter: row.recurrenceEndAfter }),
    ...(row.recurrenceEndAt === null ? {} : { endDate: row.recurrenceEndAt }),
  };
  if (row.recurrenceFrequency === "daily") {
    return { frequency: "daily", interval: row.recurrenceInterval, ...end };
  }
  if (row.recurrenceFrequency === "weekly") {
    return { frequency: "weekly", interval: row.recurrenceInterval, daysOfWeek: [...weekdays], ...end };
  }
  return {
    frequency: "monthly",
    interval: row.recurrenceInterval,
    dayOfMonth: row.recurrenceDayOfMonth ?? 1,
    ...end,
  };
}

function recurrenceColumns(rule: RecurringTemplateRecord["recurrenceRule"]): Record<string, SqlValue> {
  return {
    recurrence_frequency: rule.frequency,
    recurrence_interval: rule.interval,
    recurrence_day_of_month: rule.frequency === "monthly" ? rule.dayOfMonth : null,
    recurrence_end_after: rule.endAfter ?? null,
    recurrence_end_at: rule.endDate ?? null,
  };
}

function booleanValue(value: boolean): number {
  return value ? 1 : 0;
}

function snapshotString(row: SqlRow, index: number, label: string): string {
  const value = row[index];
  if (typeof value !== "string") throw failure("SERVER_ERROR", 500, `SQLite returned invalid ${label} snapshot value`);
  return value;
}

function snapshotNullableString(row: SqlRow, index: number, label: string): string | null {
  const value = row[index];
  if (value === null) return null;
  return snapshotString(row, index, label);
}

function snapshotNullableInteger(row: SqlRow, index: number, label: string): number | null {
  const value = row[index];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw failure("SERVER_ERROR", 500, `SQLite returned invalid ${label} snapshot value`);
  }
  return value;
}

function snapshotInteger(row: SqlRow, index: number, label: string): number {
  const value = snapshotNullableInteger(row, index, label);
  if (value === null) throw failure("SERVER_ERROR", 500, `SQLite returned invalid ${label} snapshot value`);
  return value;
}

function snapshotBoolean(row: SqlRow, index: number, label: string): boolean {
  const value = row[index];
  if (value === 0) return false;
  if (value === 1) return true;
  throw failure("SERVER_ERROR", 500, `SQLite returned invalid ${label} snapshot value`);
}

function eventRowFromSnapshot(row: SqlRow): EventRow {
  return {
    id: snapshotString(row, 0, "event id"),
    type: snapshotString(row, 1, "event type") as EventRow["type"],
    title: snapshotString(row, 2, "event title"),
    description: snapshotNullableString(row, 3, "event description"),
    startAt: snapshotString(row, 4, "event start time"),
    endAt: snapshotNullableString(row, 5, "event end time"),
    capacity: snapshotNullableInteger(row, 6, "event capacity"),
    pinned: snapshotBoolean(row, 7, "event pinned"),
    signupLocked: snapshotBoolean(row, 8, "event signup lock"),
    autoArchive: snapshotBoolean(row, 9, "event auto archive"),
    autoArchived: snapshotBoolean(row, 10, "event auto archived"),
    visibleAt: snapshotNullableString(row, 11, "event visibility time"),
    archivedAt: snapshotNullableString(row, 12, "event archive time"),
    createdBy: snapshotString(row, 13, "event creator"),
    updatedBy: snapshotNullableString(row, 14, "event updater"),
    seriesId: snapshotNullableString(row, 15, "event series"),
    instanceDate: snapshotNullableString(row, 16, "event instance date"),
    winnerCount: snapshotNullableInteger(row, 17, "event winner count"),
    createdAt: snapshotString(row, 18, "event created time"),
    updatedAt: snapshotString(row, 19, "event updated time"),
  };
}

function templateRowFromSnapshot(row: SqlRow): TemplateRow {
  const recurrenceFrequency = snapshotString(row, 7, "template recurrence frequency");
  if (recurrenceFrequency !== "daily" && recurrenceFrequency !== "weekly" && recurrenceFrequency !== "monthly") {
    throw failure("SERVER_ERROR", 500, "SQLite returned invalid template recurrence frequency");
  }
  return {
    id: snapshotString(row, 0, "template id"),
    type: snapshotString(row, 1, "template type") as TemplateRow["type"],
    title: snapshotString(row, 2, "template title"),
    description: snapshotNullableString(row, 3, "template description"),
    startTime: snapshotString(row, 4, "template start time"),
    durationMinutes: snapshotNullableInteger(row, 5, "template duration"),
    capacity: snapshotNullableInteger(row, 6, "template capacity"),
    recurrenceFrequency,
    recurrenceInterval: snapshotInteger(row, 8, "template recurrence interval"),
    recurrenceDayOfMonth: snapshotNullableInteger(row, 9, "template recurrence day"),
    recurrenceEndAfter: snapshotNullableInteger(row, 10, "template recurrence end count"),
    recurrenceEndAt: snapshotNullableString(row, 11, "template recurrence end time"),
    visibilityOffsetMinutes: snapshotInteger(row, 12, "template visibility offset"),
    autoArchive: snapshotBoolean(row, 13, "template auto archive"),
    paused: snapshotBoolean(row, 14, "template paused"),
    createdBy: snapshotString(row, 15, "template creator"),
    lastGeneratedDate: snapshotNullableString(row, 16, "template generation date"),
    generationCount: snapshotInteger(row, 17, "template generation count"),
    createdAt: snapshotString(row, 18, "template created time"),
    updatedAt: snapshotString(row, 19, "template updated time"),
  };
}

function pollRowsFromSnapshot(rows: readonly SqlRow[]): readonly HydratedPollRow[] {
  return rows.map((row) => {
    const resultsVisibility = snapshotString(row, 1, "poll results visibility");
    if (resultsVisibility !== "always" && resultsVisibility !== "after_vote" && resultsVisibility !== "after_close") {
      throw failure("SERVER_ERROR", 500, "SQLite returned invalid poll results visibility");
    }
    return {
      eventId: snapshotString(row, 0, "poll event id"),
      resultsVisibility,
      showVoterNames: snapshotBoolean(row, 2, "poll voter visibility"),
      optionId: snapshotString(row, 3, "poll option id"),
      label: snapshotString(row, 4, "poll option label"),
      sortOrder: snapshotInteger(row, 5, "poll option order"),
      voterId: snapshotNullableString(row, 6, "poll voter id"),
    };
  });
}

function winnerRowsFromSnapshot(rows: readonly SqlRow[]): readonly HydratedWinnerRow[] {
  return rows.map((row) => ({
    id: snapshotString(row, 0, "raffle winner id"),
    eventId: snapshotString(row, 1, "raffle winner event id"),
    userId: snapshotString(row, 2, "raffle winner user id"),
    drawnAt: snapshotString(row, 3, "raffle winner draw time"),
  }));
}

function participantRowsFromSnapshot(rows: readonly SqlRow[]): readonly HydratedParticipantRow[] {
  return rows.map((row) => ({
    id: snapshotString(row, 0, "event participant id"),
    eventId: snapshotString(row, 1, "event participant event id"),
    userId: snapshotString(row, 2, "event participant user id"),
    joinedAt: snapshotString(row, 3, "event participant joined time"),
  }));
}

function participantAuditStatement(
  audit: EventUpdateWrite["audit"],
  eventId: string,
  requestedJson: string,
  phase: "added" | "removing",
  guard?: SqlGuard,
): SqlBatchStatement {
  const actualJoin = phase === "added"
    ? `participant.id = requested.participant_id
      AND participant.event_id = ?
      AND participant.user_id = requested.user_id`
    : `participant.event_id = ?
      AND participant.user_id = requested.user_id`;
  return auditInsertSelectStatement(
    `WITH requested AS (
        SELECT CAST(key AS INTEGER) AS ordinal,
          CAST(json_extract(value, '$.participantId') AS TEXT) AS participant_id,
          CAST(json_extract(value, '$.userId') AS TEXT) AS user_id
        FROM json_each(?)
      ), actual_payload AS (
        SELECT count(*) AS user_count,
          json_group_array(json_object(
            'type', 'reference',
            'value', json_object('id', user_id, 'label', display_name)
          )) AS value
        FROM (
          SELECT requested.ordinal, requested.user_id,
            (SELECT display_name FROM users WHERE users.id = requested.user_id) AS display_name
          FROM requested
          JOIN event_participants AS participant ON ${actualJoin}
          ORDER BY requested.ordinal
        )
      )
      SELECT ?, ?, ?, ?,
        CASE WHEN ? = 'user' THEN (SELECT display_name FROM users WHERE id = ?) ELSE ? END,
        ?, ?, ?, ?,
        json_set(json_set(
          json(?), '$.context[#]',
          json_object(
            'field', 'user_count',
            'value', json_object('type', 'number', 'value', actual_payload.user_count)
          )
        ),
          '$.context[#]',
          json_object(
            'field', 'user_ids',
            'value', json_object('type', 'list', 'value', json(actual_payload.value))
          )
        ), ?
      FROM actual_payload
      WHERE json_array_length(actual_payload.value) > 0${guard ? `
        AND EXISTS (${guard.sql})` : ""}`,
    [
      requestedJson,
      eventId,
      audit.eventId,
      audit.requestId,
      audit.actorKind,
      audit.actorId,
      audit.actorKind,
      audit.actorId,
      audit.actorLabel,
      audit.subjectType,
      audit.subjectId,
      audit.subjectLabel,
      audit.action,
      JSON.stringify(audit.payload),
      audit.occurredAt,
      ...(guard ? guard.params : []),
    ],
  );
}

function raffleAuditStatement(
  audit: EventUpdateWrite["audit"],
  eventId: string,
  requestedJson: string,
  eventGuard?: SqlGuard,
): SqlBatchStatement {
  return auditInsertSelectStatement(
    `WITH requested AS (
        SELECT CAST(key AS INTEGER) AS ordinal,
          CAST(json_extract(value, '$.userId') AS TEXT) AS user_id
        FROM json_each(?)
      ), actual_payload AS (
        SELECT count(*) AS winner_count,
          json_group_array(json_object(
            'type', 'reference',
            'value', json_object('id', user_id, 'label', display_name)
          )) AS value
        FROM (
          SELECT requested.ordinal, requested.user_id, users.display_name
          FROM requested
          JOIN event_raffle_winners AS winner
            ON winner.event_id = ? AND winner.user_id = requested.user_id
          JOIN users ON users.id = requested.user_id
          ORDER BY requested.ordinal
        )
      )
      SELECT ?, ?, ?, ?,
        CASE WHEN ? = 'user' THEN (SELECT display_name FROM users WHERE id = ?) ELSE ? END,
        ?, ?, ?, ?,
        json_set(json_set(
          json(?), '$.context[#]',
          json_object(
            'field', 'winner_count',
            'value', json_object('type', 'number', 'value', actual_payload.winner_count)
          )
        ), '$.context[#]',
          json_object(
            'field', 'winner_user_ids',
            'value', json_object('type', 'list', 'value', json(actual_payload.value))
          )
        ), ?
      FROM actual_payload
      WHERE actual_payload.winner_count > 0
        AND EXISTS (
          SELECT 1 FROM event_raffle_draws WHERE event_id = ? AND mutation_token = ?
        )${eventGuard ? `
        AND EXISTS (${eventGuard.sql})` : ""}`,
    [
      requestedJson,
      eventId,
      audit.eventId,
      audit.requestId,
      audit.actorKind,
      audit.actorId,
      audit.actorKind,
      audit.actorId,
      audit.actorLabel,
      audit.subjectType,
      audit.subjectId,
      audit.subjectLabel,
      audit.action,
      JSON.stringify(audit.payload),
      audit.occurredAt,
      eventId,
      audit.eventId,
      ...(eventGuard ? eventGuard.params : []),
    ],
  );
}

function parseStartTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

export class SqliteEventMediaPort implements EventMediaPort {
  constructor(private readonly sql: SqlExecutor) {}

  async list(
    entityType: "event" | "recurring_template",
    entityIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const ids = [...new Set(entityIds)];
    if (ids.length === 0) return new Map();
    const targetLimit = LIMITS.pagination.events;
    if (ids.length > targetLimit) {
      throw new RangeError(`Event media reads support at most ${targetLimit} targets`);
    }
    const result = await this.sql.read({
      method: "all",
      sql: `SELECT entity_id, media_id
        FROM media_links
        WHERE entity_type = ? AND slot = 'attachment'
          AND entity_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        ORDER BY entity_id, sort_order, media_id`,
      params: [entityType, JSON.stringify(ids)],
    });
    const byTarget = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const row of sqlRows(result)) {
      const [entityId, mediaId] = row;
      if (typeof entityId !== "string" || typeof mediaId !== "string") {
        throw failure("SERVER_ERROR", 500, "Invalid event media projection");
      }
      byTarget.get(entityId)?.push(mediaId);
    }
    return byTarget;
  }

}

export class SqliteEventsStore implements EventsStore {
  constructor(
    private readonly db: AppDatabase<EventsSchema>,
    private readonly sql: SqlExecutor,
  ) {}

  async list(query: EventListQuery, visibility: EventVisibilityScope): Promise<EventListResult> {
    const conditions: SQL<unknown>[] = [];
    if (visibility.visibleAtOrBefore !== null) {
      const publicCondition = or(
        isNull(events.visibleAt),
        lte(events.visibleAt, visibility.visibleAtOrBefore),
        ...(visibility.includeHiddenGuildWars ? [eq(events.type, "guild_war")] : []),
      );
      if (publicCondition) conditions.push(publicCondition);
    }
    if (query.type) conditions.push(eq(events.type, query.type as EventRow["type"]));
    if (query.archived === true) conditions.push(isNotNull(events.archivedAt));
    if (query.archived === false) conditions.push(isNull(events.archivedAt));
    if (query.pinned !== undefined) conditions.push(eq(events.pinned, query.pinned));
    if (query.locked !== undefined) conditions.push(eq(events.signupLocked, query.locked));
    if (query.startAfter) conditions.push(gte(events.startAt, query.startAfter));
    if (query.startBefore) conditions.push(lte(events.startAt, query.startBefore));
    if (query.search?.trim()) {
      const pattern = `%${escapeLike(query.search.trim().toLowerCase())}%`;
      const search = or(
        dsql`lower(${events.title}) LIKE ${pattern} ESCAPE '\\'`,
        dsql`lower(coalesce(${events.description}, '')) LIKE ${pattern} ESCAPE '\\'`,
      );
      if (search) conditions.push(search);
    }
    const where = conditions.length === 0 ? undefined : and(...conditions);
    const offset = (query.page - 1) * query.limit;
    const [rows, countRows] = await Promise.all([
      this.db.select(EVENT_FIELDS).from(events).where(where).orderBy(asc(events.startAt), asc(events.id)).limit(query.limit).offset(offset),
      this.db.select({ count: dsql<number>`count(*)` }).from(events).where(where),
    ]);
    const data = await this.hydrateEvents(rows, false);
    const total = Number(countRows[0]?.count ?? 0);
    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async get(eventId: string, includeParticipants = false): Promise<EventAggregate | null> {
    const row = (await this.db.select(EVENT_FIELDS).from(events).where(eq(events.id, eventId)).limit(1))[0];
    if (!row) return null;
    return (await this.hydrateEvents([row], includeParticipants))[0] ?? null;
  }

  async getMany(eventIds: readonly string[], includeParticipants = false): Promise<readonly EventAggregate[]> {
    const ids = [...new Set(eventIds)];
    if (ids.length === 0) return [];
    const rows = await this.db.select(EVENT_FIELDS).from(events).where(inArray(events.id, ids));
    const hydrated = await this.hydrateEvents(rows, includeParticipants);
    const byId = new Map(hydrated.map((event) => [event.event.id, event]));
    return ids.flatMap((id) => {
      const event = byId.get(id);
      return event ? [event] : [];
    });
  }

  async create(input: EventCreateWrite): Promise<EventAggregate> {
    await assertMediaAttachments(this.sql, eventMediaTarget(
      input.actorUserId,
      "event",
      input.id,
      "public",
      input.mediaIds,
    ));
    const statements: SqlBatchStatement[] = [{
      method: "run",
      sql: `INSERT INTO events (
        id, type, title, description, start_at, end_at, capacity, auto_archive,
        winner_count, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.id,
        input.type,
        input.title,
        input.description,
        input.startAt,
        input.endAt,
        input.capacity,
        booleanValue(input.autoArchive),
        input.winnerCount,
        input.actorUserId,
        input.now,
        input.now,
      ],
    }];
    statements.push(...this.quotaStatements("event", input.id, input.quotas));
    if (input.poll) statements.push(...this.pollInsertStatements(input.id, input.poll, input.now));
    statements.push(...replaceMediaLinksStatements({
      entityType: "event",
      entityId: input.id,
      slot: "attachment",
      audience: "public",
      mediaIds: input.mediaIds,
    }, { sql: "SELECT 1 FROM events WHERE id = ?", params: [input.id] }));
    statements.push(auditInsertStatement(input.audit));
    const snapshotOffset = statements.length;
    statements.push(...this.eventSnapshotStatements(input.id, true, input.now));
    const created = this.eventSnapshotFromResults(
      (await this.sql.batch(statements)).slice(snapshotOffset),
      true,
    );
    if (!created) throw failure("SERVER_ERROR", 500, "Failed to load created event");
    return created;
  }

  async update(input: EventUpdateWrite): Promise<EventAggregate> {
    if (input.mediaIds) {
      await assertMediaAttachments(this.sql, eventMediaTarget(
        input.actorUserId,
        "event",
        input.eventId,
        "public",
        input.mediaIds,
      ));
    }
    const assignments: string[] = [];
    const params: SqlValue[] = [];
    const add = (column: string, value: SqlValue): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };
    for (const [key, value] of Object.entries(input.patch)) {
      if (key === "type") add("type", value as string);
      else if (key === "title") add("title", value as string);
      else if (key === "description") add("description", value as string | null);
      else if (key === "startAt") add("start_at", value as string);
      else if (key === "endAt") add("end_at", value as string | null);
      else if (key === "capacity") add("capacity", value as number | null);
      else if (key === "pinned") add("pinned", booleanValue(value as boolean));
      else if (key === "signupLocked") add("signup_locked", booleanValue(value as boolean));
      else if (key === "autoArchive") add("auto_archive", booleanValue(value as boolean));
      else if (key === "archivedAt") add("archived_at", value as string | null);
      else if (key === "winnerCount") add("winner_count", value as number | null);
    }
    add("updated_by", input.actorUserId);
    add("updated_at", input.updatedAt);
    const eventGuard = {
      sql: "SELECT 1 FROM events WHERE id = ? AND updated_at = ?",
      params: [input.eventId, input.updatedAt],
    };
    const statements: SqlBatchStatement[] = [{
      method: "all",
      columns: ["affected"],
      sql: `UPDATE events SET ${assignments.join(", ")} WHERE id = ? AND updated_at = ? RETURNING 1 AS affected`,
      params: [...params, input.eventId, input.expectedUpdatedAt],
    }];

    if (input.poll === null) {
      statements.push({
        method: "run",
        sql: `DELETE FROM event_polls WHERE event_id = ? AND EXISTS (${eventGuard.sql})`,
        params: [input.eventId, ...eventGuard.params],
      });
    }

    if (input.quotas) {
      statements.push(
        {
          method: "run",
          sql: `DELETE FROM event_class_quotas WHERE event_id = ? AND EXISTS (${eventGuard.sql})`,
          params: [input.eventId, ...eventGuard.params],
        },
        {
          method: "run",
          sql: `DELETE FROM class_tags WHERE owner_kind = 'event' AND owner_id = ? AND EXISTS (${eventGuard.sql})`,
          params: [input.eventId, ...eventGuard.params],
        },
        ...this.quotaStatements("event", input.eventId, input.quotas, eventGuard),
      );
    }
    if (input.poll) {
      statements.push({
        method: "run",
        sql: `INSERT INTO event_polls (event_id, results_visibility, show_voter_names, created_at, updated_at)
          SELECT ?, ?, ?, ?, ? WHERE EXISTS (${eventGuard.sql})
          ON CONFLICT(event_id) DO UPDATE SET
            results_visibility = excluded.results_visibility,
            show_voter_names = excluded.show_voter_names,
            updated_at = excluded.updated_at`,
        params: [
          input.eventId,
          input.poll.resultsVisibility,
          booleanValue(input.poll.showVoterNames),
          input.now,
          input.now,
          ...eventGuard.params,
        ],
      });
      if (input.replacePollOptions) {
        statements.push({
          method: "run",
          sql: `DELETE FROM event_poll_options WHERE event_id = ? AND EXISTS (${eventGuard.sql})`,
          params: [input.eventId, ...eventGuard.params],
        });
        statements.push(this.pollOptionsStatement(input.eventId, input.poll.options, input.now, eventGuard));
      }
    }
    if (input.mediaIds) {
      statements.push(...replaceMediaLinksStatements({
        entityType: "event",
        entityId: input.eventId,
        slot: "attachment",
        audience: "public",
        mediaIds: input.mediaIds,
      }, eventGuard));
    }
    statements.push({
      method: "run",
      sql: `UPDATE media_links SET audience = ?
        WHERE entity_type = 'event' AND entity_id = ? AND slot = 'attachment'
          AND EXISTS (${eventGuard.sql})`,
      params: ["public", input.eventId, ...eventGuard.params],
    });
    statements.push(auditInsertStatement(input.audit, eventGuard));
    const snapshotOffset = statements.length;
    statements.push(...this.eventSnapshotStatements(input.eventId, true, input.updatedAt));
    const results = await this.sql.batch(statements);
    if (returnedRowCount(results[0]) === 0) {
      if (!await this.get(input.eventId)) throw failure("NOT_FOUND", 404, "Event not found");
      throw failure("CONFLICT", 409, "Event changed");
    }
    const updated = this.eventSnapshotFromResults(results.slice(snapshotOffset), true);
    if (!updated) throw failure("SERVER_ERROR", 500, "Failed to load updated event");
    return updated;
  }

  async setArchived(input: Parameters<EventsStore["setArchived"]>[0]): Promise<void> {
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["affected"],
        sql: `UPDATE events SET archived_at = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL AND updated_at = ? RETURNING 1 AS affected`,
        params: [input.archivedAt, input.actorUserId, input.updatedAt, input.eventId, input.expectedUpdatedAt],
      },
      auditInsertStatement(input.audit, {
        sql: "SELECT 1 FROM events WHERE id = ? AND archived_at = ? AND updated_at = ?",
        params: [input.eventId, input.archivedAt, input.updatedAt],
      }),
    ]);
    if (returnedRowCount(results[0]) === 0) {
      const existing = await this.get(input.eventId);
      if (!existing) throw failure("NOT_FOUND", 404, "Event not found");
      if (existing.event.archivedAt === null) throw failure("CONFLICT", 409, "Event changed");
    }
  }

  async touch(input: Parameters<EventsStore["touch"]>[0]): Promise<void> {
    await assertMediaAttachments(this.sql, eventMediaTarget(
      input.actorUserId,
      "event",
      input.eventId,
      "public",
      input.mediaIds,
    ));
    const guard = {
      sql: "SELECT 1 FROM events WHERE id = ? AND updated_at = ?",
      params: [input.eventId, input.updatedAt],
    };
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["affected"],
        sql: "UPDATE events SET updated_by = ?, updated_at = ? WHERE id = ? AND updated_at = ? RETURNING 1 AS affected",
        params: [input.actorUserId, input.updatedAt, input.eventId, input.expectedUpdatedAt],
      },
      ...replaceMediaLinksStatements({
        entityType: "event",
        entityId: input.eventId,
        slot: "attachment",
        audience: "public",
        mediaIds: input.mediaIds,
      }, guard),
      auditInsertStatement(input.audit, guard),
    ]);
    if (returnedRowCount(results[0]) === 0) {
      if (!await this.get(input.eventId)) throw failure("NOT_FOUND", 404, "Event not found");
      throw failure("CONFLICT", 409, "Event changed");
    }
  }

  async addParticipants(input: Parameters<EventsStore["addParticipants"]>[0]) {
    const ids = [...new Set(input.userIds)];
    if (ids.length === 0) return { participants: [], changed: false };
    if (input.participantIds.length !== ids.length) {
      throw failure("VALIDATION_ERROR", 400, "Participant ids do not match users");
    }
    const activeUsers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.isActive, true), isNull(users.deletedAt)));
    const active = new Set(activeUsers.map((row) => row.id));
    const missing = ids.find((id) => !active.has(id));
    if (missing) throw failure("NOT_FOUND", 404, `User not found: ${missing}`);

    const requestedJson = JSON.stringify(ids.map((userId, index) => ({
      participantId: input.participantIds[index],
      userId,
    })));
    const eventGuard: SqlGuard = {
      sql: "SELECT 1 FROM events WHERE id = ? AND updated_at = ?",
      params: [input.eventId, input.updatedAt],
    };
    const lockCondition = input.mode === "self" ? "AND event.signup_locked = 0" : "";
    const insert: SqlBatchStatement = {
      method: "run",
      sql: `WITH requested(participant_id, user_id) AS (
        SELECT
          CAST(json_extract(value, '$.participantId') AS TEXT),
          CAST(json_extract(value, '$.userId') AS TEXT)
        FROM json_each(?)
      )
      INSERT INTO event_participants (id, event_id, user_id, joined_at)
      SELECT requested.participant_id, event.id, requested.user_id, ?
      FROM events AS event CROSS JOIN requested
      WHERE event.id = ? AND event.updated_at = ?
        AND NOT EXISTS (
          SELECT 1 FROM event_participants existing
          WHERE existing.event_id = event.id AND existing.user_id = requested.user_id
        )
      ON CONFLICT(event_id, user_id) DO NOTHING`,
      params: [requestedJson, input.now, input.eventId, input.updatedAt],
    };
    let results: readonly SqlResult[];
    try {
      results = await this.sql.batch([
        {
          method: "all",
          columns: ["affected"],
          sql: `WITH requested(user_id) AS (
            SELECT CAST(json_extract(value, '$.userId') AS TEXT) FROM json_each(?)
          )
          UPDATE events AS event
          SET updated_by = ?, updated_at = ?
          WHERE event.id = ? AND event.updated_at = ?
            AND event.type <> 'poll'
            AND event.archived_at IS NULL
            AND (event.end_at IS NULL OR event.end_at > ?)
            ${lockCondition}
            AND EXISTS (
              SELECT 1 FROM requested candidate
              WHERE NOT EXISTS (
                SELECT 1 FROM event_participants existing
                WHERE existing.event_id = event.id AND existing.user_id = candidate.user_id
              )
            )
            AND (
              event.capacity IS NULL OR
              (SELECT count(*) FROM event_participants current WHERE current.event_id = event.id)
              + (SELECT count(*) FROM requested candidate WHERE NOT EXISTS (
                  SELECT 1 FROM event_participants existing
                  WHERE existing.event_id = event.id AND existing.user_id = candidate.user_id
                )) <= event.capacity
            )
          RETURNING 1 AS affected`,
          params: [requestedJson, input.actorUserId, input.updatedAt, input.eventId, input.expectedUpdatedAt, input.now],
        },
        insert,
        participantAuditStatement(input.audit, input.eventId, requestedJson, "added", eventGuard),
      ]);
    } catch (error) {
      if (String(error).includes("event signup is unavailable")) {
        throw failure("CONFLICT", 409, "Event signup is unavailable", error);
      }
      throw error;
    }
    const participantRows = await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, input.eventId), inArray(eventParticipants.userId, ids)));
    const participants = participantRows.map((row) => ({
      id: row.id,
      event_id: row.eventId,
      user_id: row.userId,
      joined_at: row.joinedAt,
    }));
    if (returnedRowCount(results[0]) > 0) return { participants, changed: true };

    const event = await this.get(input.eventId, true);
    if (!event) throw failure("NOT_FOUND", 404, "Event not found");
    if (event.event.updatedAt !== input.expectedUpdatedAt) {
      throw failure("CONFLICT", 409, "Event changed");
    }
    if (participants.length === ids.length) return { participants, changed: false };
    const present = new Set(event.participants.map((participant) => participant.user_id));
    const missingParticipants = ids.filter((id) => !present.has(id));
    if (event.event.capacity !== null && event.participants.length + missingParticipants.length > event.event.capacity) {
      throw failure("CONFLICT", 409, "Event has reached maximum capacity");
    }
    throw failure("CONFLICT", 409, "Event signup is unavailable");
  }

  async removeParticipants(input: Parameters<EventsStore["removeParticipants"]>[0]): Promise<number> {
    const ids = [...new Set(input.userIds)];
    if (ids.length === 0) return 0;
    const requestedJson = JSON.stringify(ids.map((userId) => ({ participantId: null, userId })));
    const eventGuard: SqlGuard = {
      sql: "SELECT 1 FROM events WHERE id = ? AND updated_at = ?",
      params: [input.eventId, input.updatedAt],
    };
    let results: readonly SqlResult[];
    try {
      results = await this.sql.batch([
        {
          method: "all",
          columns: ["affected"],
          sql: `UPDATE events
            SET updated_by = ?, updated_at = ?
            WHERE id = ? AND updated_at = ?
              AND EXISTS (
                SELECT 1 FROM event_participants participant
                WHERE participant.event_id = events.id
                  AND participant.user_id IN (
                    SELECT CAST(json_extract(requested.value, '$.userId') AS TEXT)
                    FROM json_each(?) AS requested
                  )
              )
            RETURNING 1 AS affected`,
          params: [input.actorUserId, input.updatedAt, input.eventId, input.expectedUpdatedAt, requestedJson],
        },
        participantAuditStatement(input.audit, input.eventId, requestedJson, "removing", eventGuard),
        {
          method: "all",
          columns: ["affected"],
          sql: `DELETE FROM event_participants
            WHERE event_id = ? AND user_id IN (
              SELECT CAST(json_extract(requested.value, '$.userId') AS TEXT)
              FROM json_each(?) AS requested
            )
              AND EXISTS (${eventGuard.sql})
            RETURNING 1 AS affected`,
          params: [input.eventId, requestedJson, ...eventGuard.params],
        },
      ]);
    } catch (error) {
      if (String(error).includes("active guild war roster member")) {
        throw failure("CONFLICT", 409, "Remove the member from the active guild war roster first", error);
      }
      throw error;
    }
    if (returnedRowCount(results[0]) > 0) return returnedRowCount(results[2]);
    const event = await this.get(input.eventId);
    if (!event) throw failure("NOT_FOUND", 404, "Event not found");
    if (event.event.updatedAt !== input.expectedUpdatedAt) {
      throw failure("CONFLICT", 409, "Event changed");
    }
    return 0;
  }

  async replacePollVote(input: Parameters<EventsStore["replacePollVote"]>[0]): Promise<boolean> {
    const requestedJson = JSON.stringify(input.optionIds);
    const eventGuard: SqlGuard = {
      sql: "SELECT 1 FROM events WHERE id = ? AND updated_at = ?",
      params: [input.eventId, input.updatedAt],
    };
    let results: readonly SqlResult[];
    try {
      results = await this.sql.batch([
        {
          method: "all",
          columns: ["affected"],
          sql: `UPDATE events AS event
            SET updated_by = ?, updated_at = ?
            WHERE event.id = ? AND event.updated_at = ?
              AND event.type = 'poll'
              AND event.archived_at IS NULL
              AND event.end_at > ?
              AND (
                EXISTS (
                  SELECT 1 FROM event_poll_votes existing
                  WHERE existing.event_id = event.id AND existing.user_id = ?
                    AND NOT EXISTS (
                      SELECT 1 FROM json_each(?) requested
                      WHERE CAST(requested.value AS TEXT) = existing.option_id
                    )
                ) OR EXISTS (
                  SELECT 1 FROM json_each(?) requested
                  WHERE NOT EXISTS (
                    SELECT 1 FROM event_poll_votes existing
                    WHERE existing.event_id = event.id AND existing.user_id = ?
                      AND existing.option_id = CAST(requested.value AS TEXT)
                  )
                )
              )
            RETURNING 1 AS affected`,
          params: [
            input.userId,
            input.updatedAt,
            input.eventId,
            input.expectedUpdatedAt,
            input.now,
            input.userId,
            requestedJson,
            requestedJson,
            input.userId,
          ],
        },
        {
          method: "run",
          sql: `DELETE FROM event_poll_votes
            WHERE event_id = ? AND user_id = ? AND EXISTS (${eventGuard.sql})`,
          params: [input.eventId, input.userId, ...eventGuard.params],
        },
        {
          method: "run",
          sql: `INSERT INTO event_poll_votes (event_id, option_id, user_id, created_at)
            SELECT ?, CAST(value AS TEXT), ?, ? FROM json_each(?)
            WHERE EXISTS (${eventGuard.sql})`,
          params: [input.eventId, input.userId, input.now, requestedJson, ...eventGuard.params],
        },
        auditInsertStatement(input.audit, eventGuard),
      ]);
    } catch (error) {
      throw failure("VALIDATION_ERROR", 400, "Invalid poll option", error);
    }
    if (returnedRowCount(results[0]) > 0) return true;
    const event = await this.get(input.eventId);
    if (!event) throw failure("NOT_FOUND", 404, "Event not found");
    if (event.event.updatedAt !== input.expectedUpdatedAt) {
      throw failure("CONFLICT", 409, "Event changed");
    }
    if (event.event.type !== "poll" || event.event.archivedAt !== null || event.event.endAt === null || event.event.endAt <= input.now) {
      throw failure("CONFLICT", 409, "Poll is closed");
    }
    return false;
  }

  async drawRaffle(input: Parameters<EventsStore["drawRaffle"]>[0]) {
    if (
      input.winnerIds.length === 0
      || input.winnerIds.length !== input.winnerRowIds.length
      || new Set(input.winnerIds).size !== input.winnerIds.length
    ) {
      throw failure("VALIDATION_ERROR", 400, "Raffle winners must be distinct and have matching row ids");
    }
    const requestedJson = JSON.stringify(input.winnerIds.map((userId, index) => ({
      rowId: input.winnerRowIds[index],
      userId,
    })));
    const eventGuard: SqlGuard = {
      sql: "SELECT 1 FROM events WHERE id = ? AND updated_at = ?",
      params: [input.eventId, input.updatedAt],
    };
    const drawGuard: SqlGuard = {
      sql: "SELECT 1 FROM event_raffle_draws WHERE event_id = ? AND mutation_token = ?",
      params: [input.eventId, input.audit.eventId],
    };
    const statements: SqlBatchStatement[] = [{
      method: "all",
      columns: ["affected"],
      sql: `WITH requested(row_id, user_id) AS (
        SELECT
          CAST(json_extract(value, '$.rowId') AS TEXT),
          CAST(json_extract(value, '$.userId') AS TEXT)
        FROM json_each(?)
      )
      UPDATE events AS event
      SET signup_locked = 1, updated_by = ?, updated_at = ?
      WHERE event.id = ? AND event.updated_at = ?
        AND event.type = 'raffle'
        AND event.archived_at IS NULL
        AND event.winner_count IS NOT NULL
        AND (SELECT count(*) FROM requested) > 0
        AND (SELECT count(DISTINCT user_id) FROM requested) = (SELECT count(*) FROM requested)
        AND (SELECT count(DISTINCT row_id) FROM requested) = (SELECT count(*) FROM requested)
        AND (SELECT count(*) FROM requested) = min(
          event.winner_count,
          (SELECT count(*) FROM event_participants participant WHERE participant.event_id = event.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM requested winner
          WHERE NOT EXISTS (
            SELECT 1 FROM event_participants participant
            WHERE participant.event_id = event.id AND participant.user_id = winner.user_id
          )
        )
        AND NOT EXISTS (SELECT 1 FROM event_raffle_draws draw WHERE draw.event_id = event.id)
      RETURNING 1 AS affected`,
      params: [requestedJson, input.actorUserId, input.updatedAt, input.eventId, input.expectedUpdatedAt],
    }, {
      method: "all",
      columns: ["affected"],
      sql: `WITH requested(row_id, user_id) AS (
        SELECT
          CAST(json_extract(value, '$.rowId') AS TEXT),
          CAST(json_extract(value, '$.userId') AS TEXT)
        FROM json_each(?)
      )
      INSERT INTO event_raffle_draws (event_id, winner_count, drawn_by, drawn_at, mutation_token)
      SELECT event.id, (SELECT count(*) FROM requested), ?, ?, ?
      FROM events AS event
      WHERE event.id = ? AND event.updated_at = ?
        AND NOT EXISTS (SELECT 1 FROM event_raffle_draws draw WHERE draw.event_id = event.id)
      RETURNING 1 AS affected`,
      params: [requestedJson, input.actorUserId, input.now, input.audit.eventId, ...eventGuard.params],
    }, {
      method: "run",
      sql: `WITH requested(row_id, user_id) AS (
        SELECT
          CAST(json_extract(value, '$.rowId') AS TEXT),
          CAST(json_extract(value, '$.userId') AS TEXT)
        FROM json_each(?)
      )
      INSERT INTO event_raffle_winners (id, event_id, user_id, drawn_at)
      SELECT requested.row_id, ?, requested.user_id, ?
      FROM requested
      WHERE EXISTS (${eventGuard.sql}) AND EXISTS (${drawGuard.sql})`,
      params: [requestedJson, input.eventId, input.now, ...eventGuard.params, ...drawGuard.params],
    }, raffleAuditStatement(input.audit, input.eventId, requestedJson, eventGuard)];
    try {
      const results = await this.sql.batch(statements);
      if (returnedRowCount(results[0]) === 0) {
        const existing = await this.get(input.eventId);
        if (!existing) throw failure("NOT_FOUND", 404, "Event not found");
        if (existing.event.updatedAt !== input.expectedUpdatedAt) {
          throw failure("CONFLICT", 409, "Event changed");
        }
        const drawn = await this.db
          .select({ eventId: eventRaffleDraws.eventId })
          .from(eventRaffleDraws)
          .where(eq(eventRaffleDraws.eventId, input.eventId))
          .limit(1);
        if (drawn.length > 0) throw failure("CONFLICT", 409, "Raffle winners already drawn");
        throw failure("CONFLICT", 409, "Raffle draw is no longer valid");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (String(error).includes("UNIQUE")) throw failure("CONFLICT", 409, "Raffle winners already drawn", error);
      throw error;
    }
    const rows = await this.db
      .select({ id: eventRaffleWinners.id, eventId: eventRaffleWinners.eventId, userId: eventRaffleWinners.userId, drawnAt: eventRaffleWinners.drawnAt })
      .from(eventRaffleWinners)
      .where(eq(eventRaffleWinners.eventId, input.eventId));
    return rows;
  }

  async listTemplates(): Promise<readonly RecurringTemplateAggregate[]> {
    const catalogLimit = LIMITS.content.recurringTemplateCatalog.max;
    const rows = await this.db.select(TEMPLATE_FIELDS).from(recurringTemplates)
      .orderBy(asc(recurringTemplates.createdAt), asc(recurringTemplates.id))
      .limit(catalogLimit + 1);
    if (rows.length > catalogLimit) {
      throw failure("SERVER_ERROR", 500, `Recurring template catalog data invariant violated: maximum is ${catalogLimit}`);
    }
    return this.hydrateTemplates(rows);
  }

  async getTemplate(templateId: string): Promise<RecurringTemplateAggregate | null> {
    const row = (await this.db.select(TEMPLATE_FIELDS).from(recurringTemplates).where(eq(recurringTemplates.id, templateId)).limit(1))[0];
    if (!row) return null;
    return (await this.hydrateTemplates([row]))[0] ?? null;
  }

  async createTemplate(input: TemplateCreateWrite): Promise<RecurringTemplateAggregate> {
    await assertMediaAttachments(this.sql, eventMediaTarget(
      input.actorUserId,
      "recurring_template",
      input.id,
      "private",
      input.mediaIds,
    ));
    const columns = recurrenceColumns(input.recurrenceRule);
    const statements: SqlBatchStatement[] = [{
      method: "all",
      columns: ["affected"],
      sql: `INSERT INTO recurring_templates (
        id, type, title, description, start_time, duration_minutes, capacity,
        recurrence_frequency, recurrence_interval, recurrence_day_of_month,
        recurrence_end_after, recurrence_end_at, visibility_offset_minutes,
        auto_archive, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING 1 AS affected`,
      params: [
        input.id,
        input.type,
        input.title,
        input.description,
        input.startTime,
        input.durationMinutes,
        input.capacity,
        columns.recurrence_frequency!,
        columns.recurrence_interval!,
        columns.recurrence_day_of_month!,
        columns.recurrence_end_after!,
        columns.recurrence_end_at!,
        input.visibilityOffsetMinutes,
        booleanValue(input.autoArchive),
        input.actorUserId,
        input.now,
        input.now,
      ],
    }];
    statements.push(...this.weekdayStatements(input.id, input.recurrenceRule));
    statements.push(...this.quotaStatements("recurring_template", input.id, input.quotas));
    statements.push(...replaceMediaLinksStatements({
      entityType: "recurring_template",
      entityId: input.id,
      slot: "attachment",
      audience: "private",
      mediaIds: input.mediaIds,
    }, { sql: "SELECT 1 FROM recurring_templates WHERE id = ?", params: [input.id] }));
    statements.push(auditInsertStatement(input.audit));
    const snapshotOffset = statements.length;
    statements.push(...this.templateSnapshotStatements(input.id, input.now));
    let results: readonly SqlResult[];
    try {
      results = await this.sql.batch(statements);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (String(error).includes(RECURRING_TEMPLATE_CATALOG_LIMIT_ERROR)) {
        throw failure("CONFLICT", 409, `Recurring template catalog is limited to ${LIMITS.content.recurringTemplateCatalog.max} templates`, error);
      }
      throw error;
    }
    const created = this.templateSnapshotFromResults(results.slice(snapshotOffset));
    if (!created) throw failure("SERVER_ERROR", 500, "Failed to load created template");
    return created;
  }

  async updateTemplate(input: TemplateUpdateWrite): Promise<RecurringTemplateAggregate> {
    if (input.mediaIds) {
      await assertMediaAttachments(this.sql, eventMediaTarget(
        input.actorUserId,
        "recurring_template",
        input.templateId,
        "private",
        input.mediaIds,
      ));
    }
    const assignments: string[] = [];
    const params: SqlValue[] = [];
    const add = (column: string, value: SqlValue): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };
    for (const [key, value] of Object.entries(input.patch)) {
      if (key === "type") add("type", value as string);
      else if (key === "title") add("title", value as string);
      else if (key === "description") add("description", value as string | null);
      else if (key === "startTime") add("start_time", value as string);
      else if (key === "durationMinutes") add("duration_minutes", value as number | null);
      else if (key === "capacity") add("capacity", value as number | null);
      else if (key === "visibilityOffsetMinutes") add("visibility_offset_minutes", value as number);
      else if (key === "autoArchive") add("auto_archive", booleanValue(value as boolean));
      else if (key === "recurrenceRule") {
        for (const [column, columnValue] of Object.entries(recurrenceColumns(value as RecurringTemplateRecord["recurrenceRule"]))) {
          add(column, columnValue);
        }
      }
    }
    if (input.restartCursorDate) add("last_generated_date", input.restartCursorDate);
    add("updated_at", input.updatedAt);
    const templateGuard = {
      sql: "SELECT 1 FROM recurring_templates WHERE id = ? AND updated_at = ?",
      params: [input.templateId, input.updatedAt],
    };
    const statements: SqlBatchStatement[] = [{
      method: "all",
      columns: ["affected"],
      sql: `UPDATE recurring_templates SET ${assignments.join(", ")} WHERE id = ? AND updated_at = ? RETURNING 1 AS affected`,
      params: [...params, input.templateId, input.expectedUpdatedAt],
    }];
    if (input.patch.recurrenceRule) {
      statements.push(
        {
          method: "run",
          sql: `DELETE FROM recurring_template_weekdays WHERE template_id = ? AND EXISTS (${templateGuard.sql})`,
          params: [input.templateId, ...templateGuard.params],
        },
        ...this.weekdayStatements(input.templateId, input.patch.recurrenceRule, templateGuard),
      );
    }
    if (input.quotas) {
      statements.push(
        {
          method: "run",
          sql: `DELETE FROM recurring_template_class_quotas WHERE template_id = ? AND EXISTS (${templateGuard.sql})`,
          params: [input.templateId, ...templateGuard.params],
        },
        {
          method: "run",
          sql: `DELETE FROM class_tags WHERE owner_kind = 'recurring_template' AND owner_id = ? AND EXISTS (${templateGuard.sql})`,
          params: [input.templateId, ...templateGuard.params],
        },
        ...this.quotaStatements("recurring_template", input.templateId, input.quotas, templateGuard),
      );
    }
    if (input.mediaIds) {
      statements.push(...replaceMediaLinksStatements({
        entityType: "recurring_template",
        entityId: input.templateId,
        slot: "attachment",
        audience: "private",
        mediaIds: input.mediaIds,
      }, templateGuard));
    }
    statements.push(auditInsertStatement(input.audit, templateGuard));
    const snapshotOffset = statements.length;
    statements.push(...this.templateSnapshotStatements(input.templateId, input.updatedAt));
    const results = await this.sql.batch(statements);
    if (returnedRowCount(results[0]) === 0) {
      if (!await this.getTemplate(input.templateId)) throw failure("NOT_FOUND", 404, "Template not found");
      throw failure("CONFLICT", 409, "Template changed");
    }
    const updated = this.templateSnapshotFromResults(results.slice(snapshotOffset));
    if (!updated) throw failure("SERVER_ERROR", 500, "Failed to load updated template");
    return updated;
  }

  async setTemplatePaused(input: Parameters<EventsStore["setTemplatePaused"]>[0]): Promise<void> {
    const resumeCursor = input.paused ? undefined : input.resumeCursorDate;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["affected"],
        sql: `UPDATE recurring_templates
          SET paused = ?, ${resumeCursor === undefined ? "" : "last_generated_date = ?, "}updated_at = ?
          WHERE id = ? AND updated_at = ? RETURNING 1 AS affected`,
        params: [
          booleanValue(input.paused),
          ...(resumeCursor === undefined ? [] : [resumeCursor]),
          input.updatedAt,
          input.templateId,
          input.expectedUpdatedAt,
        ],
      },
      auditInsertStatement(input.audit, {
        sql: "SELECT 1 FROM recurring_templates WHERE id = ? AND paused = ? AND updated_at = ?",
        params: [input.templateId, booleanValue(input.paused), input.updatedAt],
      }),
    ]);
    if (returnedRowCount(results[0]) === 0) {
      const existing = await this.getTemplate(input.templateId);
      if (!existing) throw failure("NOT_FOUND", 404, "Template not found");
      if (existing.template.paused !== input.paused) throw failure("CONFLICT", 409, "Template changed");
    }
  }

  async deleteTemplate(templateId: string, audit: TemplateUpdateWrite["audit"]): Promise<void> {
    const results = await this.sql.batch([
      auditInsertStatement(audit, { sql: "SELECT 1 FROM recurring_templates WHERE id = ?", params: [templateId] }),
      {
        method: "run",
        sql: "UPDATE events SET series_id = NULL, instance_date = NULL WHERE series_id = ?",
        params: [templateId],
      },
      { method: "all", columns: ["affected"], sql: "DELETE FROM recurring_templates WHERE id = ? RETURNING 1 AS affected", params: [templateId] },
    ]);
    if (returnedRowCount(results[2]) === 0) throw failure("NOT_FOUND", 404, "Template not found");
  }

  async materializeDue(
    now: string,
    templateId: string | undefined,
    createAudit: MaterializationAuditFactory,
  ): Promise<readonly RecurrenceMaterialization[]> {
    const nowDate = new Date(now);
    if (!Number.isFinite(nowDate.getTime())) throw failure("VALIDATION_ERROR", 400, "Invalid recurrence time");
    const results: RecurrenceMaterialization[] = [];
    if (templateId) {
      const selected = await this.getTemplate(templateId);
      if (selected && !selected.template.paused) {
        const result = await this.materializeTemplate(selected, nowDate, createAudit);
        if (result.eventIds.length > 0) results.push(result);
      }
      return results;
    }

    let afterId: string | null = null;
    while (true) {
      const rows = await this.db
        .select(TEMPLATE_FIELDS)
        .from(recurringTemplates)
        .where(and(
          eq(recurringTemplates.paused, false),
          ...(afterId === null ? [] : [gt(recurringTemplates.id, afterId)]),
        ))
        .orderBy(asc(recurringTemplates.id))
        .limit(MATERIALIZE_TEMPLATE_BATCH);
      if (rows.length === 0) break;
      for (const aggregate of await this.hydrateTemplates(rows)) {
        const result = await this.materializeTemplate(aggregate, nowDate, createAudit);
        if (result.eventIds.length > 0) results.push(result);
      }
      if (rows.length < MATERIALIZE_TEMPLATE_BATCH) break;
      afterId = rows[rows.length - 1]!.id;
    }
    return results;
  }

  async materializeDueBatch(
    now: string,
    afterTemplateId: string | null,
    maxTemplates: number,
    maxOccurrencesPerTemplate: number,
    createAudit: MaterializationAuditFactory,
  ): Promise<Readonly<{
    materialized: readonly RecurrenceMaterialization[];
    inspected: number;
    hasMore: boolean;
    nextTemplateCursor: string | null;
  }>> {
    const nowDate = new Date(now);
    if (!Number.isFinite(nowDate.getTime())) throw failure("VALIDATION_ERROR", 400, "Invalid recurrence time");
    if (!Number.isSafeInteger(maxTemplates) || maxTemplates < 1 || maxTemplates > MATERIALIZE_TEMPLATE_BATCH) {
      throw new RangeError(`Recurrence batches support at most ${MATERIALIZE_TEMPLATE_BATCH} templates`);
    }
    if (
      !Number.isSafeInteger(maxOccurrencesPerTemplate)
      || maxOccurrencesPerTemplate < 1
      || maxOccurrencesPerTemplate > MATERIALIZE_OCCURRENCES_PER_TEMPLATE
    ) {
      throw new RangeError(`Recurrence batches support at most ${MATERIALIZE_OCCURRENCES_PER_TEMPLATE} occurrences per template`);
    }

    const selectWindow = (cursor: string | null) => this.db.select(TEMPLATE_FIELDS)
      .from(recurringTemplates)
      .where(and(
        eq(recurringTemplates.paused, false),
        ...(cursor === null ? [] : [gt(recurringTemplates.id, cursor)]),
      ))
      .orderBy(asc(recurringTemplates.id))
      .limit(maxTemplates + 1);
    let candidates = await selectWindow(afterTemplateId);
    if (candidates.length === 0 && afterTemplateId !== null) candidates = await selectWindow(null);
    const hasMore = candidates.length > maxTemplates;
    const rows = candidates.slice(0, maxTemplates);
    const nextTemplateCursor = hasMore ? rows[rows.length - 1]!.id : null;
    const materialized: RecurrenceMaterialization[] = [];
    for (const aggregate of await this.hydrateTemplates(rows)) {
      const result = await this.materializeTemplate(
        aggregate,
        nowDate,
        createAudit,
        maxOccurrencesPerTemplate,
      );
      if (result.eventIds.length > 0) materialized.push(result);
    }
    return { materialized, inspected: rows.length, hasMore, nextTemplateCursor };
  }

  private async materializeTemplate(
    aggregate: RecurringTemplateAggregate,
    now: Date,
    createAudit: MaterializationAuditFactory,
    maxOccurrences = MATERIALIZE_OCCURRENCES_PER_TEMPLATE,
  ): Promise<RecurrenceMaterialization> {
    const template = aggregate.template;
    const time = parseStartTime(template.startTime);
    const reference = new Date(template.createdAt);
    if (!time || !Number.isFinite(reference.getTime())) {
      return { templateId: template.id, eventIds: [], createdEventIds: [] };
    }
    if (template.recurrenceRule.endAfter !== undefined && template.generationCount >= template.recurrenceRule.endAfter) {
      return { templateId: template.id, eventIds: [], createdEventIds: [] };
    }

    let cursor: Date | null;
    if (template.lastGeneratedDate) {
      cursor = new Date(`${template.lastGeneratedDate}T00:00:00.000Z`);
    } else {
      cursor = recurrenceCursorBefore(now);
    }
    if (!cursor || !Number.isFinite(cursor.getTime())) {
      return { templateId: template.id, eventIds: [], createdEventIds: [] };
    }
    const horizon = new Date(now.getTime() + (3 * 24 * 60 + template.visibilityOffsetMinutes) * 60_000);
    const recurrenceEnd = template.recurrenceRule.endDate === undefined
      ? null
      : new Date(template.recurrenceRule.endDate);
    if (recurrenceEnd && !Number.isFinite(recurrenceEnd.getTime())) {
      return { templateId: template.id, eventIds: [], createdEventIds: [] };
    }
    const planned: Array<{ dateKey: string; startAt: string; endAt: string | null }> = [];
    while (planned.length < maxOccurrences) {
      const next = computeNextOccurrenceFromCursor(
        cursor,
        time.hour,
        time.minute,
        template.recurrenceRule,
        reference,
      );
      if (!next || next > horizon) break;
      if (recurrenceEnd && next > recurrenceEnd) break;
      if (next.getTime() - template.visibilityOffsetMinutes * 60_000 > now.getTime()) break;
      planned.push({
        dateKey: next.toISOString().slice(0, 10),
        startAt: next.toISOString(),
        endAt: template.durationMinutes === null
          ? null
          : new Date(next.getTime() + template.durationMinutes * 60_000).toISOString(),
      });
      cursor = next;
      if (
        template.recurrenceRule.endAfter !== undefined
        && template.generationCount + planned.length >= template.recurrenceRule.endAfter
      ) break;
    }
    if (planned.length === 0) return { templateId: template.id, eventIds: [], createdEventIds: [] };

    const existingRows = await this.db
      .select({ id: events.id, instanceDate: events.instanceDate })
      .from(events)
      .where(and(
        eq(events.seriesId, template.id),
        inArray(events.instanceDate, planned.map((item) => item.dateKey)),
      ));
    const existingByDate = new Map(existingRows.flatMap((row) => row.instanceDate ? [[row.instanceDate, row.id] as const] : []));
    const fresh = planned
      .filter((item) => !existingByDate.has(item.dateKey))
      .map((item) => ({ ...item, eventId: crypto.randomUUID() }));
    const freshByDate = new Map(fresh.map((item) => [item.dateKey, item.eventId]));
    const allEventIds = planned.map((item) => existingByDate.get(item.dateKey) ?? freshByDate.get(item.dateKey)!);

    const materializations = fresh.map((item) => {
      const audit = createAudit({
        subjectType: "event",
        subjectId: item.eventId,
        subjectLabel: template.title,
        action: "create",
        context: [
          {
            field: "recurring_template_id",
            value: { type: "reference", value: { id: template.id, label: template.title } },
          },
          { field: "type", value: { type: "code", value: template.type } },
          { field: "start_at", value: { type: "datetime", value: item.startAt } },
          ...(template.capacity === null ? [] : [{
            field: "capacity" as const,
            value: { type: "number" as const, value: template.capacity },
          }]),
        ],
      });
      return {
        eventId: item.eventId,
        startAt: item.startAt,
        endAt: item.endAt,
        visibleAt: new Date(
          Date.parse(item.startAt) - template.visibilityOffsetMinutes * 60_000,
        ).toISOString(),
        dateKey: item.dateKey,
        quotas: aggregate.classQuotas.map((quota) => ({
          tagId: quota.one_time ? crypto.randomUUID() : quota.tag_id,
          required: quota.required,
          oneTime: quota.one_time,
          label: quota.label ?? "",
          classIds: quota.class_ids,
        })),
        audit,
      };
    });
    const payload = JSON.stringify(materializations);
    const finalDate = planned[planned.length - 1]!.dateKey;
    const updatedAt = monotonicTimestamp(now.toISOString(), template.updatedAt);
    const templateAudit = createAudit({
      subjectType: "recurring_template",
      subjectId: template.id,
      subjectLabel: template.title,
      action: "update",
      changes: [
        {
          field: "last_generated_date",
          before: template.lastGeneratedDate === null
            ? { type: "null", value: null }
            : { type: "date", value: template.lastGeneratedDate },
          after: { type: "date", value: finalDate },
        },
        ...(fresh.length === 0 ? [] : [{
          field: "generation_count" as const,
          before: { type: "number" as const, value: template.generationCount },
          after: { type: "number" as const, value: template.generationCount + fresh.length },
        }]),
      ],
    });
    const statements: SqlBatchStatement[] = [
      {
        method: "all",
        columns: ["affected"],
        sql: `UPDATE recurring_templates
          SET last_generated_date = ?, generation_count = generation_count + ?, updated_at = ?
          WHERE id = ? AND paused = 0 AND generation_count = ? AND updated_at = ?
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(?) AS requested
              JOIN events AS existing
                ON existing.series_id = recurring_templates.id
                AND existing.instance_date = CAST(json_extract(requested.value, '$.dateKey') AS TEXT)
            )
          RETURNING 1 AS affected`,
        params: [
          finalDate,
          fresh.length,
          updatedAt,
          template.id,
          template.generationCount,
          template.updatedAt,
          payload,
        ],
      },
      auditInsertStatement(templateAudit, { sql: "SELECT 1 WHERE changes() > 0" }),
      {
        method: "all",
        columns: ["subject_id"],
        sql: `INSERT INTO audit_log (
            id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
            subject_label, action, payload_json, occurred_at
          )
          WITH requested AS (SELECT value AS item FROM json_each(?))
          SELECT CAST(json_extract(item, '$.audit.eventId') AS TEXT),
            CAST(json_extract(item, '$.audit.requestId') AS TEXT),
            CAST(json_extract(item, '$.audit.actorKind') AS TEXT),
            CAST(json_extract(item, '$.audit.actorId') AS TEXT),
            CASE WHEN json_extract(item, '$.audit.actorKind') = 'user'
              THEN (SELECT display_name FROM users WHERE id = CAST(json_extract(item, '$.audit.actorId') AS TEXT))
              ELSE json_extract(item, '$.audit.actorLabel') END,
            CAST(json_extract(item, '$.audit.subjectType') AS TEXT),
            CAST(json_extract(item, '$.audit.subjectId') AS TEXT),
            json_extract(item, '$.audit.subjectLabel'),
            CAST(json_extract(item, '$.audit.action') AS TEXT),
            json_extract(item, '$.audit.payload'),
            CAST(json_extract(item, '$.audit.occurredAt') AS TEXT)
          FROM requested
          JOIN recurring_templates AS template ON template.id = ?
          WHERE template.paused = 0 AND template.generation_count = ? AND template.updated_at = ?
            AND NOT EXISTS (
              SELECT 1 FROM events
              WHERE series_id = template.id
                AND instance_date = CAST(json_extract(item, '$.dateKey') AS TEXT)
            )
          RETURNING subject_id`,
        params: [payload, template.id, template.generationCount + fresh.length, updatedAt],
      },
      {
        method: "run",
        sql: `WITH requested AS (SELECT value AS item FROM json_each(?))
          INSERT INTO events (
            id, type, title, description, start_at, end_at, capacity, auto_archive,
            visible_at, created_by, series_id, instance_date, created_at, updated_at
          )
          SELECT CAST(json_extract(requested.item, '$.eventId') AS TEXT),
            template.type, template.title, template.description,
            CAST(json_extract(requested.item, '$.startAt') AS TEXT),
            CAST(json_extract(requested.item, '$.endAt') AS TEXT),
            template.capacity, template.auto_archive,
            CAST(json_extract(requested.item, '$.visibleAt') AS TEXT),
            template.created_by, template.id,
            CAST(json_extract(requested.item, '$.dateKey') AS TEXT), ?, ?
          FROM requested
          JOIN recurring_templates AS template ON template.id = ?
          WHERE template.paused = 0 AND template.generation_count = ? AND template.updated_at = ?
            AND EXISTS (
              SELECT 1 FROM audit_log
              WHERE id = CAST(json_extract(requested.item, '$.audit.eventId') AS TEXT)
                AND subject_type = 'event'
                AND subject_id = CAST(json_extract(requested.item, '$.eventId') AS TEXT)
            )
          ON CONFLICT(series_id, instance_date) DO NOTHING`,
        params: [
          payload,
          now.toISOString(),
          now.toISOString(),
          template.id,
          template.generationCount + fresh.length,
          updatedAt,
        ],
      },
      {
        method: "run",
        sql: `WITH requested AS (SELECT value AS item FROM json_each(?)),
          quota_rows AS (
            SELECT CAST(json_extract(requested.item, '$.eventId') AS TEXT) AS event_id,
              quota.value AS quota
            FROM requested, json_each(requested.item, '$.quotas') AS quota
          )
          INSERT INTO class_tags (id, label, sort_order, owner_kind, owner_id)
          SELECT CAST(json_extract(quota, '$.tagId') AS TEXT),
            CAST(json_extract(quota, '$.label') AS TEXT), 0, 'event', event_id
          FROM quota_rows
          WHERE json_extract(quota, '$.oneTime') = 1
            AND EXISTS (SELECT 1 FROM events WHERE id = event_id)`,
        params: [payload],
      },
      {
        method: "run",
        sql: `WITH requested AS (SELECT value AS item FROM json_each(?)),
          quota_rows AS (
            SELECT CAST(json_extract(requested.item, '$.eventId') AS TEXT) AS event_id,
              quota.value AS quota
            FROM requested, json_each(requested.item, '$.quotas') AS quota
          )
          INSERT INTO class_tag_members (tag_id, class_id)
          SELECT CAST(json_extract(quota_rows.quota, '$.tagId') AS TEXT), CAST(classes.value AS TEXT)
          FROM quota_rows, json_each(quota_rows.quota, '$.classIds') AS classes
          WHERE json_extract(quota_rows.quota, '$.oneTime') = 1
            AND EXISTS (SELECT 1 FROM events WHERE id = quota_rows.event_id)`,
        params: [payload],
      },
      {
        method: "run",
        sql: `WITH requested AS (SELECT value AS item FROM json_each(?)),
          quota_rows AS (
            SELECT CAST(json_extract(requested.item, '$.eventId') AS TEXT) AS event_id,
              quota.value AS quota
            FROM requested, json_each(requested.item, '$.quotas') AS quota
          )
          INSERT INTO event_class_quotas (event_id, tag_id, required)
          SELECT event_id, CAST(json_extract(quota, '$.tagId') AS TEXT),
            CAST(json_extract(quota, '$.required') AS INTEGER)
          FROM quota_rows
          WHERE EXISTS (SELECT 1 FROM events WHERE id = event_id)`,
        params: [payload],
      },
      {
        method: "run",
        sql: `WITH requested AS (
            SELECT CAST(json_extract(value, '$.eventId') AS TEXT) AS event_id FROM json_each(?)
          )
          INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
          SELECT links.media_id, 'event', requested.event_id, 'attachment', 'public', links.sort_order
          FROM requested
          JOIN events ON events.id = requested.event_id
          JOIN media_links AS links
            ON links.entity_type = 'recurring_template'
            AND links.entity_id = ?
            AND links.slot = 'attachment'
          ON CONFLICT DO NOTHING`,
        params: [payload, template.id],
      },
    ];
    const batch = await this.sql.batch(statements);
    const generationAdvanced = returnedRowCount(batch[0]) === 1;
    const createdEventIds = generationAdvanced
      ? returnedRows(batch[2]).flatMap((row) => typeof row[0] === "string" ? [row[0]] : [])
      : [];
    if (!generationAdvanced || createdEventIds.length !== fresh.length) {
      const raced = await this.db
        .select({ id: events.id, instanceDate: events.instanceDate })
        .from(events)
        .where(and(eq(events.seriesId, template.id), inArray(events.instanceDate, planned.map((item) => item.dateKey))));
      const racedByDate = new Map(raced.flatMap((row) => row.instanceDate ? [[row.instanceDate, row.id] as const] : []));
      return {
        templateId: template.id,
        eventIds: planned.flatMap((item) => racedByDate.get(item.dateKey) ?? []),
        createdEventIds,
      };
    }
    return { templateId: template.id, eventIds: allEventIds, createdEventIds };
  }

  private quotaStatements(
    ownerKind: "event" | "recurring_template",
    ownerId: string,
    quotas: readonly EventQuotaWrite[],
    guard?: SqlGuard,
  ): SqlBatchStatement[] {
    if (quotas.length === 0) return [];
    const payload = JSON.stringify(quotas.map((quota) => ({
      tagId: quota.tagId,
      required: quota.required,
      oneTime: quota.oneTime === null ? null : {
        id: quota.oneTime.id,
        label: quota.oneTime.label,
        classIds: quota.oneTime.classIds,
      },
    })));
    const quotaTable = ownerKind === "event" ? "event_class_quotas" : "recurring_template_class_quotas";
    const ownerColumn = ownerKind === "event" ? "event_id" : "template_id";
    const guardClause = guard ? ` AND EXISTS (${guard.sql})` : "";
    const guardParams = guard ? [...guard.params] : [];
    return [
      {
        method: "run",
        sql: `INSERT INTO class_tags (id, label, sort_order, owner_kind, owner_id)
          SELECT CAST(json_extract(value, '$.oneTime.id') AS TEXT),
            CAST(json_extract(value, '$.oneTime.label') AS TEXT), 0, ?, ?
          FROM json_each(?)
          WHERE json_extract(value, '$.oneTime.id') IS NOT NULL${guardClause}`,
        params: [ownerKind, ownerId, payload, ...guardParams],
      },
      {
        method: "run",
        sql: `INSERT INTO class_tag_members (tag_id, class_id)
          SELECT CAST(json_extract(quota.value, '$.oneTime.id') AS TEXT), CAST(classes.value AS TEXT)
          FROM json_each(?) AS quota, json_each(quota.value, '$.oneTime.classIds') AS classes
          WHERE json_extract(quota.value, '$.oneTime.id') IS NOT NULL${guardClause}`,
        params: [payload, ...guardParams],
      },
      {
        method: "run",
        sql: `INSERT INTO ${quotaTable} (${ownerColumn}, tag_id, required)
          SELECT ?, CAST(json_extract(value, '$.tagId') AS TEXT),
            CAST(json_extract(value, '$.required') AS INTEGER)
          FROM json_each(?)${guard ? ` WHERE EXISTS (${guard.sql})` : ""}`,
        params: [ownerId, payload, ...guardParams],
      },
    ];
  }

  private pollInsertStatements(eventId: string, poll: PollWrite, now: string): SqlBatchStatement[] {
    return [
      {
        method: "run",
        sql: "INSERT INTO event_polls (event_id, results_visibility, show_voter_names, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        params: [eventId, poll.resultsVisibility, booleanValue(poll.showVoterNames), now, now],
      },
      this.pollOptionsStatement(eventId, poll.options, now),
    ];
  }

  private pollOptionsStatement(
    eventId: string,
    options: PollWrite["options"],
    now: string,
    guard?: SqlGuard,
  ): SqlBatchStatement {
    const payload = JSON.stringify(options);
    return {
      method: "run",
      sql: `INSERT INTO event_poll_options (id, event_id, label, sort_order, created_at)
        SELECT CAST(json_extract(value, '$.id') AS TEXT), ?,
          CAST(json_extract(value, '$.label') AS TEXT),
          CAST(json_extract(value, '$.sortOrder') AS INTEGER), ?
        FROM json_each(?)${guard ? ` WHERE EXISTS (${guard.sql})` : ""}`,
      params: [eventId, now, payload, ...(guard ? guard.params : [])],
    };
  }

  private weekdayStatements(
    templateId: string,
    rule: RecurringTemplateRecord["recurrenceRule"],
    guard?: SqlGuard,
  ): SqlBatchStatement[] {
    if (rule.frequency !== "weekly") return [];
    return [{
      method: "run",
      sql: `INSERT INTO recurring_template_weekdays (template_id, weekday)
        SELECT ?, CAST(value AS INTEGER) FROM json_each(?)${guard ? ` WHERE EXISTS (${guard.sql})` : ""}`,
      params: [templateId, JSON.stringify(rule.daysOfWeek), ...(guard ? guard.params : [])],
    }];
  }

  private eventSnapshotStatements(
    eventId: string,
    includeParticipants: boolean,
    updatedAt?: string,
  ): SqlBatchStatement[] {
    const timestampGuard = updatedAt === undefined ? "" : " AND event.updated_at = ?";
    return [
      {
        method: "all",
        columns: EVENT_SNAPSHOT_COLUMNS,
        sql: `SELECT
            event.id, event.type, event.title, event.description,
            event.start_at AS startAt, event.end_at AS endAt, event.capacity,
            event.pinned AS pinned, event.signup_locked AS signupLocked,
            event.auto_archive AS autoArchive, event.auto_archived AS autoArchived,
            event.visible_at AS visibleAt, event.archived_at AS archivedAt,
            event.created_by AS createdBy, event.updated_by AS updatedBy,
            event.series_id AS seriesId, event.instance_date AS instanceDate,
            event.winner_count AS winnerCount, event.created_at AS createdAt,
            event.updated_at AS updatedAt
          FROM events AS event
          WHERE event.id = ?${timestampGuard}`,
        params: [eventId, ...(updatedAt === undefined ? [] : [updatedAt])],
      },
      ...this.quotaReadStatements("event", [eventId]),
      {
        method: "all",
        columns: ["event_id", "results_visibility", "show_voter_names", "option_id", "label", "sort_order", "voter_id"],
        sql: `SELECT polls.event_id, polls.results_visibility, polls.show_voter_names,
            options.id AS option_id, options.label, options.sort_order, votes.user_id AS voter_id
          FROM event_polls AS polls
          JOIN event_poll_options AS options ON options.event_id = polls.event_id
          LEFT JOIN event_poll_votes AS votes
            ON votes.event_id = options.event_id AND votes.option_id = options.id
          WHERE polls.event_id = ?
          ORDER BY polls.event_id, options.sort_order, options.id`,
        params: [eventId],
      },
      {
        method: "all",
        columns: ["id", "event_id", "user_id", "drawn_at"],
        sql: "SELECT id, event_id, user_id, drawn_at FROM event_raffle_winners WHERE event_id = ?",
        params: [eventId],
      },
      ...(includeParticipants ? [{
        method: "all" as const,
        columns: ["id", "event_id", "user_id", "joined_at"],
        sql: `SELECT id, event_id, user_id, joined_at FROM event_participants
          WHERE event_id = ? ORDER BY joined_at, id`,
        params: [eventId],
      }] satisfies SqlBatchStatement[] : []),
    ];
  }

  private eventSnapshotFromResults(
    results: readonly SqlResult[],
    includeParticipants: boolean,
  ): EventAggregate | null {
    const [eventResult, quotaResult, quotaMemberResult, pollResult, winnerResult, participantResult] = results;
    if (!eventResult || !quotaResult || !quotaMemberResult || !pollResult || !winnerResult || (includeParticipants && !participantResult)) {
      throw failure("SERVER_ERROR", 500, "SQLite returned incomplete event snapshot results");
    }
    const eventRows = sqlRows(eventResult);
    if (eventRows.length === 0) return null;
    if (eventRows.length !== 1) throw failure("SERVER_ERROR", 500, "SQLite returned multiple event snapshot rows");
    const event = eventRowFromSnapshot(eventRows[0]!);
    const aggregate = this.assembleEventAggregates(
      [event],
      this.quotasFromResults("event", [event.id], [quotaResult, quotaMemberResult]),
      pollRowsFromSnapshot(sqlRows(pollResult)),
      winnerRowsFromSnapshot(sqlRows(winnerResult)),
      includeParticipants ? participantRowsFromSnapshot(sqlRows(participantResult!)) : [],
    )[0];
    if (!aggregate) throw failure("SERVER_ERROR", 500, "SQLite returned an empty event snapshot");
    return aggregate;
  }

  private templateSnapshotStatements(templateId: string, updatedAt?: string): SqlBatchStatement[] {
    const timestampGuard = updatedAt === undefined ? "" : " AND template.updated_at = ?";
    return [
      {
        method: "all",
        columns: TEMPLATE_SNAPSHOT_COLUMNS,
        sql: `SELECT
            template.id, template.type, template.title, template.description,
            template.start_time AS startTime, template.duration_minutes AS durationMinutes,
            template.capacity, template.recurrence_frequency AS recurrenceFrequency,
            template.recurrence_interval AS recurrenceInterval,
            template.recurrence_day_of_month AS recurrenceDayOfMonth,
            template.recurrence_end_after AS recurrenceEndAfter,
            template.recurrence_end_at AS recurrenceEndAt,
            template.visibility_offset_minutes AS visibilityOffsetMinutes,
            template.auto_archive AS autoArchive, template.paused AS paused,
            template.created_by AS createdBy, template.last_generated_date AS lastGeneratedDate,
            template.generation_count AS generationCount, template.created_at AS createdAt,
            template.updated_at AS updatedAt
          FROM recurring_templates AS template
          WHERE template.id = ?${timestampGuard}`,
        params: [templateId, ...(updatedAt === undefined ? [] : [updatedAt])],
      },
      {
        method: "all",
        columns: ["template_id", "weekday"],
        sql: `SELECT template_id, weekday FROM recurring_template_weekdays
          WHERE template_id = ? ORDER BY template_id, weekday`,
        params: [templateId],
      },
      ...this.quotaReadStatements("recurring_template", [templateId]),
    ];
  }

  private templateSnapshotFromResults(results: readonly SqlResult[]): RecurringTemplateAggregate | null {
    const [templateResult, weekdayResult, quotaResult, quotaMemberResult] = results;
    if (!templateResult || !weekdayResult || !quotaResult || !quotaMemberResult) {
      throw failure("SERVER_ERROR", 500, "SQLite returned incomplete template snapshot results");
    }
    const templateRows = sqlRows(templateResult);
    if (templateRows.length === 0) return null;
    if (templateRows.length !== 1) throw failure("SERVER_ERROR", 500, "SQLite returned multiple template snapshot rows");
    const template = templateRowFromSnapshot(templateRows[0]!);
    const weekdays = this.groupTemplateWeekdays(sqlRows(weekdayResult).map((row) => ({
      templateId: snapshotString(row, 0, "template weekday template id"),
      weekday: snapshotInteger(row, 1, "template weekday"),
    })));
    const aggregate = this.assembleTemplateAggregates(
      [template],
      weekdays,
      this.quotasFromResults("recurring_template", [template.id], [quotaResult, quotaMemberResult]),
    )[0];
    if (!aggregate) throw failure("SERVER_ERROR", 500, "SQLite returned an empty template snapshot");
    return aggregate;
  }

  private async hydrateEvents(rows: readonly EventRow[], includeParticipants: boolean): Promise<EventAggregate[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [quotas, pollRows, winners, participants] = await Promise.all([
      this.readEventQuotas(ids),
      this.db
        .select({
          eventId: eventPolls.eventId,
          resultsVisibility: eventPolls.resultsVisibility,
          showVoterNames: eventPolls.showVoterNames,
          optionId: eventPollOptions.id,
          label: eventPollOptions.label,
          sortOrder: eventPollOptions.sortOrder,
          voterId: eventPollVotes.userId,
        })
        .from(eventPolls)
        .innerJoin(eventPollOptions, eq(eventPollOptions.eventId, eventPolls.eventId))
        .leftJoin(eventPollVotes, and(
          eq(eventPollVotes.eventId, eventPollOptions.eventId),
          eq(eventPollVotes.optionId, eventPollOptions.id),
        ))
        .where(inArray(eventPolls.eventId, ids))
        .orderBy(asc(eventPolls.eventId), asc(eventPollOptions.sortOrder), asc(eventPollOptions.id)),
      this.db
        .select({ id: eventRaffleWinners.id, eventId: eventRaffleWinners.eventId, userId: eventRaffleWinners.userId, drawnAt: eventRaffleWinners.drawnAt })
        .from(eventRaffleWinners)
        .where(inArray(eventRaffleWinners.eventId, ids)),
      includeParticipants
        ? this.db
            .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
            .from(eventParticipants)
            .where(inArray(eventParticipants.eventId, ids))
            .orderBy(asc(eventParticipants.joinedAt), asc(eventParticipants.id))
        : Promise.resolve([]),
    ]);

    return this.assembleEventAggregates(rows, quotas, pollRows, winners, participants);
  }

  private assembleEventAggregates(
    rows: readonly EventRow[],
    quotas: ReadonlyMap<string, readonly EventAggregate["classQuotas"][number][]>,
    pollRows: readonly HydratedPollRow[],
    winners: readonly HydratedWinnerRow[],
    participants: readonly HydratedParticipantRow[],
  ): EventAggregate[] {
    const polls = new Map<string, {
      resultsVisibility: EventPollRecord["resultsVisibility"];
      showVoterNames: boolean;
      options: Map<string, { id: string; label: string; sortOrder: number; voterIds: string[] }>;
    }>();
    for (const row of pollRows) {
      const poll = polls.get(row.eventId) ?? {
        resultsVisibility: row.resultsVisibility,
        showVoterNames: row.showVoterNames,
        options: new Map(),
      };
      const option = poll.options.get(row.optionId) ?? {
        id: row.optionId,
        label: row.label,
        sortOrder: row.sortOrder,
        voterIds: [],
      };
      if (row.voterId) option.voterIds.push(row.voterId);
      poll.options.set(row.optionId, option);
      polls.set(row.eventId, poll);
    }
    const winnersByEvent = new Map<string, Array<(typeof winners)[number]>>();
    for (const winner of winners) {
      const eventWinners = winnersByEvent.get(winner.eventId) ?? [];
      eventWinners.push(winner);
      winnersByEvent.set(winner.eventId, eventWinners);
    }
    const participantsByEvent = new Map<string, Array<{
      id: string;
      event_id: string;
      user_id: string;
      joined_at: string;
    }>>();
    for (const participant of participants) {
      const record = {
        id: participant.id,
        event_id: participant.eventId,
        user_id: participant.userId,
        joined_at: participant.joinedAt,
      };
      const eventParticipantRecords = participantsByEvent.get(participant.eventId) ?? [];
      eventParticipantRecords.push(record);
      participantsByEvent.set(participant.eventId, eventParticipantRecords);
    }
    return rows.map((row) => {
      const poll = polls.get(row.id);
      return {
        event: toEventRecord(row),
        attachments: [],
        classQuotas: quotas.get(row.id) ?? [],
        poll: poll
          ? {
              resultsVisibility: poll.resultsVisibility,
              showVoterNames: poll.showVoterNames,
              options: [...poll.options.values()].sort((left, right) => left.sortOrder - right.sortOrder),
            }
          : null,
        raffleWinners: winnersByEvent.get(row.id) ?? [],
        participants: participantsByEvent.get(row.id) ?? [],
      };
    });
  }

  private async readEventQuotas(eventIds: readonly string[]) {
    return this.readQuotas("event", eventIds);
  }

  private async readTemplateQuotas(templateIds: readonly string[]) {
    return this.readQuotas("recurring_template", templateIds);
  }

  private quotaReadStatements(
    ownerKind: "event" | "recurring_template",
    ownerIds: readonly string[],
  ): SqlReadBatchStatement[] {
    const quotaTable = ownerKind === "event" ? "event_class_quotas" : "recurring_template_class_quotas";
    const ownerColumn = ownerKind === "event" ? "event_id" : "template_id";
    const quotaRowLimit = ownerIds.length * LIMITS.content.eventClassQuotas.max;
    const ownerIdsJson = JSON.stringify(ownerIds);
    return [
      {
        method: "all",
        columns: ["owner_id", "tag_id", "required", "label", "owner_kind"],
        sql: `SELECT quotas.${ownerColumn} AS owner_id, quotas.tag_id, quotas.required,
            tags.label, tags.owner_kind
          FROM ${quotaTable} AS quotas
          JOIN class_tags AS tags ON tags.id = quotas.tag_id
          WHERE quotas.${ownerColumn} IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          ORDER BY quotas.${ownerColumn}, tags.sort_order, tags.id
          LIMIT ?`,
        params: [ownerIdsJson, quotaRowLimit + 1],
      },
      {
        method: "all",
        columns: ["tag_id", "class_id"],
        sql: `WITH involved_tags AS (
            SELECT DISTINCT quotas.tag_id
            FROM ${quotaTable} AS quotas
            WHERE quotas.${ownerColumn} IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          )
          SELECT members.tag_id, members.class_id
          FROM involved_tags
          JOIN class_tag_members AS members ON members.tag_id = involved_tags.tag_id
          ORDER BY members.tag_id, members.class_id
          LIMIT ?`,
        params: [ownerIdsJson, CLASS_TAG_MEMBER_ROW_LIMIT + 1],
      },
    ];
  }

  private async readQuotas(ownerKind: "event" | "recurring_template", ownerIds: readonly string[]) {
    const results = await this.sql.readBatch(this.quotaReadStatements(ownerKind, ownerIds));
    return this.quotasFromResults(ownerKind, ownerIds, results);
  }

  private quotasFromResults(
    ownerKind: "event" | "recurring_template",
    ownerIds: readonly string[],
    results: readonly SqlResult[],
  ) {
    const quotaRowLimit = ownerIds.length * LIMITS.content.eventClassQuotas.max;
    if (results.length !== 2) throw failure("SERVER_ERROR", 500, "SQLite returned invalid quota hydration results");
    const quotaRows = sqlRows(results[0]!);
    const memberRows = sqlRows(results[1]!);
    if (quotaRows.length > quotaRowLimit) {
      const label = ownerKind === "event" ? "Event" : "Recurring template";
      throw failure("SERVER_ERROR", 500, `${label} quota hydration exceeded its hard limit`);
    }
    if (memberRows.length > CLASS_TAG_MEMBER_ROW_LIMIT) {
      throw failure("SERVER_ERROR", 500, "Class quota member hydration exceeded its hard limit");
    }
    return this.groupQuotas(quotaRows, memberRows);
  }

  private groupQuotas(
    rows: readonly (readonly SqlValue[])[],
    memberRows: readonly (readonly SqlValue[])[],
  ) {
    type Quota = {
      tag_id: string;
      label: string | null;
      class_ids: string[];
      required: number;
      one_time: boolean;
    };
    type QuotaRow = Readonly<{
      ownerId: string;
      tagId: string;
      required: number;
      label: string;
      ownerKind: "event" | "recurring_template" | null;
    }>;
    const parsedRows: QuotaRow[] = [];
    const classIdsByTag = new Map<string, string[]>();
    for (const row of rows) {
      const [ownerId, tagId, required, label, ownerKind] = row;
      if (
        typeof ownerId !== "string" || !ownerId
        || typeof tagId !== "string" || !tagId
        || typeof required !== "number" || !Number.isSafeInteger(required) || required < 1
        || typeof label !== "string" || !label
        || (ownerKind !== null && ownerKind !== "event" && ownerKind !== "recurring_template")
      ) {
        throw failure("SERVER_ERROR", 500, "SQLite returned invalid class quota rows");
      }
      parsedRows.push({ ownerId, tagId, required, label, ownerKind });
      if (!classIdsByTag.has(tagId)) classIdsByTag.set(tagId, []);
    }
    for (const row of memberRows) {
      const [tagId, classId] = row;
      const classIds = typeof tagId === "string" ? classIdsByTag.get(tagId) : undefined;
      if (!classIds || typeof classId !== "string" || !classId) {
        throw failure("SERVER_ERROR", 500, "SQLite returned invalid class quota members");
      }
      classIds.push(classId);
    }
    const byOwner = new Map<string, Quota[]>();
    for (const row of parsedRows) {
      const list = byOwner.get(row.ownerId) ?? [];
      list.push({
        tag_id: row.tagId,
        label: row.label,
        class_ids: classIdsByTag.get(row.tagId)!,
        required: row.required,
        one_time: row.ownerKind !== null,
      });
      byOwner.set(row.ownerId, list);
    }
    return byOwner;
  }

  private async hydrateTemplates(rows: readonly TemplateRow[]): Promise<RecurringTemplateAggregate[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [weekdayRows, quotas] = await Promise.all([
      this.db
        .select({ templateId: recurringTemplateWeekdays.templateId, weekday: recurringTemplateWeekdays.weekday })
        .from(recurringTemplateWeekdays)
        .where(inArray(recurringTemplateWeekdays.templateId, ids))
        .orderBy(asc(recurringTemplateWeekdays.templateId), asc(recurringTemplateWeekdays.weekday)),
      this.readTemplateQuotas(ids),
    ]);
    const weekdays = this.groupTemplateWeekdays(weekdayRows);
    return this.assembleTemplateAggregates(rows, weekdays, quotas);
  }

  private groupTemplateWeekdays(
    rows: readonly Readonly<{ templateId: string; weekday: number }>[],
  ): Map<string, number[]> {
    const weekdays = new Map<string, number[]>();
    for (const row of rows) {
      const templateWeekdays = weekdays.get(row.templateId) ?? [];
      templateWeekdays.push(row.weekday);
      weekdays.set(row.templateId, templateWeekdays);
    }
    return weekdays;
  }

  private assembleTemplateAggregates(
    rows: readonly TemplateRow[],
    weekdays: ReadonlyMap<string, readonly number[]>,
    quotas: ReadonlyMap<string, readonly RecurringTemplateAggregate["classQuotas"][number][]>,
  ): RecurringTemplateAggregate[] {
    return rows.map((row) => ({
      template: {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        startTime: row.startTime,
        durationMinutes: row.durationMinutes,
        capacity: row.capacity,
        recurrenceRule: recurrenceRule(row, weekdays.get(row.id) ?? []),
        visibilityOffsetMinutes: row.visibilityOffsetMinutes,
        autoArchive: row.autoArchive,
        paused: row.paused,
        createdBy: row.createdBy,
        lastGeneratedDate: row.lastGeneratedDate,
        generationCount: row.generationCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      attachments: [],
      classQuotas: quotas.get(row.id) ?? [],
    }));
  }
}
