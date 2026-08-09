import {
  DEFAULT_GAME_RULES,
  createEventSchema,
  eventSchema,
  updateEventSchema,
  LIMITS,
  findEventTypeDefinition,
  type GameRules,
  type JsonValue,
  type SiteMediaPolicy,
} from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "../audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  eventParticipants,
  eventRaffleWinners,
  events,
} from "../../db/schema";
import { escapeLikePattern, likeEscaped } from "../helpers";
import { err, ok, type ServiceErr, type ServiceResult } from "../result";
import { toParticipantPayload, type EventParticipantRow } from "./EventParticipantService";
import {
  EventPollRaffleService,
  toRaffleWinnerPayload,
  type RaffleWinnerRow,
} from "./EventPollRaffleService";
import { eventPublicVisibilityFilter, isEventPubliclyVisible } from "./event-visibility";
import {
  buildDeleteClassQuotaStatements,
  buildReplaceClassQuotaStatements,
  findBrokenQuotaReferences,
  loadClassQuotas,
  loadClassQuotasFor,
  typeSupportsClassQuotas,
  EVENT_CLASS_QUOTA_TABLE,
  type ClassQuotaInput,
  type ClassQuotaRow,
} from "./event-class-quotas";
import type { MediaService, ParsedImageMediaUpload } from "../MediaService";
import { MediaValidationError } from "../MediaService";
import { isMediaId } from "../media-keys";

export { toParticipantPayload, type EventParticipantRow } from "./EventParticipantService";
export { toRaffleWinnerPayload, type RaffleWinnerRow } from "./EventPollRaffleService";

export type DatabaseLike = DrizzleD1Database;

type BoundStatement = {
  run: () => Promise<{ meta?: { changes?: number } }>;
  all?: () => Promise<{ results?: unknown[] } | unknown[]>;
};

export type RawDbLike = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => BoundStatement;
  };
  batch: (statements: BoundStatement[]) => Promise<unknown[]>;
};

export type EventRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  capacity: number | null;
  pinned: boolean;
  signupLocked: boolean;
  visibleAt: string | null;
  archivedAt: string | null;
  autoArchive: boolean;
  autoArchived: boolean;
  createdBy: string;
  updatedBy: string | null;
  attachments: string[];
  seriesId: string | null;
  instanceDate: string | null;
  winnerCount: number | null;
  createdAt: string;
  updatedAt: string;
  /*
   * 职业配额存在另一张表里，不是 events 的列，所以只有显式读过配额的查询路径才会
   * 带上它。缺省的 undefined 表示「这条路径没查配额」，会被 toEventPayload 当成空数组
   * ——面板那种不显示配额的精简载荷就走这条路。
   */
  classQuotas?: ClassQuotaRow[];
};

type EventBaseRow = Omit<EventRow, "attachments">;

const MAX_EVENT_ATTACHMENTS = LIMITS.content.eventAttachments.max;
export type EventServiceDeps = {
  getEventById: (eventId: string) => Promise<EventRow | null>;
  getUsername: (userId: string) => Promise<string | null>;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (payload: { entityType: PushEntityType; entityId: string; hint: PushHint; displayName?: string }) => Promise<void>;
  now?: () => string;
  createId?: () => string;
  mediaService: MediaService;
  getMediaPolicy: () => Promise<SiteMediaPolicy>;
  getGameRules?: () => Promise<GameRules>;
};

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export function parseAttachments(value: readonly string[] | null | undefined): string[] {
  return [...new Set(value ?? [])]
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .slice(0, MAX_EVENT_ATTACHMENTS);
}

export function toEventPayload(row: EventRow) {
  const result = eventSchema.safeParse({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    start_at: row.startAt,
    end_at: row.endAt,
    capacity: row.capacity,
    pinned: row.pinned,
    signup_locked: row.signupLocked,
    auto_archive: row.autoArchive,
    auto_archived: row.autoArchived,
    visible_at: row.visibleAt,
    archived_at: row.archivedAt,
    created_by: row.createdBy,
    updated_by: row.updatedBy ?? null,
    attachments: row.attachments,
    class_quotas: row.classQuotas ?? [],
    series_id: row.seriesId,
    instance_date: row.instanceDate,
    winner_count: row.winnerCount ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid event data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export class EventCrudService {
  private readonly db: DatabaseLike;
  private readonly rawDb: RawDbLike;
  private readonly deps: EventServiceDeps;
  private readonly pollRaffle: EventPollRaffleService;

  constructor(db: DatabaseLike, rawDb: RawDbLike, deps: EventServiceDeps) {
    this.db = db;
    this.rawDb = rawDb;
    this.deps = deps;
    this.pollRaffle = new EventPollRaffleService(db, rawDb, deps);
  }

  async createEvent(actorId: string, data: CreateEventInput, uploads: readonly ParsedImageMediaUpload[] = []): Promise<ServiceResult<EventRow>> {
    const rules = await this.getGameRules();
    const typeDefinition = findEventTypeDefinition(rules, data.type);
    if (!typeDefinition || !typeDefinition.enabled) {
      return err("VALIDATION_ERROR", `Unknown or disabled event type: ${data.type}`);
    }
    const behavior = typeDefinition.behavior;
    const dateErr = this.validateDateRange(data.start_at, data.end_at);
    if (dateErr) return dateErr;
    const pollErr = this.pollRaffle.validatePollEventInput(data, behavior);
    if (pollErr) return pollErr;
    const raffleErr = this.pollRaffle.validateRaffleEventInput(data, behavior);
    if (raffleErr) return raffleErr;
    if ((data.attachments?.length ?? 0) + uploads.length > MAX_EVENT_ATTACHMENTS) {
      return err("VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }
    const quotas = data.class_quotas ?? [];
    // 图片一旦落桶就得靠补偿删除去擦，所以先把不花钱的校验做完再上传。
    const quotaErr = await this.validateClassQuotas(data.type, quotas, rules);
    if (quotaErr) return quotaErr;

    const eventId = this.createId();
    const attachmentErr = this.validateAttachmentKeys(eventId, data.attachments ?? []);
    if (attachmentErr) return attachmentErr;
    const imageResult = await this.createImages(actorId, eventId, uploads, data.attachments?.length ?? 0);
    if ("ok" in imageResult && !imageResult.ok) return imageResult;
    const uploadedAttachments = imageResult as string[];
    const attachments = [...(data.attachments ?? []), ...uploadedAttachments];

    const now = this.now();
    await this.rawDb.batch([
      this.rawDb.prepare(`
        INSERT INTO events
          (id, type, title, description, start_at, end_at, capacity, pinned, signup_locked,
           visible_at, archived_at, auto_archive, auto_archived, created_by, updated_by,
           series_id, instance_date, winner_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?, 0, ?, NULL, NULL, NULL, ?, ?, ?)
      `).bind(
        eventId, data.type, data.title.trim(), data.description?.trim() || null,
        data.start_at, data.end_at ?? null, behavior === "poll" ? null : data.capacity ?? null,
        data.auto_archive ?? false, actorId,
        behavior === "raffle" ? data.winner_count ?? null : null, now, now,
      ),
      ...(behavior === "poll" && data.poll
        ? this.pollRaffle.buildCreatePollStatements(eventId, data.poll)
        : []),
      ...(quotas.length > 0
        ? buildReplaceClassQuotaStatements(this.rawDb, EVENT_CLASS_QUOTA_TABLE, eventId, quotas, () => this.createId())
        : []),
    ]);
    try {
      await this.deps.mediaService.replace({
        entityType: "event",
        entityId: eventId,
        slot: "attachment",
        media: attachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
        ownerUserId: actorId,
        now,
      });
    } catch (error) {
      try {
        await this.rawDb.prepare("DELETE FROM events WHERE id = ?1").bind(eventId).run();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Event ${eventId} attachment and parent cleanup both failed`);
      }
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }

    const created = await this.deps.getEventById(eventId);
    if (!created) throw new Error("Failed to load created event");
    // 回读一次而不是直接回显请求体：落库后的顺序按职业目录排，跟后续 GET 保持一致。
    created.classQuotas = quotas.length > 0
      ? await loadClassQuotasFor(this.rawDb, EVENT_CLASS_QUOTA_TABLE, eventId)
      : [];

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "create",
      actorId,
      entityId: eventId,
      diffTitle: created.title,
      detail: {
        type: created.type,
        start_at: created.startAt,
        end_at: created.endAt,
      },
    });

    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "event_created",
      displayName: created.title,
    });

    return ok(created);
  }

  async updateEvent(actorId: string, eventId: string, existing: EventRow, data: UpdateEventInput): Promise<ServiceResult<EventRow>> {
    const rules = await this.getGameRules();
    const existingDefinition = findEventTypeDefinition(rules, existing.type);
    if (!existingDefinition) return err("VALIDATION_ERROR", `Unknown event type: ${existing.type}`);
    const effectiveType = data.type ?? existing.type;
    const effectiveDefinition = findEventTypeDefinition(rules, effectiveType);
    if (!effectiveDefinition || !effectiveDefinition.enabled) {
      return err("VALIDATION_ERROR", `Unknown or disabled event type: ${effectiveType}`);
    }
    const effectiveBehavior = effectiveDefinition.behavior;
    const effectiveStartAt = data.start_at ?? existing.startAt;
    const effectiveEndAt = data.end_at !== undefined ? data.end_at : existing.endAt;
    const dateErr = this.validateDateRange(effectiveStartAt, effectiveEndAt);
    if (dateErr) return dateErr;
    const pollUpdateErr = this.pollRaffle.validatePollEventUpdate(data, effectiveEndAt, existingDefinition.behavior, effectiveBehavior);
    if (pollUpdateErr) return pollUpdateErr;
    const effectiveWinnerCount = data.winner_count ?? existing.winnerCount;
    const raffleUpdateErr = this.pollRaffle.validateRaffleEventUpdate(data, effectiveEndAt, effectiveWinnerCount, effectiveBehavior);
    if (raffleUpdateErr) return raffleUpdateErr;
    const quotaErr = await this.validateClassQuotas(effectiveType, data.class_quotas ?? [], rules);
    if (quotaErr) return quotaErr;
    const attachmentErr = this.validateAttachmentKeys(eventId, data.attachments ?? existing.attachments);
    if (attachmentErr) return attachmentErr;

    const patch: Record<string, unknown> = {
      updatedAt: this.now(),
      updatedBy: actorId,
    };

    if (data.type !== undefined) patch.type = data.type;
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.description !== undefined) patch.description = data.description?.trim() || null;
    if (data.start_at !== undefined) patch.startAt = data.start_at;
    if (data.end_at !== undefined) patch.endAt = data.end_at ?? null;
    if (data.capacity !== undefined || (data.type !== undefined && effectiveBehavior === "poll")) {
      patch.capacity = effectiveBehavior === "poll" ? null : data.capacity ?? null;
    }
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    if (data.signup_locked !== undefined) patch.signupLocked = data.signup_locked;
    if (data.auto_archive !== undefined) patch.autoArchive = data.auto_archive;
    if (data.archived_at !== undefined) patch.archivedAt = data.archived_at;
    if (data.winner_count !== undefined || (data.type !== undefined && effectiveBehavior !== "raffle")) {
      patch.winnerCount = effectiveBehavior === "raffle" ? data.winner_count ?? existing.winnerCount : null;
    }

    const pollDataProvided = effectiveBehavior === "poll" && data.poll;
    const hasVotes = pollDataProvided ? await this.pollRaffle.pollHasVotes(eventId) : false;

    if (pollDataProvided && hasVotes && await this.pollRaffle.pollOptionsChanged(eventId, data.poll!.options)) {
      return err("VALIDATION_ERROR", "Poll options cannot be changed after voting starts");
    }

    /*
     * 改成投票／抽奖时必须清空配额：这两种类型不带配额，而客户端此时也不会再传
     * class_quotas，留着旧行的话改回来就会冒出一批没人设过的配额。
     * 旧值只在真要动配额时才读——审计日志要写 from，而 existing 来自不查配额的
     * getEventById。
     */
    const quotaWrite = !typeSupportsClassQuotas(effectiveType, rules)
      ? "clear"
      : data.class_quotas !== undefined
        ? "replace"
        : "keep";
    const previousQuotas = quotaWrite === "keep"
      ? null
      : await loadClassQuotasFor(this.rawDb, EVENT_CLASS_QUOTA_TABLE, eventId);

    const assignments: string[] = [];
    const bindings: unknown[] = [];
    const add = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      bindings.push(value);
    };
    add("updated_at", patch.updatedAt);
    add("updated_by", patch.updatedBy);
    if (patch.type !== undefined) add("type", patch.type);
    if (patch.title !== undefined) add("title", patch.title);
    if (patch.description !== undefined) add("description", patch.description);
    if (patch.startAt !== undefined) add("start_at", patch.startAt);
    if (patch.endAt !== undefined) add("end_at", patch.endAt);
    if (patch.capacity !== undefined) add("capacity", patch.capacity);
    if (patch.pinned !== undefined) add("pinned", patch.pinned);
    if (patch.signupLocked !== undefined) add("signup_locked", patch.signupLocked);
    if (patch.autoArchive !== undefined) add("auto_archive", patch.autoArchive);
    if (patch.archivedAt !== undefined) add("archived_at", patch.archivedAt);
    if (patch.winnerCount !== undefined) add("winner_count", patch.winnerCount);
    const effectiveAttachments = data.attachments ?? existing.attachments;
    if (data.attachments !== undefined) {
      try {
        await this.deps.mediaService.replace({
          entityType: "event",
          entityId: eventId,
          slot: "attachment",
          media: effectiveAttachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
          ownerUserId: actorId,
          now: patch.updatedAt as string,
        });
      } catch (error) {
        if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
        throw error;
      }
    }
    try {
      await this.rawDb.batch([
        this.rawDb.prepare(`UPDATE events SET ${assignments.join(", ")} WHERE id = ?`).bind(...bindings, eventId),
        ...(pollDataProvided ? this.pollRaffle.buildUpdatePollStatements(eventId, data.poll!, hasVotes) : []),
        ...(quotaWrite === "clear"
          ? buildDeleteClassQuotaStatements(this.rawDb, EVENT_CLASS_QUOTA_TABLE, eventId)
          : quotaWrite === "replace"
            ? buildReplaceClassQuotaStatements(this.rawDb, EVENT_CLASS_QUOTA_TABLE, eventId, data.class_quotas!, () => this.createId())
            : []),
      ]);
    } catch (error) {
      if (data.attachments !== undefined) {
        try {
          await this.deps.mediaService.replace({
            entityType: "event",
            entityId: eventId,
            slot: "attachment",
            media: existing.attachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
            now: patch.updatedAt as string,
          });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Event ${eventId} update and media rollback both failed`);
        }
      }
      throw error;
    }

    const updated = await this.deps.getEventById(eventId);
    if (!updated) {
      throw new Error("Failed to load updated event");
    }
    updated.classQuotas = typeSupportsClassQuotas(updated.type, rules)
      ? await loadClassQuotasFor(this.rawDb, EVENT_CLASS_QUOTA_TABLE, eventId)
      : [];

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "update",
      actorId,
      entityId: eventId,
      diffTitle: updated.title,
      detail: this.buildUpdateDiff(existing, data, previousQuotas, updated.classQuotas),
    });

    return ok(updated);
  }

  async archiveEvent(actorId: string, eventId: string, existing: EventRow) {
    const now = this.now();
    await this.db
      .update(events)
      .set({
        archivedAt: now,
        updatedAt: now,
      })
      .where(eq(events.id, eventId));

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "archive",
      actorId,
      entityId: eventId,
      diffTitle: existing.title,
    });
  }

  async destroyEvent(actorId: string, eventId: string, existing: EventRow) {
    const now = this.now();
    await this.rawDb.batch([
      this.rawDb.prepare("UPDATE war_history SET event_id = NULL, updated_at = ?1 WHERE event_id = ?2").bind(now, eventId),
      this.rawDb.prepare("DELETE FROM event_raffle_winners WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_poll_votes WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_poll_options WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_polls WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_participants WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id IN (SELECT id FROM war_teams WHERE event_id = ?1)").bind(eventId),
      this.rawDb.prepare("DELETE FROM war_teams WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM war_pool_members WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM events WHERE id = ?1").bind(eventId),
    ]);

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "delete",
      actorId,
      entityId: eventId,
      diffTitle: existing.title,
    });
  }

  async uploadEventImages(actorId: string, eventId: string, existing: EventRow, uploads: readonly ParsedImageMediaUpload[]): Promise<ServiceResult<{ media_ids: string[]; attachments: string[] }>> {
    if (uploads.length === 0) {
      return err("VALIDATION_ERROR", "No files provided");
    }

    const existingAttachments = existing.attachments;
    const imageResult = await this.createImages(actorId, eventId, uploads, existingAttachments.length);
    if ("ok" in imageResult && !imageResult.ok) return imageResult;
    const mediaIds = imageResult as string[];
    const attachments = [...existingAttachments, ...mediaIds].slice(0, MAX_EVENT_ATTACHMENTS);

    try {
      const now = this.now();
      await this.deps.mediaService.replace({ entityType: "event", entityId: eventId, slot: "attachment", media: attachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), ownerUserId: actorId, now });
      try {
        await this.rawDb.prepare("UPDATE events SET updated_at = ?1 WHERE id = ?2").bind(now, eventId).run();
      } catch (error) {
        try {
          await this.deps.mediaService.replace({ entityType: "event", entityId: eventId, slot: "attachment", media: existingAttachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), now });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Event ${eventId} image upload and media rollback both failed`);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "upload_images",
      actorId,
      entityId: eventId,
      diffTitle: existing.title,
      detail: { media_ids: mediaIds },
    });

    return ok({ media_ids: mediaIds, attachments });
  }

  private buildUpdateDiff(
    existing: EventRow,
    data: UpdateEventInput,
    previousQuotas: ClassQuotaRow[] | null,
    nextQuotas: ClassQuotaRow[],
  ): Record<string, { from: JsonValue; to: JsonValue }> {
    const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
    /*
     * 配额直接记完整列表而不是像附件那样只记条数：职业 id 短且有意义，最多 20 条，
     * 而「哪一格从 2 改成 3」正是事后要查的东西。previousQuotas 为 null 表示这次请求
     * 压根没碰配额。
     */
    if (previousQuotas !== null && JSON.stringify(previousQuotas) !== JSON.stringify(nextQuotas)) {
      diff.class_quotas = { from: previousQuotas, to: nextQuotas };
    }
    if (data.type !== undefined && data.type !== existing.type)
      diff.type = { from: existing.type, to: data.type };
    if (data.title !== undefined && data.title.trim() !== existing.title)
      diff.title = { from: existing.title, to: data.title.trim() };
    if (data.description !== undefined && (data.description?.trim() || null) !== existing.description)
      diff.description = { from: existing.description, to: data.description?.trim() || null };
    if (data.start_at !== undefined && data.start_at !== existing.startAt)
      diff.start_at = { from: existing.startAt, to: data.start_at };
    if (data.end_at !== undefined && (data.end_at ?? null) !== existing.endAt)
      diff.end_at = { from: existing.endAt, to: data.end_at ?? null };
    if (data.capacity !== undefined && (data.capacity ?? null) !== existing.capacity)
      diff.capacity = { from: existing.capacity, to: data.capacity ?? null };
    if (data.pinned !== undefined && data.pinned !== existing.pinned)
      diff.pinned = { from: existing.pinned, to: data.pinned };
    if (data.signup_locked !== undefined && data.signup_locked !== existing.signupLocked)
      diff.signup_locked = { from: existing.signupLocked, to: data.signup_locked };
    if (data.auto_archive !== undefined && data.auto_archive !== existing.autoArchive)
      diff.auto_archive = { from: existing.autoArchive, to: data.auto_archive };
    if (data.archived_at !== undefined && (data.archived_at ?? null) !== existing.archivedAt)
      diff.archived_at = { from: existing.archivedAt, to: data.archived_at ?? null };
    if (data.attachments !== undefined) {
      const existingKeys = existing.attachments;
      if (JSON.stringify(data.attachments) !== JSON.stringify(existingKeys))
        diff.attachments = { from: existingKeys.length, to: data.attachments?.length ?? 0 };
    }
    return diff;
  }

  /**
   * 配额自身的服务层校验。zod 已经查过重复项和类型限制，这里再挡一次是因为
   * 「标签存不存在」只有拿到数据库才知道，而 zod 是纯函数。
   */
  private async validateClassQuotas(type: string, quotas: readonly ClassQuotaInput[], rules: GameRules): Promise<ServiceErr | null> {
    if (quotas.length === 0) {
      return null;
    }
    if (!typeSupportsClassQuotas(type, rules)) {
      return err("VALIDATION_ERROR", `${type} events do not use class quotas`);
    }
    const broken = await findBrokenQuotaReferences(this.rawDb, quotas);
    return broken ? err("VALIDATION_ERROR", broken) : null;
  }

  private validateAttachmentKeys(_eventId: string, keys: readonly string[]): ServiceErr | null {
    const invalid = keys.find((mediaId) => !isMediaId(mediaId));
    return invalid
      ? err("VALIDATION_ERROR", `Invalid event attachment media id: ${invalid}`)
      : null;
  }

  private createId(): string {
    return this.deps.createId?.() ?? nanoid();
  }

  private getGameRules(): Promise<GameRules> {
    return this.deps.getGameRules?.() ?? Promise.resolve(DEFAULT_GAME_RULES);
  }

  private validateDateRange(startAt: string | null | undefined, endAt: string | null | undefined): ServiceErr | null {
    if (startAt && endAt && endAt <= startAt) {
      return err("VALIDATION_ERROR", "end_at must be after start_at");
    }
    return null;
  }

  private async createImages(actorId: string, eventId: string, uploads: readonly ParsedImageMediaUpload[], existingAttachmentCount: number): Promise<string[] | ServiceErr> {
    if (uploads.length === 0) {
      return [];
    }

    if (existingAttachmentCount + uploads.length > MAX_EVENT_ATTACHMENTS) {
      return err("VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }

    const now = this.now();
    const mediaPolicy = await this.deps.getMediaPolicy();
    if (!await this.deps.mediaService.checkQuota({
      purpose: "event_image",
      ownerUserId: actorId,
      scope: { kind: "entity", entityType: "event", entityId: eventId },
      limit: MAX_EVENT_ATTACHMENTS,
      incomingCount: uploads.length,
      now,
    })) {
      return err("VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }

    try {
      const created = await this.deps.mediaService.createImages({ ownerUserId: actorId, purpose: "event_image", uploads, now, maxBytes: mediaPolicy.max_file_size_bytes.event_image });
      return created.mediaIds;
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  // --- Query methods moved from route ---

  static readonly eventSelectFields = {
    id: events.id,
    type: events.type,
    title: events.title,
    description: events.description,
    startAt: events.startAt,
    endAt: events.endAt,
    capacity: events.capacity,
    pinned: events.pinned,
    signupLocked: events.signupLocked,
    visibleAt: events.visibleAt,
    archivedAt: events.archivedAt,
    autoArchive: events.autoArchive,
    autoArchived: events.autoArchived,
    createdBy: events.createdBy,
    updatedBy: events.updatedBy,
    seriesId: events.seriesId,
    instanceDate: events.instanceDate,
    winnerCount: events.winnerCount,
    createdAt: events.createdAt,
    updatedAt: events.updatedAt,
  } as const;

  static buildEventsWhereFilters(params: {
    typeFilter?: string;
    archivedFilter?: boolean;
    pinnedFilter?: boolean;
    lockedFilter?: boolean;
    search?: string;
    startAfter?: string;
    startBefore?: string;
    canManage?: boolean;
    now?: string;
  }): SQL<unknown>[] {
    const filters: SQL<unknown>[] = [];
    if (!params.canManage) {
      filters.push(eventPublicVisibilityFilter(params.now ?? new Date().toISOString()));
    }
    if (params.typeFilter) {
      filters.push(eq(events.type, params.typeFilter as typeof events.type.enumValues[number]));
    }
    if (params.archivedFilter === true) {
      filters.push(isNotNull(events.archivedAt));
    } else if (params.archivedFilter === false) {
      filters.push(isNull(events.archivedAt));
    }
    if (params.pinnedFilter !== undefined) {
      filters.push(eq(events.pinned, params.pinnedFilter));
    }
    if (params.lockedFilter !== undefined) {
      filters.push(eq(events.signupLocked, params.lockedFilter));
    }
    const search = params.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      filters.push(or(likeEscaped(events.title, pattern), likeEscaped(events.description, pattern))!);
    }
    if (params.startAfter) filters.push(gte(events.startAt, params.startAfter));
    if (params.startBefore) filters.push(lte(events.startAt, params.startBefore));
    return filters;
  }

  /** 给一批行补上配额。投票和抽奖不带配额，排除掉，别白查一遍。 */
  private async hydrateClassQuotas(rows: EventBaseRow[]): Promise<EventRow[]> {
    const rules = await this.getGameRules();
    const [quotaMap, attachmentMap] = await Promise.all([
      loadClassQuotas(
        this.rawDb,
        EVENT_CLASS_QUOTA_TABLE,
        rows.filter((row) => typeSupportsClassQuotas(row.type, rules)).map((row) => row.id),
      ),
      this.deps.mediaService.listLinkedMedia("event", rows.map((row) => row.id), ["attachment"]),
    ]);
    return rows.map((row) => ({
      ...row,
      classQuotas: quotaMap.get(row.id) ?? [],
      attachments: (attachmentMap.get(row.id) ?? []).map((item) => item.mediaId),
    }));
  }

  async getEventById(eventId: string): Promise<EventRow | null> {
    const row = ((await this.db.select(EventCrudService.eventSelectFields).from(events).where(eq(events.id, eventId)).limit(1)) as EventBaseRow[])[0];
    if (!row) return null;
    const attachments = await this.deps.mediaService.listLinkedMediaIds("event", eventId, "attachment");
    return { ...row, attachments };
  }

  async listEvents(params: {
    page: number; limit: number; typeFilter?: string; archivedFilter?: boolean; pinnedFilter?: boolean; lockedFilter?: boolean; search?: string; startAfter?: string; startBefore?: string; viewerId?: string | null; canManage?: boolean;
  }) {
    const offset = (params.page - 1) * params.limit;
    const whereClause = and(...EventCrudService.buildEventsWhereFilters({
      ...params,
      now: this.now(),
    }));

    const [rows, countRow] = await Promise.all([
      this.db
        .select(EventCrudService.eventSelectFields)
        .from(events)
        .where(whereClause)
        .orderBy(asc(events.startAt), asc(events.id))
        .offset(offset)
        .limit(params.limit) as Promise<EventBaseRow[]>,
      this.db.select({ count: sql<number>`count(*)` }).from(events).where(whereClause) as Promise<{ count: number }[]>,
    ]);

    const total = Number(countRow[0]?.count ?? 0);

    const data = await this.pollRaffle.attachRaffleWinners(
      await this.pollRaffle.attachPolls(
        (await this.hydrateClassQuotas(rows)).map(toEventPayload),
        params.viewerId ?? null,
        params.canManage ?? false,
      ),
    );
    return {
      data,
      total,
      page: params.page,
      limit: params.limit,
      total_pages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async getEventDetail(eventId: string, viewerId?: string | null, canManage = false) {
    const eventRow = await this.getEventById(eventId);
    if (!eventRow) return null;
    if (!canManage && !isEventPubliclyVisible(eventRow.visibleAt, this.now())) return null;
    const hydratedEventRow = (await this.hydrateClassQuotas([eventRow]))[0]!;

    const participants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))) as EventParticipantRow[];

    const [eventWithPoll] = await this.pollRaffle.attachPolls([toEventPayload(hydratedEventRow)], viewerId ?? null, canManage);

    const rules = await this.getGameRules();
    const eventDefinition = findEventTypeDefinition(rules, eventRow.type);
    if (!eventDefinition) throw new Error(`Unknown configured event type: ${eventRow.type}`);
    const raffleWinners = eventDefinition.behavior === "raffle"
      ? ((await this.db
          .select({ id: eventRaffleWinners.id, eventId: eventRaffleWinners.eventId, userId: eventRaffleWinners.userId, drawnAt: eventRaffleWinners.drawnAt })
          .from(eventRaffleWinners)
          .where(eq(eventRaffleWinners.eventId, eventId))) as RaffleWinnerRow[])
      : [];

    return {
      ...eventWithPoll,
      participants: participants.map(toParticipantPayload),
      raffle_winners: raffleWinners.map(toRaffleWinnerPayload),
    };
  }

  async batchDetails(ids: string[], viewerId?: string | null, canManage = false) {
    const eventRows = (await this.db
      .select(EventCrudService.eventSelectFields)
      .from(events)
      .where(inArray(events.id, ids))) as EventBaseRow[];
    const visibleEventRows = canManage
      ? eventRows
      : eventRows.filter((row) => isEventPubliclyVisible(row.visibleAt, this.now()));
    if (visibleEventRows.length === 0) return [];
    const visibleEventIds = visibleEventRows.map((row) => row.id);

    const allParticipants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, visibleEventIds))) as EventParticipantRow[];

    const eventsWithPolls = await this.pollRaffle.attachRaffleWinners(
      await this.pollRaffle.attachPolls(
        (await this.hydrateClassQuotas(visibleEventRows)).map(toEventPayload),
        viewerId ?? null,
        canManage,
      ),
    );

    return eventsWithPolls.map((row) => ({
      ...row,
      participants: allParticipants.filter((p) => p.eventId === row.id).map(toParticipantPayload),
    }));
  }

}
