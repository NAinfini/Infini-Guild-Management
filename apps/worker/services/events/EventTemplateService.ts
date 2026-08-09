import {
  DEFAULT_GAME_RULES,
  createTemplateSchema,
  findEventTypeDefinition,
  recurringTemplateSchema,
  updateTemplateSchema,
  type GameRules,
  type JsonValue,
  type RecurrenceRule,
} from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "../audit";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { recurringTemplates, recurringTemplateWeekdays } from "../../db/schema";
import { err, ok, type ServiceErr, type ServiceResult } from "../result";
import type { DatabaseLike, RawDbLike } from "./EventCrudService";
import type { MediaService } from "../MediaService";
import { MediaValidationError } from "../MediaService";
import { isMediaId } from "../media-keys";
import {
  buildDeleteClassQuotaStatements,
  buildReplaceClassQuotaStatements,
  findBrokenQuotaReferences,
  loadClassQuotas,
  loadClassQuotasFor,
  typeSupportsClassQuotas,
  TEMPLATE_CLASS_QUOTA_TABLE,
  type ClassQuotaInput,
  type ClassQuotaRow,
} from "./event-class-quotas";

export type TemplateRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  startTime: string;
  durationMinutes: number | null;
  capacity: number | null;
  recurrenceFrequency: RecurrenceRule["frequency"];
  recurrenceInterval: number;
  recurrenceDayOfMonth: number | null;
  recurrenceEndAfter: number | null;
  recurrenceEndAt: string | null;
  weekdays: number[];
  visibilityOffsetMinutes: number;
  autoArchive: boolean;
  attachments: string[];
  paused: boolean;
  createdBy: string;
  lastGeneratedDate: string | null;
  generationCount: number;
  createdAt: string;
  updatedAt: string;
  /* 存在另一张表里，只有显式读过配额的路径才会带上；缺省当空数组处理。 */
  classQuotas?: ClassQuotaRow[];
};

type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export type TemplateServiceDeps = {
  getTemplateById: (templateId: string) => Promise<TemplateRow | null>;
  materializeRecurringSeries: (templateId: string) => Promise<void>;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  mediaService: MediaService;
  systemTestRunId?: string | null;
  now?: () => string;
  createId?: () => string;
  getGameRules?: () => Promise<GameRules>;
};

const templateSelectFields = {
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
} as const;

type TemplateRecurrenceColumns = Pick<
  TemplateRow,
  | "recurrenceFrequency"
  | "recurrenceInterval"
  | "recurrenceDayOfMonth"
  | "recurrenceEndAfter"
  | "recurrenceEndAt"
  | "weekdays"
>;

export function recurrenceRuleFromColumns(row: TemplateRecurrenceColumns): RecurrenceRule {
  if (row.recurrenceEndAfter !== null && row.recurrenceEndAt !== null) {
    throw new Error("Invalid recurring template: multiple recurrence end conditions");
  }
  const end = row.recurrenceEndAfter !== null
    ? { endAfter: row.recurrenceEndAfter }
    : row.recurrenceEndAt !== null
      ? { endDate: row.recurrenceEndAt }
      : {};

  if (row.recurrenceFrequency === "daily") {
    if (row.recurrenceDayOfMonth !== null || row.weekdays.length > 0) {
      throw new Error("Invalid daily recurrence columns");
    }
    return { frequency: "daily", interval: row.recurrenceInterval, ...end };
  }
  if (row.recurrenceFrequency === "weekly") {
    if (row.recurrenceDayOfMonth !== null || row.weekdays.length === 0) {
      throw new Error("Invalid weekly recurrence columns");
    }
    return { frequency: "weekly", interval: row.recurrenceInterval, daysOfWeek: row.weekdays, ...end };
  }
  if (row.recurrenceDayOfMonth === null || row.weekdays.length > 0) {
    throw new Error("Invalid monthly recurrence columns");
  }
  return {
    frequency: "monthly",
    interval: row.recurrenceInterval,
    dayOfMonth: row.recurrenceDayOfMonth,
    ...end,
  };
}

function recurrenceColumns(rule: RecurrenceRule) {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    dayOfMonth: rule.frequency === "monthly" ? rule.dayOfMonth : null,
    endAfter: rule.endAfter ?? null,
    endAt: rule.endDate ?? null,
  };
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function recurrenceRulesEqual(left: RecurrenceRule, right: RecurrenceRule): boolean {
  if (
    left.frequency !== right.frequency
    || left.interval !== right.interval
    || (left.endAfter ?? null) !== (right.endAfter ?? null)
    || (left.endDate ?? null) !== (right.endDate ?? null)
  ) {
    return false;
  }
  if (left.frequency === "weekly" && right.frequency === "weekly") {
    return sameNumbers(left.daysOfWeek, right.daysOfWeek);
  }
  return left.frequency !== "monthly"
    || right.frequency !== "monthly"
    || left.dayOfMonth === right.dayOfMonth;
}

function diffRecurrenceRule(
  existingRule: RecurrenceRule,
  newRule: RecurrenceRule,
  diff: Record<string, { from: JsonValue; to: JsonValue }>,
): void {
  const fields: Array<[string, JsonValue, JsonValue]> = [
    ["frequency", existingRule.frequency, newRule.frequency],
    ["interval", existingRule.interval, newRule.interval],
    ["daysOfWeek", existingRule.frequency === "weekly" ? existingRule.daysOfWeek : null, newRule.frequency === "weekly" ? newRule.daysOfWeek : null],
    ["dayOfMonth", existingRule.frequency === "monthly" ? existingRule.dayOfMonth : null, newRule.frequency === "monthly" ? newRule.dayOfMonth : null],
    ["endAfter", existingRule.endAfter ?? null, newRule.endAfter ?? null],
    ["endDate", existingRule.endDate ?? null, newRule.endDate ?? null],
  ];
  for (const [field, from, to] of fields) {
    const equal = Array.isArray(from) && Array.isArray(to)
      ? sameNumbers(from as number[], to as number[])
      : from === to;
    if (!equal) diff[`recurrence_rule.${field}`] = { from, to };
  }
}

export function toTemplatePayload(row: TemplateRow) {
  const result = recurringTemplateSchema.safeParse({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    start_time: row.startTime,
    duration_minutes: row.durationMinutes,
    capacity: row.capacity,
    recurrence_rule: recurrenceRuleFromColumns(row),
    visibility_offset_minutes: row.visibilityOffsetMinutes,
    auto_archive: row.autoArchive,
    attachments: row.attachments,
    class_quotas: row.classQuotas ?? [],
    paused: row.paused,
    created_by: row.createdBy,
    last_generated_date: row.lastGeneratedDate,
    generation_count: row.generationCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid template data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export class EventTemplateService {
  constructor(
    private readonly db: DatabaseLike,
    private readonly rawDb: RawDbLike,
    private readonly deps: TemplateServiceDeps,
  ) {}

  async getTemplateById(templateId: string): Promise<TemplateRow | null> {
    const row = ((await this.db.select(templateSelectFields).from(recurringTemplates).where(eq(recurringTemplates.id, templateId)).limit(1)) as Omit<TemplateRow, "attachments" | "weekdays">[])[0];
    if (!row) return null;
    const [weekdayRows, attachments] = await Promise.all([
      this.db
        .select({ weekday: recurringTemplateWeekdays.weekday })
        .from(recurringTemplateWeekdays)
        .where(eq(recurringTemplateWeekdays.templateId, templateId))
        .orderBy(asc(recurringTemplateWeekdays.weekday)) as Promise<Array<{ weekday: number }>>,
      this.deps.mediaService.listLinkedMediaIds("recurring_template", templateId, "attachment"),
    ]);
    return { ...row, weekdays: weekdayRows.map(({ weekday }) => weekday), attachments };
  }

  async createTemplate(actorId: string, data: CreateTemplateInput): Promise<ServiceResult<TemplateRow>> {
    const rules = await this.getGameRules();
    const typeDefinition = findEventTypeDefinition(rules, data.type);
    if (!typeDefinition || !typeDefinition.enabled) {
      return err("VALIDATION_ERROR", `Unknown or disabled event type: ${data.type}`);
    }
    const quotas = data.class_quotas ?? [];
    const quotaErr = await this.validateClassQuotas(data.type, quotas, rules);
    if (quotaErr) return quotaErr;

    const templateId = this.createId();
    const attachmentErr = this.validateAttachmentIds(data.attachments ?? []);
    if (attachmentErr) return attachmentErr;
    const recurrence = recurrenceColumns(data.recurrence_rule);
    const attachments = data.attachments ?? [];
    const now = this.now();
    await this.rawDb.batch([
        this.rawDb.prepare(`
          INSERT INTO recurring_templates
            (id, type, title, description, start_time, duration_minutes, capacity,
             recurrence_frequency, recurrence_interval, recurrence_day_of_month,
             recurrence_end_after, recurrence_end_at,
             visibility_offset_minutes, auto_archive, paused, created_by,
             last_generated_date, generation_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, 0, ?, ?)
        `).bind(
          templateId, data.type, data.title, data.description ?? null, data.start_time,
          data.duration_minutes ?? null, data.capacity ?? null,
          recurrence.frequency, recurrence.interval, recurrence.dayOfMonth,
          recurrence.endAfter, recurrence.endAt,
          data.visibility_offset_minutes ?? 0, data.auto_archive ?? false,
          actorId, now, now,
        ),
        ...(data.recurrence_rule.frequency === "weekly"
          ? data.recurrence_rule.daysOfWeek.map((weekday) => this.rawDb
              .prepare("INSERT INTO recurring_template_weekdays (template_id, weekday) VALUES (?1, ?2)")
              .bind(templateId, weekday))
          : []),
        ...(quotas.length > 0
          ? buildReplaceClassQuotaStatements(this.rawDb, TEMPLATE_CLASS_QUOTA_TABLE, templateId, quotas, () => this.createId())
          : []),
    ]);
    try {
      await this.deps.mediaService.replace({
        entityType: "recurring_template",
        entityId: templateId,
        slot: "attachment",
        media: attachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
        ownerUserId: actorId,
        now,
      });
    } catch (error) {
      try {
        await this.rawDb.prepare("DELETE FROM recurring_templates WHERE id = ?1").bind(templateId).run();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Template ${templateId} attachment and parent cleanup both failed`);
      }
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }

    const created = await this.deps.getTemplateById(templateId);
    if (!created) throw new Error("Failed to load created template");
    // 回读而不是回显请求体：落库后的顺序按职业目录排，跟后续 GET 保持一致。
    created.classQuotas = quotas.length > 0
      ? await loadClassQuotasFor(this.rawDb, TEMPLATE_CLASS_QUOTA_TABLE, templateId)
      : [];

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "create",
      actorId,
      entityId: templateId,
      diffTitle: created.title,
    });

    return ok(created);
  }

  async updateTemplate(actorId: string, templateId: string, existing: TemplateRow, data: UpdateTemplateInput): Promise<ServiceResult<TemplateRow>> {
    const rules = await this.getGameRules();
    const effectiveType = data.type ?? existing.type;
    const typeDefinition = findEventTypeDefinition(rules, effectiveType);
    if (!typeDefinition || !typeDefinition.enabled) {
      return err("VALIDATION_ERROR", `Unknown or disabled event type: ${effectiveType}`);
    }
    const quotaErr = await this.validateClassQuotas(effectiveType, data.class_quotas ?? [], rules);
    if (quotaErr) return quotaErr;
    const attachmentErr = this.validateAttachmentIds(data.attachments ?? existing.attachments);
    if (attachmentErr) return attachmentErr;

    const patch: Record<string, unknown> = { updatedAt: this.now() };
    if (data.type !== undefined) patch.type = data.type;
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.start_time !== undefined) patch.startTime = data.start_time;
    if (data.duration_minutes !== undefined) patch.durationMinutes = data.duration_minutes;
    if (data.capacity !== undefined) patch.capacity = data.capacity;
    if (data.recurrence_rule !== undefined) {
      const recurrence = recurrenceColumns(data.recurrence_rule);
      patch.recurrenceFrequency = recurrence.frequency;
      patch.recurrenceInterval = recurrence.interval;
      patch.recurrenceDayOfMonth = recurrence.dayOfMonth;
      patch.recurrenceEndAfter = recurrence.endAfter;
      patch.recurrenceEndAt = recurrence.endAt;
    }
    if (data.visibility_offset_minutes !== undefined) {
      patch.visibilityOffsetMinutes = data.visibility_offset_minutes;
    }
    if (data.auto_archive !== undefined) {
      patch.autoArchive = data.auto_archive;
    }

    const scheduleChanged =
      (data.start_time !== undefined && data.start_time !== existing.startTime) ||
      (data.recurrence_rule !== undefined && !recurrenceRulesEqual(data.recurrence_rule, recurrenceRuleFromColumns(existing)));
    if (scheduleChanged) {
      patch.lastGeneratedDate = this.now().slice(0, 10);
      patch.generationCount = 0;
    }

    /*
     * 跟活动侧同一套规则：改成投票／抽奖就清空配额，否则按请求整组替换。旧值只在
     * 真要动配额时才读，用来写审计日志的 from。
     */
    const quotaWrite = !typeSupportsClassQuotas(effectiveType, rules)
      ? "clear"
      : data.class_quotas !== undefined
        ? "replace"
        : "keep";
    const previousQuotas = quotaWrite === "keep"
      ? null
      : await loadClassQuotasFor(this.rawDb, TEMPLATE_CLASS_QUOTA_TABLE, templateId);

    const assignments: string[] = [];
    const bindings: unknown[] = [];
    const add = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      bindings.push(value);
    };
    add("updated_at", patch.updatedAt);
    if (patch.type !== undefined) add("type", patch.type);
    if (patch.title !== undefined) add("title", patch.title);
    if (patch.description !== undefined) add("description", patch.description);
    if (patch.startTime !== undefined) add("start_time", patch.startTime);
    if (patch.durationMinutes !== undefined) add("duration_minutes", patch.durationMinutes);
    if (patch.capacity !== undefined) add("capacity", patch.capacity);
    if (patch.recurrenceFrequency !== undefined) add("recurrence_frequency", patch.recurrenceFrequency);
    if (patch.recurrenceInterval !== undefined) add("recurrence_interval", patch.recurrenceInterval);
    if (patch.recurrenceDayOfMonth !== undefined) add("recurrence_day_of_month", patch.recurrenceDayOfMonth);
    if (patch.recurrenceEndAfter !== undefined) add("recurrence_end_after", patch.recurrenceEndAfter);
    if (patch.recurrenceEndAt !== undefined) add("recurrence_end_at", patch.recurrenceEndAt);
    if (patch.visibilityOffsetMinutes !== undefined) add("visibility_offset_minutes", patch.visibilityOffsetMinutes);
    if (patch.autoArchive !== undefined) add("auto_archive", patch.autoArchive);
    if (patch.lastGeneratedDate !== undefined) add("last_generated_date", patch.lastGeneratedDate);
    if (patch.generationCount !== undefined) add("generation_count", patch.generationCount);
    const effectiveAttachments = data.attachments ?? existing.attachments;
    if (data.attachments !== undefined) {
      try {
        await this.deps.mediaService.replace({ entityType: "recurring_template", entityId: templateId, slot: "attachment", media: effectiveAttachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), ownerUserId: actorId, now: patch.updatedAt as string });
      } catch (error) {
        if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
        throw error;
      }
    }
    try {
      await this.rawDb.batch([
        this.rawDb.prepare(`UPDATE recurring_templates SET ${assignments.join(", ")} WHERE id = ?`).bind(...bindings, templateId),
        ...(data.recurrence_rule === undefined
          ? []
          : [
              this.rawDb.prepare("DELETE FROM recurring_template_weekdays WHERE template_id = ?1").bind(templateId),
              ...(data.recurrence_rule.frequency === "weekly"
                ? data.recurrence_rule.daysOfWeek.map((weekday) => this.rawDb
                    .prepare("INSERT INTO recurring_template_weekdays (template_id, weekday) VALUES (?1, ?2)")
                    .bind(templateId, weekday))
                : []),
            ]),
        ...(quotaWrite === "clear"
          ? buildDeleteClassQuotaStatements(this.rawDb, TEMPLATE_CLASS_QUOTA_TABLE, templateId)
          : quotaWrite === "replace"
            ? buildReplaceClassQuotaStatements(this.rawDb, TEMPLATE_CLASS_QUOTA_TABLE, templateId, data.class_quotas!, () => this.createId())
            : []),
      ]);
    } catch (error) {
      if (data.attachments !== undefined) {
        try {
          await this.deps.mediaService.replace({
            entityType: "recurring_template",
            entityId: templateId,
            slot: "attachment",
            media: existing.attachments.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
            now: patch.updatedAt as string,
          });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Template ${templateId} update and media rollback both failed`);
        }
      }
      throw error;
    }

    const updated = await this.deps.getTemplateById(templateId);
    if (!updated) throw new Error("Failed to load updated template");
    updated.classQuotas = typeSupportsClassQuotas(updated.type, rules)
      ? await loadClassQuotasFor(this.rawDb, TEMPLATE_CLASS_QUOTA_TABLE, templateId)
      : [];

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "update",
      actorId,
      entityId: templateId,
      diffTitle: updated.title,
      detail: this.buildTemplateUpdateDiff(existing, data, previousQuotas, updated.classQuotas),
    });

    if (scheduleChanged) {
      await this.deps.materializeRecurringSeries(templateId);
    }

    return ok(updated);
  }

  async pauseTemplate(actorId: string, templateId: string, existing: TemplateRow): Promise<void> {
    await this.db.update(recurringTemplates).set({ paused: true, updatedAt: this.now() }).where(eq(recurringTemplates.id, templateId));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "pause",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });
  }

  async resumeTemplate(actorId: string, templateId: string, existing: TemplateRow): Promise<void> {
    await this.db.update(recurringTemplates).set({ paused: false, updatedAt: this.now() }).where(eq(recurringTemplates.id, templateId));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "resume",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });

    await this.deps.materializeRecurringSeries(templateId);
  }

  async deleteTemplate(actorId: string, templateId: string, existing: TemplateRow): Promise<void> {
    const systemTestStatements = this.deps.systemTestRunId
      ? [
          this.rawDb.prepare(
            `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
             VALUES (
               (SELECT id FROM system_test_runs WHERE id = ?1 AND status = 'running'),
               'event_template',
               ?2
             )
             ON CONFLICT(run_id, artifact_type, artifact_key)
             DO UPDATE SET artifact_key = excluded.artifact_key`,
          ).bind(this.deps.systemTestRunId, templateId),
          this.rawDb.prepare(
            `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
             SELECT ?1, 'event', id FROM events WHERE series_id = ?2
             ON CONFLICT(run_id, artifact_type, artifact_key)
             DO UPDATE SET artifact_key = excluded.artifact_key`,
          ).bind(this.deps.systemTestRunId, templateId),
        ]
      : [];
    await this.rawDb.batch([
      ...systemTestStatements,
      this.rawDb.prepare("UPDATE events SET series_id = NULL, instance_date = NULL WHERE series_id = ?1").bind(templateId),
      this.rawDb.prepare("DELETE FROM recurring_templates WHERE id = ?1").bind(templateId),
    ]);

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "delete",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });
  }

  async listTemplates() {
    const rules = await this.getGameRules();
    const rows = (await this.db
      .select(templateSelectFields)
      .from(recurringTemplates)
      .orderBy(asc(recurringTemplates.createdAt), asc(recurringTemplates.id))) as Array<Omit<TemplateRow, "attachments" | "weekdays">>;

    const [quotaMap, attachmentMap, weekdayRows] = await Promise.all([
      loadClassQuotas(
        this.rawDb,
        TEMPLATE_CLASS_QUOTA_TABLE,
        rows.filter((row) => typeSupportsClassQuotas(row.type, rules)).map((row) => row.id),
      ),
      this.deps.mediaService.listLinkedMedia("recurring_template", rows.map((row) => row.id), ["attachment"]),
      this.db
        .select({ templateId: recurringTemplateWeekdays.templateId, weekday: recurringTemplateWeekdays.weekday })
        .from(recurringTemplateWeekdays)
        .orderBy(asc(recurringTemplateWeekdays.templateId), asc(recurringTemplateWeekdays.weekday)) as Promise<Array<{ templateId: string; weekday: number }>>,
    ]);
    const weekdaysByTemplate = new Map<string, number[]>();
    for (const { templateId, weekday } of weekdayRows) {
      const weekdays = weekdaysByTemplate.get(templateId) ?? [];
      weekdays.push(weekday);
      weekdaysByTemplate.set(templateId, weekdays);
    }
    const hydratedRows: TemplateRow[] = [];
    for (const row of rows) {
      hydratedRows.push({
        ...row,
        weekdays: weekdaysByTemplate.get(row.id) ?? [],
        classQuotas: quotaMap.get(row.id) ?? [],
        attachments: (attachmentMap.get(row.id) ?? []).map((link) => link.mediaId),
      });
    }

    return hydratedRows.map(toTemplatePayload);
  }

  /**
   * 配额自身的服务层校验。zod 已经查过重复项和类型限制，这里再挡一次是因为
   * 「标签存不存在」只有拿到数据库才知道。
   */
  private async validateClassQuotas(type: string, quotas: readonly ClassQuotaInput[], rules: GameRules): Promise<ServiceErr | null> {
    if (quotas.length === 0) {
      return null;
    }
    if (!typeSupportsClassQuotas(type, rules)) {
      return err("VALIDATION_ERROR", `${type} templates do not use class quotas`);
    }
    const broken = await findBrokenQuotaReferences(this.rawDb, quotas);
    return broken ? err("VALIDATION_ERROR", broken) : null;
  }

  private validateAttachmentIds(ids: readonly string[]): ServiceErr | null {
    const invalid = ids.find((id) => !isMediaId(id));
    return invalid
      ? err("VALIDATION_ERROR", `Invalid recurring-template media id: ${invalid}`)
      : null;
  }

  private createId(): string {
    return this.deps.createId?.() ?? nanoid();
  }

  private getGameRules(): Promise<GameRules> {
    return this.deps.getGameRules?.() ?? Promise.resolve(DEFAULT_GAME_RULES);
  }

  private buildTemplateUpdateDiff(
    existing: TemplateRow,
    data: UpdateTemplateInput,
    previousQuotas: ClassQuotaRow[] | null,
    nextQuotas: ClassQuotaRow[],
  ): Record<string, { from: JsonValue; to: JsonValue }> {
    const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
    if (previousQuotas !== null && JSON.stringify(previousQuotas) !== JSON.stringify(nextQuotas)) {
      diff.class_quotas = { from: previousQuotas, to: nextQuotas };
    }
    if (data.type !== undefined && data.type !== existing.type)
      diff.type = { from: existing.type, to: data.type };
    if (data.title !== undefined && data.title !== existing.title)
      diff.title = { from: existing.title, to: data.title };
    if (data.description !== undefined && (data.description ?? null) !== existing.description)
      diff.description = { from: existing.description, to: data.description ?? null };
    if (data.start_time !== undefined && data.start_time !== existing.startTime)
      diff.start_time = { from: existing.startTime, to: data.start_time };
    if (data.duration_minutes !== undefined && (data.duration_minutes ?? null) !== existing.durationMinutes)
      diff.duration_minutes = { from: existing.durationMinutes, to: data.duration_minutes ?? null };
    if (data.capacity !== undefined && (data.capacity ?? null) !== existing.capacity)
      diff.capacity = { from: existing.capacity, to: data.capacity ?? null };
    if (data.recurrence_rule !== undefined) {
      diffRecurrenceRule(recurrenceRuleFromColumns(existing), data.recurrence_rule, diff);
    }
    if (data.visibility_offset_minutes !== undefined && (data.visibility_offset_minutes ?? 0) !== existing.visibilityOffsetMinutes)
      diff.visibility_offset_minutes = { from: existing.visibilityOffsetMinutes, to: data.visibility_offset_minutes ?? 0 };
    if (data.auto_archive !== undefined && data.auto_archive !== existing.autoArchive)
      diff.auto_archive = { from: existing.autoArchive, to: data.auto_archive };
    if (data.attachments !== undefined) {
      const existingKeys = existing.attachments;
      if (JSON.stringify(data.attachments) !== JSON.stringify(existingKeys))
        diff.attachments = { from: existingKeys.length, to: data.attachments?.length ?? 0 };
    }
    return diff;
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}
