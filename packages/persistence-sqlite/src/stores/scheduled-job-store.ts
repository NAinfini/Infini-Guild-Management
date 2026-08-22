import type {
  BoundedAnnouncementPublishStore,
  BoundedEventAutoArchiveStore,
  BoundedRaffleAutoDrawStore,
  SessionCleanupJob,
} from "@guild/server/modules/jobs";
import type { EventsPollRaffleStore } from "@guild/server/modules/events";
import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";
import { auditInsertSelectStatement } from "./audit-statement.js";
import {
  observedBacklog,
  SCHEDULED_BACKLOG_READ_LIMIT,
} from "./scheduled-backlog.js";
import { returnedRows } from "./sql-result.js";

const dueEventWhere = `archived_at IS NULL
  AND auto_archive = 1
  AND auto_archived = 0
  AND ((end_at IS NOT NULL AND end_at < ?) OR (end_at IS NULL AND start_at < ?))
  AND NOT (
    type = 'raffle'
    AND NOT EXISTS (SELECT 1 FROM event_raffle_winners WHERE event_id = events.id)
  )`;

const dueAnnouncementWhere = "status = 'scheduled' AND publish_at <= ?";
const dueRaffleWhere = `type = 'raffle'
  AND archived_at IS NULL
  AND end_at <= ?
  AND winner_count IS NOT NULL
  AND EXISTS (SELECT 1 FROM event_participants participant WHERE participant.event_id = events.id)
  AND NOT EXISTS (SELECT 1 FROM event_raffle_draws draw WHERE draw.event_id = events.id)`;

export const SESSION_CLEANUP_EXPIRES_CANDIDATES_SQL = `SELECT token_digest FROM sessions
  WHERE expires_at <= ?
  ORDER BY expires_at, token_digest
  LIMIT ?`;

export const SESSION_CLEANUP_CREATED_CANDIDATES_SQL = `SELECT token_digest FROM sessions
  WHERE created_at <= ?
  ORDER BY created_at, token_digest
  LIMIT ?`;

function rows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw new TypeError("SQLite returned invalid scheduled-job rows");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function firstCell(result: SqlResult): SqlValue | undefined {
  return Array.isArray(result.rows) && !Array.isArray(result.rows[0])
    ? result.rows[0]
    : undefined;
}

function assertLimit(limit: number, maximum: number, job: string): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(`${job} limit must be between 1 and ${maximum}`);
  }
}

export class SqliteEventAutoArchiveStore implements BoundedEventAutoArchiveStore {
  constructor(private readonly sql: SqlExecutor) {}

  async archiveDue(input: Parameters<BoundedEventAutoArchiveStore["archiveDue"]>[0]) {
    assertLimit(input.limit, 50, "Event auto-archive");
    const selected = rows(await this.sql.execute({
      method: "all",
      sql: `SELECT id, title FROM events
        WHERE ${dueEventWhere}
        ORDER BY COALESCE(end_at, start_at), id
        LIMIT ?`,
      params: [input.now, input.now, input.limit],
    })).map((row) => {
      const [id, title] = row;
      if (typeof id !== "string" || typeof title !== "string") {
        throw new TypeError("SQLite returned an invalid event auto-archive row");
      }
      return { id, title };
    });

    const audits = selected.map(({ id, title }) => input.audit({
        subjectType: "event",
        subjectId: id,
        subjectLabel: title,
        action: "archive",
        changes: [{
          field: "archived",
          before: { type: "boolean", value: false },
          after: { type: "boolean", value: true },
        }],
      }));
    const payload = JSON.stringify(audits);
    const results = selected.length === 0 ? [] : await this.sql.batch([
      {
        method: "all",
        columns: ["id"],
        sql: `UPDATE events SET archived_at = ?, updated_at = ?, auto_archived = 1
          WHERE id IN (
            SELECT CAST(json_extract(value, '$.subjectId') AS TEXT) FROM json_each(?)
          ) AND ${dueEventWhere}
          RETURNING id`,
        params: [input.now, input.now, payload, input.now, input.now],
      },
      auditInsertSelectStatement(
        `SELECT
          CAST(json_extract(payload.value, '$.eventId') AS TEXT),
          CAST(json_extract(payload.value, '$.requestId') AS TEXT),
          CAST(json_extract(payload.value, '$.actorKind') AS TEXT),
          CAST(json_extract(payload.value, '$.actorId') AS TEXT),
          CASE WHEN json_extract(payload.value, '$.actorKind') = 'user'
            THEN (SELECT username FROM users WHERE id = CAST(json_extract(payload.value, '$.actorId') AS TEXT))
            ELSE json_extract(payload.value, '$.actorLabel') END,
          CAST(json_extract(payload.value, '$.subjectType') AS TEXT),
          CAST(json_extract(payload.value, '$.subjectId') AS TEXT),
          json_extract(payload.value, '$.subjectLabel'),
          CAST(json_extract(payload.value, '$.action') AS TEXT),
          json_extract(payload.value, '$.payload'),
          CAST(json_extract(payload.value, '$.occurredAt') AS TEXT)
        FROM json_each(?) AS payload
        JOIN events ON events.id = CAST(json_extract(payload.value, '$.subjectId') AS TEXT)
        WHERE events.auto_archived = 1 AND events.archived_at = ? AND events.updated_at = ?`,
        [payload, input.now, input.now],
      ),
    ]);
    const eventIds = results.length === 0
      ? []
      : returnedRows(results[0]).map((row) => {
        const id = row[0];
        if (typeof id !== "string") throw new TypeError("SQLite returned an invalid archived event id");
        return id;
      });
    const hasMore = firstCell(await this.sql.execute({
      method: "get",
      sql: `SELECT 1 FROM events WHERE ${dueEventWhere} LIMIT 1`,
      params: [input.now, input.now],
    })) === 1;
    return { eventIds, hasMore };
  }

  async inspectBacklog(now: string) {
    const pendingAt = rows(await this.sql.execute({
      method: "all",
      columns: ["pending_at"],
      sql: `SELECT COALESCE(end_at, start_at) AS pending_at FROM events
        WHERE ${dueEventWhere}
        ORDER BY COALESCE(end_at, start_at), id
        LIMIT ?`,
      params: [now, now, SCHEDULED_BACKLOG_READ_LIMIT],
    })).map((row) => {
      const value = row[0];
      if (typeof value !== "string") throw new TypeError("SQLite returned an invalid event backlog row");
      return value;
    });
    return observedBacklog(pendingAt);
  }
}

export class SqliteAnnouncementPublishStore implements BoundedAnnouncementPublishStore {
  constructor(private readonly sql: SqlExecutor) {}

  async publishDue(input: Parameters<BoundedAnnouncementPublishStore["publishDue"]>[0]) {
    assertLimit(input.limit, 50, "Announcement publish");
    const selected = rows(await this.sql.execute({
      method: "all",
      columns: ["id", "title", "publish_at"],
      sql: `SELECT id, title, publish_at FROM announcements INDEXED BY idx_announcements_schedule
        WHERE ${dueAnnouncementWhere}
        ORDER BY publish_at, id
        LIMIT ?`,
      params: [input.now, input.limit + 1],
    })).map((row) => {
      const [id, title, publishAt] = row;
      if (typeof id !== "string" || typeof title !== "string" || typeof publishAt !== "string") {
        throw new TypeError("SQLite returned an invalid scheduled announcement row");
      }
      return { id, title, publishAt };
    });
    const candidates = selected.slice(0, input.limit);
    if (candidates.length === 0) return { announcements: [], hasMore: false };

    const payload = JSON.stringify(candidates.map((candidate) => {
      const audit = input.audit({
        subjectType: "announcement",
        subjectId: candidate.id,
        subjectLabel: candidate.title,
        action: "publish",
        changes: [{
          field: "status",
          before: { type: "code", value: "scheduled" },
          after: { type: "code", value: "published" },
        }],
        context: [{ field: "publish_at", value: { type: "datetime", value: candidate.publishAt } }],
      });
      return {
        announcementId: candidate.id,
        revisionToken: audit.eventId,
        audit,
      };
    }));
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["id", "title", "publish_at"],
        sql: `WITH payload AS (
            SELECT
              CAST(json_extract(value, '$.announcementId') AS TEXT) AS announcement_id,
              CAST(json_extract(value, '$.revisionToken') AS TEXT) AS revision_token
            FROM json_each(?)
          )
          UPDATE announcements
          SET status = 'published', updated_at = ?,
            revision_token = (SELECT payload.revision_token FROM payload WHERE payload.announcement_id = announcements.id)
          WHERE id IN (SELECT announcement_id FROM payload)
            AND ${dueAnnouncementWhere}
          RETURNING id, title, publish_at`,
        params: [payload, input.now, input.now],
      },
      {
        method: "run",
        sql: `UPDATE media_links SET audience = 'public'
          WHERE entity_type = 'announcement' AND slot = 'body'
            AND EXISTS (
              SELECT 1 FROM json_each(?) AS payload
              JOIN announcements ON announcements.id = CAST(json_extract(payload.value, '$.announcementId') AS TEXT)
              WHERE announcements.id = media_links.entity_id
                AND announcements.revision_token = CAST(json_extract(payload.value, '$.revisionToken') AS TEXT)
            )`,
        params: [payload],
      },
      auditInsertSelectStatement(
        `SELECT
          CAST(json_extract(payload.value, '$.audit.eventId') AS TEXT),
          CAST(json_extract(payload.value, '$.audit.requestId') AS TEXT),
          CAST(json_extract(payload.value, '$.audit.actorKind') AS TEXT),
          CAST(json_extract(payload.value, '$.audit.actorId') AS TEXT),
          CASE WHEN json_extract(payload.value, '$.audit.actorKind') = 'user'
            THEN (SELECT username FROM users WHERE id = CAST(json_extract(payload.value, '$.audit.actorId') AS TEXT))
            ELSE json_extract(payload.value, '$.audit.actorLabel') END,
          CAST(json_extract(payload.value, '$.audit.subjectType') AS TEXT),
          CAST(json_extract(payload.value, '$.audit.subjectId') AS TEXT),
          json_extract(payload.value, '$.audit.subjectLabel'),
          CAST(json_extract(payload.value, '$.audit.action') AS TEXT),
          json_extract(payload.value, '$.audit.payload'),
          CAST(json_extract(payload.value, '$.audit.occurredAt') AS TEXT)
        FROM json_each(?) AS payload
        JOIN announcements ON announcements.id = CAST(json_extract(payload.value, '$.announcementId') AS TEXT)
          AND announcements.revision_token = CAST(json_extract(payload.value, '$.revisionToken') AS TEXT)`,
        [payload],
      ),
    ]);
    const announcements = returnedRows(results[0]).map((row) => {
      const [id, title, publishedAt] = row;
      if (typeof id !== "string" || typeof title !== "string" || typeof publishedAt !== "string") {
        throw new TypeError("SQLite returned an invalid published announcement row");
      }
      return { id, title, publishedAt };
    });
    return { announcements, hasMore: selected.length > input.limit };
  }

  async inspectBacklog(now: string) {
    const pendingAt = rows(await this.sql.execute({
      method: "all",
      columns: ["publish_at"],
      sql: `SELECT publish_at FROM announcements INDEXED BY idx_announcements_schedule
        WHERE ${dueAnnouncementWhere}
        ORDER BY publish_at, id
        LIMIT ?`,
      params: [now, SCHEDULED_BACKLOG_READ_LIMIT],
    })).map((row) => {
      const value = row[0];
      if (typeof value !== "string") throw new TypeError("SQLite returned an invalid announcement backlog row");
      return value;
    });
    return observedBacklog(pendingAt);
  }
}

export class SqliteRaffleAutoDrawStore implements BoundedRaffleAutoDrawStore {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly draws: Pick<EventsPollRaffleStore, "drawRaffle">,
  ) {}

  async listDue(now: string, limit: number) {
    assertLimit(limit, 25, "Raffle auto-draw");
    const selected = rows(await this.sql.execute({
      method: "all",
      columns: ["id", "title", "winner_count", "created_by"],
      sql: `SELECT id, title, winner_count, created_by FROM events INDEXED BY idx_events_raffle_due
        WHERE ${dueRaffleWhere}
        ORDER BY end_at, id
        LIMIT ?`,
      params: [now, limit + 1],
    })).map((row) => {
      const [eventId, title, winnerCount, drawnByUserId] = row;
      if (
        typeof eventId !== "string" || typeof title !== "string"
        || typeof winnerCount !== "number" || !Number.isSafeInteger(winnerCount) || winnerCount < 1
        || typeof drawnByUserId !== "string"
      ) throw new TypeError("SQLite returned an invalid due raffle row");
      return { eventId, title, winnerCount, drawnByUserId };
    });
    const candidates = selected.slice(0, limit);
    if (candidates.length === 0) return { raffles: [], hasMore: false };
    const participantRows = rows(await this.sql.execute({
      method: "all",
      columns: ["event_id", "user_id", "participant_number"],
      sql: `WITH ranked AS (
          SELECT event_id, user_id,
            row_number() OVER (PARTITION BY event_id ORDER BY joined_at, id) AS participant_number
          FROM event_participants
          WHERE event_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        )
        SELECT event_id, user_id, participant_number FROM ranked
        WHERE participant_number <= ?
        ORDER BY event_id, participant_number`,
      params: [
        JSON.stringify(candidates.map(({ eventId }) => eventId)),
        LIMITS.content.eventParticipantsPerEvent.max + 1,
      ],
    }));
    const participants = new Map<string, string[]>();
    for (const row of participantRows) {
      const [eventId, userId, participantNumber] = row;
      if (
        typeof eventId !== "string" || typeof userId !== "string"
        || typeof participantNumber !== "number" || !Number.isSafeInteger(participantNumber)
      ) {
        throw new TypeError("SQLite returned an invalid due raffle participant row");
      }
      if (participantNumber > LIMITS.content.eventParticipantsPerEvent.max) {
        throw new TypeError(`Raffle ${eventId} exceeds the participant limit`);
      }
      const list = participants.get(eventId) ?? [];
      list.push(userId);
      participants.set(eventId, list);
    }
    return {
      raffles: candidates.map((candidate) => ({
        ...candidate,
        participantIds: participants.get(candidate.eventId) ?? [],
      })),
      hasMore: selected.length > limit,
    };
  }

  async drawRaffle(input: Parameters<BoundedRaffleAutoDrawStore["drawRaffle"]>[0]): Promise<void> {
    await this.draws.drawRaffle(
      input.eventId,
      input.winnerIds,
      input.winnerRowIds,
      input.now,
      input.drawnByUserId,
      input.audit,
    );
  }

  async inspectBacklog(now: string) {
    const pendingAt = rows(await this.sql.execute({
      method: "all",
      columns: ["end_at"],
      sql: `SELECT end_at FROM events INDEXED BY idx_events_raffle_due
        WHERE ${dueRaffleWhere}
        ORDER BY end_at, id
        LIMIT ?`,
      params: [now, SCHEDULED_BACKLOG_READ_LIMIT],
    })).map((row) => {
      const value = row[0];
      if (typeof value !== "string") throw new TypeError("SQLite returned an invalid raffle backlog row");
      return value;
    });
    return observedBacklog(pendingAt);
  }
}

export class SqliteSessionCleanupJob implements SessionCleanupJob {
  constructor(private readonly sql: SqlExecutor) {}

  async run(input: Parameters<SessionCleanupJob["run"]>[0]) {
    assertLimit(input.limit, 500, "Session cleanup");
    const selected = await this.sql.batch([
      {
        method: "all",
        columns: ["token_digest"],
        sql: SESSION_CLEANUP_EXPIRES_CANDIDATES_SQL,
        params: [input.expiresBefore, input.limit],
      },
      {
        method: "all",
        columns: ["token_digest"],
        sql: SESSION_CLEANUP_CREATED_CANDIDATES_SQL,
        params: [input.createdBefore, input.limit],
      },
    ]);
    const candidates = [...new Set(selected.flatMap((result) => rows(result).map((row) => {
      const tokenDigest = row[0];
      if (typeof tokenDigest !== "string") throw new TypeError("SQLite returned an invalid session cleanup row");
      return tokenDigest;
    })))].slice(0, input.limit);

    let processed = 0;
    if (candidates.length > 0) {
      const mutation = await this.sql.batch([
        {
          method: "all",
          columns: ["token_digest"],
          sql: `DELETE FROM sessions
            WHERE token_digest IN (SELECT CAST(value AS TEXT) FROM json_each(?))
              AND (expires_at <= ? OR created_at <= ?)
            RETURNING token_digest`,
          params: [JSON.stringify(candidates), input.expiresBefore, input.createdBefore],
        },
      ]);
      processed = returnedRows(mutation[0]).length;
    }

    const remaining = await this.sql.batch([
      {
        method: "get",
        columns: ["present"],
        sql: "SELECT 1 AS present FROM sessions WHERE expires_at <= ? ORDER BY expires_at, token_digest LIMIT 1",
        params: [input.expiresBefore],
      },
      {
        method: "get",
        columns: ["present"],
        sql: "SELECT 1 AS present FROM sessions WHERE created_at <= ? ORDER BY created_at, token_digest LIMIT 1",
        params: [input.createdBefore],
      },
    ]);
    const hasMore = remaining.some((result) => firstCell(result) === 1);
    return { processed, hasMore };
  }

  async inspectBacklog(input: Parameters<SessionCleanupJob["inspectBacklog"]>[0]) {
    const observed = await this.sql.batch([
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT token_digest, expires_at AS pending_at FROM sessions
          WHERE expires_at <= ? ORDER BY expires_at, token_digest LIMIT ?`,
        params: [input.expiresBefore, SCHEDULED_BACKLOG_READ_LIMIT],
      },
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT token_digest, created_at AS pending_at FROM sessions
          WHERE created_at <= ? ORDER BY created_at, token_digest LIMIT ?`,
        params: [input.createdBefore, SCHEDULED_BACKLOG_READ_LIMIT],
      },
    ]);
    const pendingBySession = new Map<string, string>();
    for (const row of observed.flatMap((result) => rows(result))) {
      const [tokenDigest, pendingAt] = row;
      if (typeof tokenDigest !== "string" || typeof pendingAt !== "string") {
        throw new TypeError("SQLite returned an invalid session backlog row");
      }
      const current = pendingBySession.get(tokenDigest);
      if (!current || pendingAt < current) pendingBySession.set(tokenDigest, pendingAt);
    }
    const uniquePendingCount = pendingBySession.size;
    const pendingAt = [...pendingBySession.values()]
      .sort()
      .slice(0, SCHEDULED_BACKLOG_READ_LIMIT);
    return observedBacklog(
      pendingAt,
      uniquePendingCount > SCHEDULED_BACKLOG_READ_LIMIT
        || observed.some((result) => rows(result).length === SCHEDULED_BACKLOG_READ_LIMIT),
    );
  }
}
