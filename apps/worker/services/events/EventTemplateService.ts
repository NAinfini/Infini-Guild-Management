import { recurringTemplateSchema } from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "../audit";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { recurringTemplates } from "../../db/schema";
import { ok, type ServiceResult } from "../result";
import { diffRecurrenceRule, parseAttachments, parseRecurrenceRule, type DatabaseLike, type RawDbLike } from "./EventCrudService";
import { replaceMediaRefs, deleteMediaRefs, extractAttachmentKeys } from "../media-references";

export type TemplateRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  startTime: string;
  durationMinutes: number | null;
  capacity: number | null;
  recurrenceRule: string;
  visibilityOffsetMinutes: number;
  autoArchive: boolean;
  attachments: string;
  paused: boolean;
  createdBy: string;
  lastGeneratedDate: string | null;
  generationCount: number;
  createdAt: string;
  updatedAt: string;
};

type CreateTemplateInput = {
  type: string;
  title: string;
  description?: string | null;
  start_time: string;
  duration_minutes?: number | null;
  capacity?: number | null;
  recurrence_rule: unknown;
  visibility_offset_minutes?: number | null;
  auto_archive?: boolean;
  attachments?: string[];
};

type UpdateTemplateInput = {
  type?: string;
  title?: string;
  description?: string | null;
  start_time?: string;
  duration_minutes?: number | null;
  capacity?: number | null;
  recurrence_rule?: unknown;
  visibility_offset_minutes?: number | null;
  auto_archive?: boolean;
  attachments?: string[];
};

export type TemplateServiceDeps = {
  getTemplateById: (templateId: string) => Promise<TemplateRow | null>;
  materializeRecurringSeries: (templateId: string) => Promise<void>;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  now?: () => string;
  createId?: () => string;
};

const templateSelectFields = {
  id: recurringTemplates.id,
  type: recurringTemplates.type,
  title: recurringTemplates.title,
  description: recurringTemplates.description,
  startTime: recurringTemplates.startTime,
  durationMinutes: recurringTemplates.durationMinutes,
  capacity: recurringTemplates.capacity,
  recurrenceRule: recurringTemplates.recurrenceRule,
  visibilityOffsetMinutes: recurringTemplates.visibilityOffsetMinutes,
  autoArchive: recurringTemplates.autoArchive,
  attachments: recurringTemplates.attachments,
  paused: recurringTemplates.paused,
  createdBy: recurringTemplates.createdBy,
  lastGeneratedDate: recurringTemplates.lastGeneratedDate,
  generationCount: recurringTemplates.generationCount,
  createdAt: recurringTemplates.createdAt,
  updatedAt: recurringTemplates.updatedAt,
} as const;

export function toTemplatePayload(row: TemplateRow) {
  const result = recurringTemplateSchema.safeParse({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    start_time: row.startTime,
    duration_minutes: row.durationMinutes,
    capacity: row.capacity,
    recurrence_rule: parseRecurrenceRule(row.recurrenceRule),
    visibility_offset_minutes: row.visibilityOffsetMinutes,
    auto_archive: row.autoArchive,
    attachments: parseAttachments(row.attachments),
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
    return ((await this.db.select(templateSelectFields).from(recurringTemplates).where(eq(recurringTemplates.id, templateId)).limit(1)) as TemplateRow[])[0] ?? null;
  }

  async createTemplate(actorId: string, data: CreateTemplateInput): Promise<ServiceResult<TemplateRow>> {
    const templateId = this.deps.createId?.() ?? nanoid();
    const recurrenceRuleJson = JSON.stringify(data.recurrence_rule);

    await this.db.insert(recurringTemplates).values({
      id: templateId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      startTime: data.start_time,
      durationMinutes: data.duration_minutes ?? null,
      capacity: data.capacity ?? null,
      recurrenceRule: recurrenceRuleJson,
      visibilityOffsetMinutes: data.visibility_offset_minutes ?? 0,
      autoArchive: data.auto_archive ?? false,
      attachments: JSON.stringify(data.attachments ?? []),
      paused: false,
      createdBy: actorId,
      lastGeneratedDate: null,
      generationCount: 0,
    });

    const created = await this.deps.getTemplateById(templateId);
    if (!created) throw new Error("Failed to load created template");

    await replaceMediaRefs(this.rawDb as unknown as D1Database, "recurring_template", templateId, extractAttachmentKeys(created.attachments));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "create",
      actorId,
      entityId: templateId,
      diffTitle: created.title,
      detailText: JSON.stringify({ recurrence_rule: data.recurrence_rule }),
    });

    return ok(created);
  }

  async updateTemplate(actorId: string, templateId: string, existing: TemplateRow, data: UpdateTemplateInput): Promise<ServiceResult<TemplateRow>> {
    const patch: Record<string, unknown> = { updatedAt: this.now() };
    if (data.type !== undefined) patch.type = data.type;
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.start_time !== undefined) patch.startTime = data.start_time;
    if (data.duration_minutes !== undefined) patch.durationMinutes = data.duration_minutes;
    if (data.capacity !== undefined) patch.capacity = data.capacity;
    if (data.recurrence_rule !== undefined) {
      patch.recurrenceRule = JSON.stringify(data.recurrence_rule);
    }
    if (data.visibility_offset_minutes !== undefined) {
      patch.visibilityOffsetMinutes = data.visibility_offset_minutes;
    }
    if (data.auto_archive !== undefined) {
      patch.autoArchive = data.auto_archive;
    }
    if (data.attachments !== undefined) {
      patch.attachments = JSON.stringify(data.attachments);
    }

    const scheduleChanged =
      (data.start_time !== undefined && data.start_time !== existing.startTime) ||
      (data.recurrence_rule !== undefined && JSON.stringify(data.recurrence_rule) !== existing.recurrenceRule);
    if (scheduleChanged) {
      patch.lastGeneratedDate = this.now().slice(0, 10);
      patch.generationCount = 0;
    }

    await this.db.update(recurringTemplates).set(patch).where(eq(recurringTemplates.id, templateId));

    const updated = await this.deps.getTemplateById(templateId);
    if (!updated) throw new Error("Failed to load updated template");

    await replaceMediaRefs(this.rawDb as unknown as D1Database, "recurring_template", templateId, extractAttachmentKeys(updated.attachments));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "update",
      actorId,
      entityId: templateId,
      diffTitle: updated.title,
      detailText: JSON.stringify(this.buildTemplateUpdateDiff(existing, data)),
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
    await this.rawDb.batch([
      this.rawDb.prepare("UPDATE events SET series_id = NULL WHERE series_id = ?1").bind(templateId),
      this.rawDb.prepare("DELETE FROM recurring_templates WHERE id = ?1").bind(templateId),
    ]);

    await deleteMediaRefs(this.rawDb as unknown as D1Database, "recurring_template", templateId);

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "delete",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });
  }

  async listTemplates() {
    const rows = (await this.db
      .select(templateSelectFields)
      .from(recurringTemplates)
      .orderBy(asc(recurringTemplates.createdAt), asc(recurringTemplates.id))) as TemplateRow[];

    return rows.map(toTemplatePayload);
  }

  private buildTemplateUpdateDiff(existing: TemplateRow, data: UpdateTemplateInput): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
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
      diffRecurrenceRule(existing.recurrenceRule, data.recurrence_rule, diff);
    }
    if (data.visibility_offset_minutes !== undefined && (data.visibility_offset_minutes ?? 0) !== existing.visibilityOffsetMinutes)
      diff.visibility_offset_minutes = { from: existing.visibilityOffsetMinutes, to: data.visibility_offset_minutes ?? 0 };
    if (data.auto_archive !== undefined && data.auto_archive !== existing.autoArchive)
      diff.auto_archive = { from: existing.autoArchive, to: data.auto_archive };
    if (data.attachments !== undefined) {
      const existingKeys = parseAttachments(existing.attachments);
      if (JSON.stringify(data.attachments) !== JSON.stringify(existingKeys))
        diff.attachments = { from: existingKeys.length, to: data.attachments?.length ?? 0 };
    }
    return diff;
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}
