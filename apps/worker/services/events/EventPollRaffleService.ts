import {
  DEFAULT_GAME_RULES,
  eventRaffleWinnerSchema,
  getEventBehavior,
  type EventBehavior,
  type GameRules,
} from "@guild/shared";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { eventParticipants, eventRaffleWinners } from "../../db/schema";
import { err, type ServiceErr } from "../result";
import type { CreateEventInput, DatabaseLike, EventServiceDeps, RawDbLike, UpdateEventInput } from "./EventCrudService";

export type RaffleWinnerRow = {
  id: string;
  eventId: string;
  userId: string;
  drawnAt: string;
};

type PollResultsVisibility = "always" | "after_vote" | "after_close";

type PollOptionRow = {
  id: string;
  eventId: string;
  label: string;
  sortOrder: number;
};

type PollJoinedRow = {
  event_id: string;
  results_visibility: PollResultsVisibility;
  show_voter_names: number | boolean;
  option_id: string;
  label: string;
  sort_order: number;
  voter_id: string | null;
};

export function toRaffleWinnerPayload(row: RaffleWinnerRow) {
  const result = eventRaffleWinnerSchema.safeParse({
    id: row.id,
    event_id: row.eventId,
    user_id: row.userId,
    drawn_at: row.drawnAt,
  });
  if (!result.success) {
    throw new Error(`Invalid raffle winner data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export class EventPollRaffleService {
  constructor(
    private readonly db: DatabaseLike,
    private readonly rawDb: RawDbLike,
    private readonly deps: EventServiceDeps,
  ) {}

  async votePoll(actorId: string, eventId: string, optionIds: string[]): Promise<
    | { ok: true }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "SERVER_ERROR"; message: string }
  > {
    const uniqueOptionIds = [...new Set(optionIds.filter((id) => id.trim().length > 0))];
    if (uniqueOptionIds.length === 0) return { ok: false, code: "VALIDATION_ERROR", message: "At least one option_id is required" };
    if (uniqueOptionIds.length > 10) return { ok: false, code: "VALIDATION_ERROR", message: "Maximum 10 options per vote" };

    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (await this.getBehavior(eventRow.type) !== "poll") return { ok: false, code: "CONFLICT", message: "Event is not a poll" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (!eventRow.endAt) return { ok: false, code: "CONFLICT", message: "Poll has no close time" };
    if (eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Poll is closed" };

    const validOptions = await this.getPollOptions(eventId);
    if (validOptions.length > 0) {
      const validIds = new Set(validOptions.map((option) => option.id));
      if (uniqueOptionIds.some((id) => !validIds.has(id))) {
        return { ok: false, code: "VALIDATION_ERROR", message: "Invalid poll option" };
      }
    }

    const now = this.now();
    const deleteStmt = this.rawDb.prepare("DELETE FROM event_poll_votes WHERE event_id = ?1 AND user_id = ?2").bind(eventId, actorId);
    const insertStmts = uniqueOptionIds.map((optionId) =>
      this.rawDb
        .prepare("INSERT INTO event_poll_votes (id, event_id, option_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(this.deps.createId?.() ?? nanoid(), eventId, optionId, actorId, now),
    );
    await this.rawDb.batch([deleteStmt, ...insertStmts]);

    await this.deps.writeAuditLog({
      entityType: "event_poll_vote",
      action: "vote",
      actorId,
      entityId: `${eventId}:${actorId}`,
      diffTitle: eventRow.title,
      detailText: JSON.stringify({ option_count: uniqueOptionIds.length }),
    });
    await this.deps.publishEntityChanged({ entityType: "event", entityId: eventId, hint: "poll_voted" });
    return { ok: true };
  }

  async drawRaffleWinners(actorId: string, eventId: string): Promise<
    | { ok: true; winners: RaffleWinnerRow[] }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR"; message: string }
  > {
    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (await this.getBehavior(eventRow.type) !== "raffle") return { ok: false, code: "CONFLICT", message: "Event is not a raffle" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (!eventRow.winnerCount || eventRow.winnerCount < 1) return { ok: false, code: "VALIDATION_ERROR", message: "Raffle has no winner_count configured" };

    const existingWinners = await this.rawDb
      .prepare("SELECT id FROM event_raffle_winners WHERE event_id = ?1 LIMIT 1")
      .bind(eventId)
      .all?.();
    const hasWinners = Array.isArray(existingWinners) ? existingWinners.length > 0 : (existingWinners?.results?.length ?? 0) > 0;
    if (hasWinners) return { ok: false, code: "CONFLICT", message: "Raffle winners already drawn" };

    const participantRows = (await this.db
      .select({ userId: eventParticipants.userId })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))) as Array<{ userId: string }>;

    if (participantRows.length === 0) return { ok: false, code: "VALIDATION_ERROR", message: "No participants to draw from" };

    const pool = participantRows.map((row) => row.userId);
    const winnerCount = Math.min(eventRow.winnerCount, pool.length);
    const selectedIds: string[] = [];
    const remaining = [...pool];
    for (let i = 0; i < winnerCount; i++) {
      const idx = Math.floor(Math.random() * remaining.length);
      selectedIds.push(remaining[idx]!);
      remaining.splice(idx, 1);
    }

    const now = this.now();
    const stmts = selectedIds.map((userId) =>
      this.rawDb
        .prepare("INSERT INTO event_raffle_winners (id, event_id, user_id, drawn_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(this.deps.createId?.() ?? nanoid(), eventId, userId, now),
    );
    stmts.push(
      this.rawDb
        .prepare("UPDATE events SET signup_locked = 1, updated_at = ?1 WHERE id = ?2")
        .bind(now, eventId),
    );
    await this.rawDb.batch(stmts);

    const winners = await this.getRaffleWinners(eventId);

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "raffle_draw",
      actorId,
      entityId: eventId,
      diffTitle: eventRow.title,
      detailText: JSON.stringify({ winner_count: winners.length, winner_user_ids: selectedIds }),
    });

    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "raffle_drawn",
    });

    return { ok: true, winners };
  }

  async hasRaffleWinners(eventId: string): Promise<boolean> {
    const result = await this.rawDb
      .prepare("SELECT id FROM event_raffle_winners WHERE event_id = ?1 LIMIT 1")
      .bind(eventId)
      .all?.();
    const rows = Array.isArray(result) ? result : result?.results;
    return Array.isArray(rows) && rows.length > 0;
  }

  async getRaffleWinners(eventId: string): Promise<RaffleWinnerRow[]> {
    return (await this.db
      .select({ id: eventRaffleWinners.id, eventId: eventRaffleWinners.eventId, userId: eventRaffleWinners.userId, drawnAt: eventRaffleWinners.drawnAt })
      .from(eventRaffleWinners)
      .where(eq(eventRaffleWinners.eventId, eventId))) as RaffleWinnerRow[];
  }

  async attachRaffleWinners<T extends { id: string; type: string }>(eventPayloads: T[]): Promise<(T & { raffle_winners?: Array<{ id: string; event_id: string; user_id: string; drawn_at: string }> })[]> {
    const rules = await this.getGameRules();
    const raffleIds = eventPayloads.filter((e) => this.requireBehavior(rules, e.type) === "raffle").map((e) => e.id);
    if (raffleIds.length === 0) return eventPayloads;

    const placeholders = raffleIds.map((_, i) => `?${i + 1}`).join(", ");
    const result = await this.rawDb
      .prepare(`SELECT id, event_id, user_id, drawn_at FROM event_raffle_winners WHERE event_id IN (${placeholders})`)
      .bind(...raffleIds)
      .all?.();
    const rawRows = ((result as { results?: unknown[] } | undefined)?.results ?? []) as Array<{ id: string; event_id: string; user_id: string; drawn_at: string }>;
    const rows: RaffleWinnerRow[] = rawRows.map((r) => ({ id: r.id, eventId: r.event_id, userId: r.user_id, drawnAt: r.drawn_at }));

    const winnersByEvent = new Map<string, RaffleWinnerRow[]>();
    for (const row of rows) {
      const list = winnersByEvent.get(row.eventId) ?? [];
      list.push(row);
      winnersByEvent.set(row.eventId, list);
    }

    return eventPayloads.map((e) => {
      if (this.requireBehavior(rules, e.type) !== "raffle") return e;
      return { ...e, raffle_winners: (winnersByEvent.get(e.id) ?? []).map(toRaffleWinnerPayload) };
    });
  }

  validatePollEventInput(data: CreateEventInput, behavior: EventBehavior): ServiceErr | null {
    if (behavior !== "poll") {
      if (data.poll) return err("VALIDATION_ERROR", "Only poll events can include poll settings");
      return null;
    }
    if (!data.end_at) return err("VALIDATION_ERROR", "Poll events require end_at");
    if (!data.poll) return err("VALIDATION_ERROR", "Poll events require poll settings");
    return null;
  }

  validateRaffleEventInput(data: CreateEventInput, behavior: EventBehavior): ServiceErr | null {
    if (behavior !== "raffle") {
      if (data.winner_count !== undefined) return err("VALIDATION_ERROR", "Only raffle events can include winner_count");
      return null;
    }
    if (!data.end_at) return err("VALIDATION_ERROR", "Raffle events require end_at");
    if (!data.winner_count || data.winner_count < 1) return err("VALIDATION_ERROR", "Raffle events require winner_count");
    return null;
  }

  validatePollEventUpdate(
    data: UpdateEventInput,
    effectiveEndAt: string | null,
    previousBehavior: EventBehavior,
    behavior: EventBehavior,
  ): ServiceErr | null {
    if (behavior !== "poll") {
      if (data.poll) return err("VALIDATION_ERROR", "Only poll events can include poll settings");
      return null;
    }
    if (!effectiveEndAt) return err("VALIDATION_ERROR", "Poll events require end_at");
    if (previousBehavior !== "poll" && !data.poll) return err("VALIDATION_ERROR", "Poll events require poll settings");
    return null;
  }

  validateRaffleEventUpdate(
    data: UpdateEventInput,
    effectiveEndAt: string | null,
    effectiveWinnerCount: number | null,
    behavior: EventBehavior,
  ): ServiceErr | null {
    if (behavior !== "raffle") {
      if (data.winner_count !== undefined) return err("VALIDATION_ERROR", "Only raffle events can include winner_count");
      return null;
    }
    if (!effectiveEndAt) return err("VALIDATION_ERROR", "Raffle events require end_at");
    if (!effectiveWinnerCount || effectiveWinnerCount < 1) return err("VALIDATION_ERROR", "Raffle events require winner_count");
    return null;
  }

  buildCreatePollStatements(eventId: string, poll: NonNullable<CreateEventInput["poll"]>) {
    const now = this.now();
    const pollStmt = this.rawDb
      .prepare("INSERT INTO event_polls (event_id, results_visibility, show_voter_names, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(eventId, poll.results_visibility ?? "after_vote", poll.show_voter_names ?? false, now, now);
    const optionStmts = poll.options.map((label, index) =>
      this.rawDb
        .prepare("INSERT INTO event_poll_options (id, event_id, label, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(this.deps.createId?.() ?? nanoid(), eventId, label.trim(), index, now),
    );
    return [pollStmt, ...optionStmts];
  }

  buildUpdatePollStatements(eventId: string, poll: NonNullable<CreateEventInput["poll"]>, hasVotes: boolean) {
    const now = this.now();
    const stmts = [
      this.rawDb
        .prepare("UPDATE event_polls SET results_visibility = ?1, show_voter_names = ?2, updated_at = ?3 WHERE event_id = ?4")
        .bind(poll.results_visibility ?? "after_vote", poll.show_voter_names ?? false, now, eventId),
    ];
    if (!hasVotes) {
      stmts.push(this.rawDb.prepare("DELETE FROM event_poll_options WHERE event_id = ?1").bind(eventId));
      stmts.push(...poll.options.map((label, index) =>
        this.rawDb
          .prepare("INSERT INTO event_poll_options (id, event_id, label, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(this.deps.createId?.() ?? nanoid(), eventId, label.trim(), index, now),
      ));
    }
    return stmts;
  }

  async pollOptionsChanged(eventId: string, nextOptions: string[]): Promise<boolean> {
    const existing = await this.getPollOptions(eventId);
    if (existing.length === 0) return false;
    const existingLabels = existing.sort((left, right) => left.sortOrder - right.sortOrder).map((option) => option.label.trim());
    const nextLabels = nextOptions.map((option) => option.trim());
    return JSON.stringify(existingLabels) !== JSON.stringify(nextLabels);
  }

  async pollHasVotes(eventId: string): Promise<boolean> {
    const statement = this.rawDb.prepare("SELECT id FROM event_poll_votes WHERE event_id = ?1 LIMIT 1").bind(eventId);
    const result = await statement.all?.();
    const rows = Array.isArray(result) ? result : result?.results;
    return Array.isArray(rows) && rows.length > 0;
  }

  async attachPolls<T extends { id: string; type: string; end_at: string | null }>(
    eventPayloads: T[],
    viewerId: string | null,
    canManage: boolean,
  ): Promise<Array<T & { poll?: unknown }>> {
    const rules = await this.getGameRules();
    const pollEvents = eventPayloads.filter((event) => this.requireBehavior(rules, event.type) === "poll");
    if (pollEvents.length === 0) return eventPayloads;
    const pollMap = await this.loadPollsForEvents(pollEvents, viewerId, canManage);
    return eventPayloads.map((event) => ({
      ...event,
      poll: pollMap.get(event.id) ?? null,
    }));
  }

  private async getPollOptions(eventId: string): Promise<PollOptionRow[]> {
    const statement = this.rawDb.prepare("SELECT id, event_id as eventId, label, sort_order as sortOrder FROM event_poll_options WHERE event_id = ?1").bind(eventId);
    const result = await statement.all?.();
    const rows = Array.isArray(result) ? result : result?.results;
    return Array.isArray(rows) ? rows as PollOptionRow[] : [];
  }

  private getGameRules(): Promise<GameRules> {
    return this.deps.getGameRules?.() ?? Promise.resolve(DEFAULT_GAME_RULES);
  }

  private requireBehavior(rules: GameRules, eventType: string): EventBehavior {
    const behavior = getEventBehavior(rules, eventType);
    if (!behavior) throw new Error(`Unknown configured event type: ${eventType}`);
    return behavior;
  }

  private async getBehavior(eventType: string): Promise<EventBehavior> {
    return this.requireBehavior(await this.getGameRules(), eventType);
  }

  private async loadPollsForEvents(
    pollEvents: Array<{ id: string; end_at: string | null }>,
    viewerId: string | null,
    canManage: boolean,
  ) {
    const placeholders = pollEvents.map((_, index) => `?${index + 1}`).join(", ");
    const statement = this.rawDb
      .prepare(
        `SELECT p.event_id, p.results_visibility, p.show_voter_names,
                o.id as option_id, o.label, o.sort_order, v.user_id as voter_id
         FROM event_polls p
         JOIN event_poll_options o ON o.event_id = p.event_id
         LEFT JOIN event_poll_votes v ON v.option_id = o.id
         WHERE p.event_id IN (${placeholders})
         ORDER BY p.event_id, o.sort_order, o.id`,
      )
      .bind(...pollEvents.map((event) => event.id));
    const result = await statement.all?.();
    const rows = (Array.isArray(result) ? result : result?.results) as PollJoinedRow[] | undefined;
    const rowsByEvent = new Map<string, PollJoinedRow[]>();
    for (const row of rows ?? []) {
      rowsByEvent.set(row.event_id, [...(rowsByEvent.get(row.event_id) ?? []), row]);
    }

    const map = new Map<string, unknown>();
    for (const event of pollEvents) {
      const eventRows = rowsByEvent.get(event.id) ?? [];
      if (eventRows.length === 0) {
        map.set(event.id, null);
        continue;
      }
      const visibility = eventRows[0]?.results_visibility ?? "after_vote";
      const showVoterNames = Boolean(eventRows[0]?.show_voter_names);
      const voterIds = new Set(eventRows.map((row) => row.voter_id).filter((id): id is string => Boolean(id)));
      const hasVoted = viewerId ? voterIds.has(viewerId) : false;
      const isClosed = Boolean(event.end_at && event.end_at <= this.now());
      const resultsVisible = canManage || visibility === "always" || (visibility === "after_vote" && hasVoted) || (visibility === "after_close" && isClosed);
      const optionsById = new Map<string, { id: string; label: string; sortOrder: number; voterIds: string[] }>();
      for (const row of eventRows) {
        const option = optionsById.get(row.option_id) ?? { id: row.option_id, label: row.label, sortOrder: row.sort_order, voterIds: [] };
        if (row.voter_id) option.voterIds.push(row.voter_id);
        optionsById.set(row.option_id, option);
      }
      map.set(event.id, {
        results_visibility: visibility,
        show_voter_names: showVoterNames,
        has_voted: hasVoted,
        can_vote: Boolean(viewerId) && !isClosed,
        options: [...optionsById.values()]
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((option) => ({
            id: option.id,
            label: option.label,
            vote_count: resultsVisible ? option.voterIds.length : 0,
            voter_ids: resultsVisible && (showVoterNames || canManage) ? option.voterIds : [],
            voted_by_me: viewerId ? option.voterIds.includes(viewerId) : false,
          })),
      });
    }
    return map;
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}
