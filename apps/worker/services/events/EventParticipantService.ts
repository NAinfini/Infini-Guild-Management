import { eventParticipantSchema } from "@guild/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { eventParticipants, users } from "../../db/schema";
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
    if (eventRow.type === "poll") {
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
      if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
      if (eventRow.signupLocked) return { ok: false, code: "CONFLICT", message: "Event signup is locked" };

      const existing = (
        await this.db
          .select({ id: eventParticipants.id })
          .from(eventParticipants)
          .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)))
          .limit(1)
      )[0];
      if (existing) return { ok: false, code: "CONFLICT", message: "Already joined" };

      if (eventRow.capacity !== null) {
        const countRow = (
          await this.db
            .select({ count: sql<number>`count(*)` })
            .from(eventParticipants)
            .where(eq(eventParticipants.eventId, eventId))
        )[0];
        if (Number(countRow?.count ?? 0) >= eventRow.capacity) {
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
    if (eventRow.type === "poll") return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
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
    if (eventRow.type === "poll") return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (eventRow.endAt && eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Event has ended" };

    const activeUserRows = (await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(users.isActive, true), isNull(users.deletedAt)))) as Array<{ id?: string; userId?: string }>;
    const activeUserIds = new Set(activeUserRows.map((row) => row.id ?? row.userId).filter((id): id is string => typeof id === "string"));
    const missingUserId = userIds.find((userId) => !activeUserIds.has(userId));
    if (missingUserId) return { ok: false, code: "NOT_FOUND", message: `User not found: ${missingUserId}` };

    const existingRows = (await this.db
      .select({ userId: eventParticipants.userId })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), inArray(eventParticipants.userId, userIds)))) as Array<{ userId: string }>;
    const existingUserIds = new Set(existingRows.map((row) => row.userId));
    const insertUserIds = userIds.filter((userId) => !existingUserIds.has(userId));
    if (insertUserIds.length === 0) return { ok: true, participants: [] };

    if (eventRow.capacity !== null && eventRow.capacity > 0) {
      const countRow = (
        await this.db
          .select({ count: sql<number>`count(*)` })
          .from(eventParticipants)
          .where(eq(eventParticipants.eventId, eventId))
      )[0];
      if (Number(countRow?.count ?? 0) + insertUserIds.length > eventRow.capacity) {
        return { ok: false, code: "CONFLICT", message: "Event has reached maximum capacity" };
      }
    }

    const participantIds = insertUserIds.map(() => this.deps.createId?.() ?? nanoid());
    const stmts = insertUserIds.map((userId, index) =>
      this.rawDb
        .prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES (?1, ?2, ?3)")
        .bind(participantIds[index], eventId, userId),
    );
    await this.rawDb.batch(stmts);

    const createdRows = (await this.db
      .select({
        id: eventParticipants.id,
        eventId: eventParticipants.eventId,
        userId: eventParticipants.userId,
        joinedAt: eventParticipants.joinedAt,
      })
      .from(eventParticipants)
      .where(inArray(eventParticipants.id, participantIds))) as EventParticipantRow[];

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "batch_add_by_moderator",
      actorId,
      entityId: eventId,
      diffTitle: eventRow.title,
      detailText: JSON.stringify({ count: insertUserIds.length, user_ids: insertUserIds }),
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
}
