import {
  DEFAULT_GAME_RULES,
  eventParticipantSchema,
  getEventBehavior,
  type EventBehavior,
  type GameRules,
} from "@guild/shared";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { eventParticipants } from "../../db/schema";
import type { DatabaseLike, EventServiceDeps, RawDbLike } from "./EventCrudService";

export type EventParticipantRow = {
  id: string;
  eventId: string;
  userId: string;
  joinedAt: string;
};

export function toParticipantPayload(row: EventParticipantRow) {
  const result = eventParticipantSchema.safeParse({
    id: row.id,
    event_id: row.eventId,
    user_id: row.userId,
    joined_at: row.joinedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid participant data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

async function readRawRows<T>(
  rawDb: RawDbLike,
  statementSql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const statement = rawDb.prepare(statementSql).bind(...bindings);
  if (!statement.all) throw new Error("D1 statement does not support row reads");
  const result = await statement.all();
  return (Array.isArray(result) ? result : result.results ?? []) as T[];
}

export class EventParticipantService {
  constructor(
    private readonly db: DatabaseLike,
    private readonly rawDb: RawDbLike,
    private readonly deps: EventServiceDeps,
  ) {}

  async joinEvent(actorId: string, eventId: string): Promise<
    | { ok: true; participant: EventParticipantRow }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "SERVER_ERROR"; message: string }
  > {
    const participantId = this.deps.createId?.() ?? nanoid();
    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.visibleAt && new Date(eventRow.visibleAt) > new Date(this.deps.now?.() ?? new Date().toISOString())) {
      return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    }
    if (await this.getBehavior(eventRow.type) === "poll") {
      return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
    }

    const insertResult = await this.rawDb
      .prepare(
        `INSERT INTO event_participants (id, event_id, user_id)
         SELECT ?1, ?2, ?3
         WHERE EXISTS (
           SELECT 1 FROM events e
           WHERE e.id = ?2
             AND e.archived_at IS NULL
             AND e.signup_locked = 0
             AND (e.end_at IS NULL OR e.end_at > datetime('now'))
             AND (e.capacity IS NULL OR (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) < e.capacity)
         )
         AND NOT EXISTS (
           SELECT 1 FROM event_participants p WHERE p.event_id = ?2 AND p.user_id = ?3
         )`,
      )
      .bind(participantId, eventId, actorId)
      .run();

    if ((insertResult.meta?.changes ?? 0) !== 1) {
      const currentEvent = await this.deps.getEventById(eventId);
      if (!currentEvent) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
      if (currentEvent.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
      if (currentEvent.signupLocked) return { ok: false, code: "CONFLICT", message: "Event signup is locked" };
      if (currentEvent.endAt && currentEvent.endAt <= this.now()) {
        return { ok: false, code: "CONFLICT", message: "Event has ended" };
      }
      if (await this.getBehavior(currentEvent.type) === "poll") {
        return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
      }

      const existing = (
        await this.db
          .select({ id: eventParticipants.id })
          .from(eventParticipants)
          .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)))
          .limit(1)
      )[0];
      if (existing) return { ok: false, code: "CONFLICT", message: "Already joined" };

      if (currentEvent.capacity !== null) {
        const countRow = (
          await this.db
            .select({ count: sql<number>`count(*)` })
            .from(eventParticipants)
            .where(eq(eventParticipants.eventId, eventId))
        )[0];
        if (Number(countRow?.count ?? 0) >= currentEvent.capacity) {
          return { ok: false, code: "CONFLICT", message: "Event is full" };
        }
      }
      return { ok: false, code: "SERVER_ERROR", message: "Failed to join event" };
    }

    const actorName = await this.deps.getUsername(actorId);

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "join",
      actorId,
      entityId: `${eventId}:${actorId}`,
      diffTitle: `${eventRow.title} | ${actorName ?? actorId}`,
    });

    const created = (
      await this.db
        .select({
          id: eventParticipants.id,
          eventId: eventParticipants.eventId,
          userId: eventParticipants.userId,
          joinedAt: eventParticipants.joinedAt,
        })
        .from(eventParticipants)
        .where(eq(eventParticipants.id, participantId))
        .limit(1)
    )[0] as EventParticipantRow | undefined;

    if (!created) return { ok: false, code: "SERVER_ERROR", message: "Failed to create participant" };

    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "participant_joined",
    });

    return { ok: true, participant: created };
  }

  async leaveEvent(actorId: string, eventId: string): Promise<
    | { ok: true }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string }
  > {
    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (await this.getBehavior(eventRow.type) === "poll") return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
    if (eventRow.signupLocked) return { ok: false, code: "CONFLICT", message: "Event signup is locked" };
    if (eventRow.endAt && eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Event has ended" };

    const existing = (
      await this.db
        .select({ id: eventParticipants.id })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)))
        .limit(1)
    )[0];

    if (!existing) return { ok: false, code: "CONFLICT", message: "Not a participant" };

    await this.db
      .delete(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)));

    const actorName = await this.deps.getUsername(actorId);

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "leave",
      actorId,
      entityId: `${eventId}:${actorId}`,
      diffTitle: `${eventRow.title} | ${actorName ?? actorId}`,
    });
    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "participant_left",
    });

    return { ok: true };
  }

  async addParticipants(
    actorId: string,
    eventId: string,
    targetUserIds: string[],
  ): Promise<
    | { ok: true; participants: EventParticipantRow[] }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "SERVER_ERROR"; message: string }
  > {
    const userIds = [...new Set(targetUserIds.filter((id) => id.trim().length > 0))];
    if (userIds.length === 0) return { ok: false, code: "VALIDATION_ERROR", message: "At least one user_id is required" };

    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (await this.getBehavior(eventRow.type) === "poll") return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (eventRow.endAt && eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Event has ended" };

    const userIdsJson = JSON.stringify(userIds);
    const activeUserRows = await readRawRows<{ id?: string; userId?: string }>(
      this.rawDb,
      `SELECT u.id
       FROM users u
       INNER JOIN json_each(?1) requested ON requested.value = u.id
       WHERE u.is_active = 1 AND u.deleted_at IS NULL`,
      userIdsJson,
    );
    const activeUserIds = new Set(activeUserRows.map((row) => row.id ?? row.userId).filter((id): id is string => typeof id === "string"));
    const missingUserId = userIds.find((userId) => !activeUserIds.has(userId));
    if (missingUserId) return { ok: false, code: "NOT_FOUND", message: `User not found: ${missingUserId}` };

    const existingRows = await readRawRows<{ userId: string }>(
      this.rawDb,
      `SELECT ep.user_id AS userId
       FROM event_participants ep
       INNER JOIN json_each(?2) requested ON requested.value = ep.user_id
       WHERE ep.event_id = ?1`,
      eventId,
      userIdsJson,
    );
    const existingUserIds = new Set(existingRows.map((row) => row.userId));
    const insertUserIds = userIds.filter((userId) => !existingUserIds.has(userId));
    if (insertUserIds.length === 0) return { ok: true, participants: [] };

    const participantIds = insertUserIds.map(() => this.deps.createId?.() ?? nanoid());
    const payloadJson = JSON.stringify({
      eventId,
      participants: insertUserIds.map((userId, index) => ({ id: participantIds[index], userId })),
    });
    const insertResult = await this.rawDb
      .prepare(
        `WITH payload(data) AS (VALUES (?1)),
         requested(id, user_id) AS (
           SELECT json_extract(entry.value, '$.id'), json_extract(entry.value, '$.userId')
           FROM payload, json_each(json_extract(payload.data, '$.participants')) entry
         ),
         target_event(id) AS (
           SELECT e.id
           FROM events e, payload
           WHERE e.id = json_extract(payload.data, '$.eventId')
             AND e.archived_at IS NULL
             AND (e.end_at IS NULL OR e.end_at > datetime('now'))
             AND (
               e.capacity IS NULL
               OR (
                 (SELECT COUNT(*) FROM event_participants current WHERE current.event_id = e.id)
                 + (SELECT COUNT(*) FROM requested candidate
                    WHERE NOT EXISTS (
                      SELECT 1 FROM event_participants existing
                      WHERE existing.event_id = e.id AND existing.user_id = candidate.user_id
                    ))
               ) <= e.capacity
             )
         )
         INSERT OR IGNORE INTO event_participants (id, event_id, user_id)
         SELECT requested.id, target_event.id, requested.user_id
         FROM requested
         CROSS JOIN target_event
         WHERE NOT EXISTS (
           SELECT 1 FROM event_participants existing
           WHERE existing.event_id = target_event.id
             AND existing.user_id = requested.user_id
         )`,
      )
      .bind(payloadJson)
      .run();

    if ((insertResult.meta?.changes ?? 0) === 0) {
      const currentEvent = await this.deps.getEventById(eventId);
      if (!currentEvent) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
      if (currentEvent.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
      if (currentEvent.endAt && currentEvent.endAt <= this.now()) {
        return { ok: false, code: "CONFLICT", message: "Event has ended" };
      }

      const currentRows = await readRawRows<{ userId: string }>(
        this.rawDb,
        `SELECT ep.user_id AS userId
         FROM event_participants ep
         INNER JOIN json_each(?2) requested ON requested.value = ep.user_id
         WHERE ep.event_id = ?1`,
        eventId,
        JSON.stringify(insertUserIds),
      );
      const currentUserIds = new Set(currentRows.map((row) => row.userId));
      const stillMissingUserIds = insertUserIds.filter((userId) => !currentUserIds.has(userId));
      if (stillMissingUserIds.length === 0) return { ok: true, participants: [] };

      if (currentEvent.capacity !== null) {
        const countRow = (
          await this.db
            .select({ count: sql<number>`count(*)` })
            .from(eventParticipants)
            .where(eq(eventParticipants.eventId, eventId))
        )[0];
        if (Number(countRow?.count ?? 0) + stillMissingUserIds.length > currentEvent.capacity) {
          return { ok: false, code: "CONFLICT", message: "Event has reached maximum capacity" };
        }
      }
      return { ok: false, code: "SERVER_ERROR", message: "Failed to add participants" };
    }

    const createdRows = await readRawRows<EventParticipantRow>(
      this.rawDb,
      `SELECT ep.id, ep.event_id AS eventId, ep.user_id AS userId, ep.joined_at AS joinedAt
       FROM event_participants ep
       INNER JOIN json_each(?1) requested ON requested.value = ep.id`,
      JSON.stringify(participantIds),
    );

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "batch_add_by_moderator",
      actorId,
      entityId: eventId,
      diffTitle: eventRow.title,
      detailText: JSON.stringify({ count: createdRows.length, user_ids: createdRows.map((row) => row.userId) }),
    });
    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "participants_added_by_moderator",
    });

    return { ok: true, participants: createdRows };
  }

  async removeParticipants(actorId: string, eventId: string, targetUserIds: string[]): Promise<
    | { ok: true; removed: number }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string }
  > {
    const userIds = [...new Set(targetUserIds.filter((id) => id.trim().length > 0))];
    if (userIds.length === 0) return { ok: true, removed: 0 };

    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (eventRow.endAt && eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Event has ended" };

    const placeholders = userIds.map((_, index) => `?${index + 2}`).join(", ");
    const result = await this.rawDb
      .prepare(`DELETE FROM event_participants WHERE event_id = ?1 AND user_id IN (${placeholders})`)
      .bind(eventId, ...userIds)
      .run();
    const removed = Number(result.meta?.changes ?? 0);
    if (removed > 0) {
      await this.deps.writeAuditLog({
        entityType: "event_participant",
        action: "batch_remove_by_moderator",
        actorId,
        entityId: eventId,
        diffTitle: eventRow.title,
        detailText: JSON.stringify({ count: removed, user_ids: userIds }),
      });
      await this.deps.publishEntityChanged({
        entityType: "event",
        entityId: eventId,
        hint: "participants_removed_by_moderator",
      });
    }
    return { ok: true, removed };
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private async getBehavior(eventType: string): Promise<EventBehavior> {
    const rules: GameRules = await (this.deps.getGameRules?.() ?? Promise.resolve(DEFAULT_GAME_RULES));
    const behavior = getEventBehavior(rules, eventType);
    if (!behavior) throw new Error(`Unknown configured event type: ${eventType}`);
    return behavior;
  }
}
