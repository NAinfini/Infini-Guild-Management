import type {
  BoundedAnnouncementPublishStore,
  BoundedEventAutoArchiveStore,
  BoundedRaffleAutoDrawStore,
  SessionCleanupJob,
} from "@guild/server/modules/jobs";
import type { EventsPollRaffleStore } from "@guild/server/modules/events";
import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { NOTIFICATION_INBOX_RETENTION_DAYS } from "@guild/shared";
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

export const SESSION_CLEANUP_EXPIRES_CANDIDATES_SQL = `SELECT token_digest AS candidate_key, expires_at AS pending_at FROM sessions
  WHERE expires_at <= ?
  ORDER BY expires_at, token_digest
  LIMIT ?`;

export const SESSION_CLEANUP_CREATED_CANDIDATES_SQL = `SELECT token_digest AS candidate_key, created_at AS pending_at FROM sessions
  WHERE created_at <= ?
  ORDER BY created_at, token_digest
  LIMIT ?`;

function rows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw new TypeError("SQLite returned invalid scheduled-job rows");
  }
  return result.rows as readonly (readonly SqlValue[])[];
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
    const due = await this.selectDue(input.now, input.limit + 1);
    const selected = due.slice(0, input.limit);

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
            THEN (SELECT display_name FROM users WHERE id = CAST(json_extract(payload.value, '$.actorId') AS TEXT))
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
    return { eventIds, hasMore: due.length > input.limit };
  }

  async inspectBacklog(now: string) {
    const pendingAt = (await this.selectDue(now, SCHEDULED_BACKLOG_READ_LIMIT))
      .map((candidate) => candidate.pendingAt);
    return observedBacklog(pendingAt);
  }

  private async selectDue(now: string, limit: number): Promise<readonly Readonly<{
    id: string;
    title: string;
    pendingAt: string;
  }>[]> {
    const [ended, started] = await this.sql.readBatch([
      {
        method: "all",
        columns: ["id", "title", "pending_at"],
        sql: `SELECT id, title, end_at AS pending_at
          FROM events INDEXED BY idx_events_auto_archive_end_due
          WHERE archived_at IS NULL
            AND auto_archive = 1
            AND auto_archived = 0
            AND end_at IS NOT NULL
            AND end_at < ?
            AND NOT (
              type = 'raffle'
              AND NOT EXISTS (SELECT 1 FROM event_raffle_winners WHERE event_id = events.id)
            )
          ORDER BY end_at, id
          LIMIT ?`,
        params: [now, limit],
      },
      {
        method: "all",
        columns: ["id", "title", "pending_at"],
        sql: `SELECT id, title, start_at AS pending_at
          FROM events INDEXED BY idx_events_auto_archive_start_due
          WHERE archived_at IS NULL
            AND auto_archive = 1
            AND auto_archived = 0
            AND end_at IS NULL
            AND start_at < ?
            AND NOT (
              type = 'raffle'
              AND NOT EXISTS (SELECT 1 FROM event_raffle_winners WHERE event_id = events.id)
            )
          ORDER BY start_at, id
          LIMIT ?`,
        params: [now, limit],
      },
    ]);
    if (!ended || !started) throw new TypeError("SQLite omitted an event auto-archive result set");
    return [...rows(ended), ...rows(started)]
      .map((row) => {
        const [id, title, pendingAt] = row;
        if (typeof id !== "string" || typeof title !== "string" || typeof pendingAt !== "string") {
          throw new TypeError("SQLite returned an invalid event auto-archive row");
        }
        return { id, title, pendingAt };
      })
      .sort((left, right) => left.pendingAt.localeCompare(right.pendingAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }
}

export class SqliteAnnouncementPublishStore implements BoundedAnnouncementPublishStore {
  constructor(private readonly sql: SqlExecutor) {}

  async publishDue(input: Parameters<BoundedAnnouncementPublishStore["publishDue"]>[0]) {
    assertLimit(input.limit, 50, "Announcement publish");
    const selected = rows(await this.sql.read({
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
          WHERE entity_type = 'announcement' AND slot IN ('body', 'attachment')
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
            THEN (SELECT display_name FROM users WHERE id = CAST(json_extract(payload.value, '$.audit.actorId') AS TEXT))
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
    const pendingAt = rows(await this.sql.read({
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
    const selected = rows(await this.sql.read({
      method: "all",
      columns: ["id", "title", "winner_count", "created_by", "updated_at"],
      sql: `SELECT id, title, winner_count, created_by, updated_at FROM events INDEXED BY idx_events_raffle_due
        WHERE ${dueRaffleWhere}
        ORDER BY end_at, id
        LIMIT ?`,
      params: [now, limit + 1],
    })).map((row) => {
      const [eventId, title, winnerCount, drawnByUserId, updatedAt] = row;
      if (
        typeof eventId !== "string" || typeof title !== "string"
        || typeof winnerCount !== "number" || !Number.isSafeInteger(winnerCount) || winnerCount < 1
        || typeof drawnByUserId !== "string" || typeof updatedAt !== "string"
      ) throw new TypeError("SQLite returned an invalid due raffle row");
      return { eventId, title, winnerCount, drawnByUserId, updatedAt };
    });
    const candidates = selected.slice(0, limit);
    if (candidates.length === 0) return { raffles: [], hasMore: false };
    const participantRows = rows(await this.sql.read({
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
    await this.draws.drawRaffle({
      eventId: input.eventId,
      winnerIds: input.winnerIds,
      winnerRowIds: input.winnerRowIds,
      now: input.now,
      actorUserId: input.drawnByUserId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      updatedAt: input.updatedAt,
      audit: input.audit,
    });
  }

  async inspectBacklog(now: string) {
    const pendingAt = rows(await this.sql.read({
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
    const cutoffs = maintenanceCutoffs(input.expiresBefore);
    const windowLimit = input.limit + 1;
    const selected = await this.sql.readBatch([
      {
        method: "all",
        columns: ["candidate_key", "pending_at"],
        sql: SESSION_CLEANUP_EXPIRES_CANDIDATES_SQL,
        params: [input.expiresBefore, windowLimit],
      },
      {
        method: "all",
        columns: ["candidate_key", "pending_at"],
        sql: SESSION_CLEANUP_CREATED_CANDIDATES_SQL,
        params: [input.createdBefore, windowLimit],
      },
      {
        method: "all",
        columns: ["candidate_key", "pending_at"],
        sql: `SELECT id AS candidate_key, occurred_at AS pending_at FROM notification_inbox
          WHERE occurred_at < ? ORDER BY occurred_at, id LIMIT ?`,
        params: [cutoffs.notificationInbox, windowLimit],
      },
      {
        method: "all",
        columns: ["candidate_key", "pending_at"],
        sql: `SELECT state_digest AS candidate_key, expires_at AS pending_at
          FROM oauth_challenges INDEXED BY idx_oauth_challenges_cleanup_expiry
          WHERE expires_at <= ? ORDER BY expires_at, state_digest LIMIT ?`,
        params: [cutoffs.transientAuth, windowLimit],
      },
      {
        method: "all",
        columns: ["candidate_key", "pending_at"],
        sql: `SELECT state_digest AS candidate_key, consumed_at AS pending_at
          FROM oauth_challenges INDEXED BY idx_oauth_challenges_cleanup_consumed
          WHERE consumed_at IS NOT NULL AND consumed_at <= ?
          ORDER BY consumed_at, state_digest LIMIT ?`,
        params: [cutoffs.transientAuth, windowLimit],
      },
      {
        method: "all",
        columns: ["candidate_key", "pending_at"],
        sql: `SELECT token_digest AS candidate_key, expires_at AS pending_at
          FROM email_verification_challenges INDEXED BY idx_email_verification_cleanup_expiry
          WHERE expires_at <= ? ORDER BY expires_at, token_digest LIMIT ?`,
        params: [cutoffs.transientAuth, windowLimit],
      },
      {
        method: "all",
        columns: ["candidate_key", "pending_at"],
        sql: `SELECT token_digest AS candidate_key, consumed_at AS pending_at
          FROM email_verification_challenges INDEXED BY idx_email_verification_cleanup_consumed
          WHERE consumed_at IS NOT NULL AND consumed_at <= ?
          ORDER BY consumed_at, token_digest LIMIT ?`,
        params: [cutoffs.transientAuth, windowLimit],
      },
    ]);
    const kinds = ["session", "session", "notification", "oauth", "oauth", "email", "email"] as const;
    type Candidate = Readonly<{ kind: (typeof kinds)[number]; key: string; pendingAt: string }>;
    const candidatesByIdentity = new Map<string, Candidate>();
    selected.forEach((result, index) => {
      const kind = kinds[index];
      if (kind === undefined) throw new TypeError("SQLite returned an unknown cleanup result set");
      for (const row of rows(result)) {
        const [key, pendingAt] = row;
        if (typeof key !== "string" || typeof pendingAt !== "string") {
          throw new TypeError("SQLite returned an invalid maintenance cleanup row");
        }
        const identity = `${kind}\u0000${key}`;
        const existing = candidatesByIdentity.get(identity);
        if (existing === undefined || pendingAt < existing.pendingAt) {
          candidatesByIdentity.set(identity, { kind, key, pendingAt });
        }
      }
    });
    const candidates = [...candidatesByIdentity.values()]
      .sort((left, right) => left.pendingAt.localeCompare(right.pendingAt)
        || left.kind.localeCompare(right.kind)
        || left.key.localeCompare(right.key))
      .slice(0, input.limit);
    const hasMore = candidatesByIdentity.size > input.limit;
    if (candidates.length === 0) return { processed: 0, hasMore: false };
    const candidateKeys = (kind: Candidate["kind"]): string => JSON.stringify(
      candidates.filter((candidate) => candidate.kind === kind).map((candidate) => candidate.key),
    );

    const mutation = await this.sql.batch([
      {
        method: "all",
        columns: ["token_digest"],
        sql: `DELETE FROM sessions
          WHERE token_digest IN (SELECT CAST(value AS TEXT) FROM json_each(?))
            AND (expires_at <= ? OR created_at <= ?)
          RETURNING token_digest`,
        params: [candidateKeys("session"), input.expiresBefore, input.createdBefore],
      },
      {
        method: "all",
        columns: ["id"],
        sql: `DELETE FROM notification_inbox
          WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
            AND occurred_at < ?
          RETURNING id`,
        params: [candidateKeys("notification"), cutoffs.notificationInbox],
      },
      {
        method: "all",
        columns: ["state_digest"],
        sql: `DELETE FROM oauth_challenges
          WHERE state_digest IN (SELECT CAST(value AS TEXT) FROM json_each(?))
            AND (expires_at <= ? OR consumed_at <= ?)
          RETURNING state_digest`,
        params: [candidateKeys("oauth"), cutoffs.transientAuth, cutoffs.transientAuth],
      },
      {
        method: "all",
        columns: ["token_digest"],
        sql: `DELETE FROM email_verification_challenges
          WHERE token_digest IN (SELECT CAST(value AS TEXT) FROM json_each(?))
            AND (expires_at <= ? OR consumed_at <= ?)
          RETURNING token_digest`,
        params: [candidateKeys("email"), cutoffs.transientAuth, cutoffs.transientAuth],
      },
    ]);
    const processed = mutation.reduce((total, result) => total + returnedRows(result).length, 0);

    return { processed, hasMore };
  }

  async inspectBacklog(input: Parameters<SessionCleanupJob["inspectBacklog"]>[0]) {
    const cutoffs = maintenanceCutoffs(input.expiresBefore);
    const observed = await this.sql.readBatch([
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT 'session:' || token_digest AS token_digest, expires_at AS pending_at FROM sessions
          WHERE expires_at <= ? ORDER BY expires_at, token_digest LIMIT ?`,
        params: [input.expiresBefore, SCHEDULED_BACKLOG_READ_LIMIT],
      },
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT 'session:' || token_digest AS token_digest, created_at AS pending_at FROM sessions
          WHERE created_at <= ? ORDER BY created_at, token_digest LIMIT ?`,
        params: [input.createdBefore, SCHEDULED_BACKLOG_READ_LIMIT],
      },
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT 'notification:' || id AS token_digest, occurred_at AS pending_at FROM notification_inbox
          WHERE occurred_at < ? ORDER BY occurred_at, id LIMIT ?`,
        params: [cutoffs.notificationInbox, SCHEDULED_BACKLOG_READ_LIMIT],
      },
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT 'oauth:' || state_digest AS token_digest, expires_at AS pending_at
          FROM oauth_challenges INDEXED BY idx_oauth_challenges_cleanup_expiry
          WHERE expires_at <= ? ORDER BY expires_at, state_digest LIMIT ?`,
        params: [cutoffs.transientAuth, SCHEDULED_BACKLOG_READ_LIMIT],
      },
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT 'oauth:' || state_digest AS token_digest, consumed_at AS pending_at
          FROM oauth_challenges INDEXED BY idx_oauth_challenges_cleanup_consumed
          WHERE consumed_at IS NOT NULL AND consumed_at <= ?
          ORDER BY consumed_at, state_digest LIMIT ?`,
        params: [cutoffs.transientAuth, SCHEDULED_BACKLOG_READ_LIMIT],
      },
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT 'email:' || token_digest AS token_digest, expires_at AS pending_at
          FROM email_verification_challenges INDEXED BY idx_email_verification_cleanup_expiry
          WHERE expires_at <= ? ORDER BY expires_at, token_digest LIMIT ?`,
        params: [cutoffs.transientAuth, SCHEDULED_BACKLOG_READ_LIMIT],
      },
      {
        method: "all",
        columns: ["token_digest", "pending_at"],
        sql: `SELECT 'email:' || token_digest AS token_digest, consumed_at AS pending_at
          FROM email_verification_challenges INDEXED BY idx_email_verification_cleanup_consumed
          WHERE consumed_at IS NOT NULL AND consumed_at <= ?
          ORDER BY consumed_at, token_digest LIMIT ?`,
        params: [cutoffs.transientAuth, SCHEDULED_BACKLOG_READ_LIMIT],
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

function maintenanceCutoffs(now: string): Readonly<{ notificationInbox: string; transientAuth: string }> {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new TypeError("Session cleanup clock is invalid");
  return {
    notificationInbox: new Date(nowMs - NOTIFICATION_INBOX_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString(),
    transientAuth: new Date(nowMs - 24 * 60 * 60 * 1_000).toISOString(),
  };
}
