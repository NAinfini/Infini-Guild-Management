import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { events } from "../../db/schema";
import { err, ok, type ServiceErr, type ServiceResult } from "../result";
import {
  EventCrudService,
  diffRecurrenceRule,
  toTemplatePayload,
  type DatabaseLike,
  type EventRow,
  type EventServiceDeps,
  type RawDbLike,
} from "./EventCrudService";

type CreateTemplateInput = {
  type: string;
  title: string;
  description?: string | null;
  start_at: string;
  end_at?: string | null;
  capacity?: number | null;
  recurrence_rule: unknown;
  visibility_offset_minutes?: number | null;
  auto_archive?: boolean;
};

type UpdateTemplateInput = {
  type?: string;
  title?: string;
  description?: string | null;
  start_at?: string;
  end_at?: string | null;
  capacity?: number | null;
  recurrence_rule?: unknown;
  visibility_offset_minutes?: number | null;
  auto_archive?: boolean;
};

export class EventTemplateService {
  constructor(
    private readonly db: DatabaseLike,
    private readonly rawDb: RawDbLike,
    private readonly deps: EventServiceDeps,
  ) {}

  async createTemplate(actorId: string, data: CreateTemplateInput): Promise<ServiceResult<EventRow>> {
    const dateErr = this.validateDateRange(data.start_at, data.end_at);
    if (dateErr) return dateErr;

    const templateId = this.deps.createId?.() ?? nanoid();
    const recurrenceRuleJson = JSON.stringify(data.recurrence_rule);

    await this.db.insert(events).values({
      id: templateId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      startAt: data.start_at,
      endAt: data.end_at ?? null,
      capacity: data.capacity ?? null,
      pinned: false,
      signupLocked: false,
      autoArchive: data.auto_archive ?? false,
      autoArchived: false,
      archivedAt: null,
      createdBy: actorId,
      recurrenceRule: recurrenceRuleJson,
      attachments: "[]",
      seriesId: null,
      isSeriesParent: true,
      instanceDate: null,
      lastGeneratedDate: null,
      generationCount: 0,
      visibilityOffsetMinutes: data.visibility_offset_minutes ?? null,
    });

    const created = await this.deps.getEventById(templateId);
    if (!created) throw new Error("Failed to load created template");

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

  async updateTemplate(actorId: string, templateId: string, existing: EventRow, data: UpdateTemplateInput): Promise<ServiceResult<EventRow>> {
    const effectiveStartAt = data.start_at ?? existing.startAt;
    const effectiveEndAt = data.end_at !== undefined ? data.end_at : existing.endAt;
    const dateErr = this.validateDateRange(effectiveStartAt, effectiveEndAt);
    if (dateErr) return dateErr;

    const patch: Record<string, unknown> = { updatedAt: this.now() };
    if (data.type !== undefined) patch.type = data.type;
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.start_at !== undefined) patch.startAt = data.start_at;
    if (data.end_at !== undefined) patch.endAt = data.end_at;
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

    if (data.start_at !== undefined || data.recurrence_rule !== undefined) {
      patch.lastGeneratedDate = null;
      patch.generationCount = 0;
    }

    await this.db.update(events).set(patch).where(eq(events.id, templateId));

    const updated = await this.deps.getEventById(templateId);
    if (!updated) throw new Error("Failed to load updated template");

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "update",
      actorId,
      entityId: templateId,
      diffTitle: updated.title,
      detailText: JSON.stringify(this.buildTemplateUpdateDiff(existing, data)),
    });

    if (data.start_at !== undefined || data.recurrence_rule !== undefined) {
      await this.deps.materializeRecurringSeries(templateId);
    }

    return ok(updated);
  }

  async pauseTemplate(actorId: string, templateId: string, existing: EventRow): Promise<void> {
    const now = this.now();
    await this.db.update(events).set({ archivedAt: now, updatedAt: now }).where(eq(events.id, templateId));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "pause",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });
  }

  async resumeTemplate(actorId: string, templateId: string, existing: EventRow): Promise<void> {
    const now = this.now();
    await this.db.update(events).set({ archivedAt: null, updatedAt: now }).where(eq(events.id, templateId));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "resume",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });

    await this.deps.materializeRecurringSeries(templateId);
  }

  async deleteTemplate(actorId: string, templateId: string, existing: EventRow): Promise<void> {
    await this.rawDb.batch([
      this.rawDb.prepare("UPDATE events SET series_id = NULL WHERE series_id = ?1").bind(templateId),
      this.rawDb.prepare("DELETE FROM events WHERE id = ?1").bind(templateId),
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
    const rows = (await this.db
      .select(EventCrudService.eventSelectFields)
      .from(events)
      .where(eq(events.isSeriesParent, true))
      .orderBy(asc(events.createdAt), asc(events.id))) as EventRow[];

    return rows.map(toTemplatePayload);
  }

  private validateDateRange(startAt: string | null | undefined, endAt: string | null | undefined): ServiceErr | null {
    if (startAt && endAt && endAt <= startAt) {
      return err("VALIDATION_ERROR", "end_at must be after start_at");
    }
    return null;
  }

  private buildTemplateUpdateDiff(existing: EventRow, data: UpdateTemplateInput): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (data.type !== undefined && data.type !== existing.type)
      diff.type = { from: existing.type, to: data.type };
    if (data.title !== undefined && data.title !== existing.title)
      diff.title = { from: existing.title, to: data.title };
    if (data.description !== undefined && (data.description ?? null) !== existing.description)
      diff.description = { from: existing.description, to: data.description ?? null };
    if (data.start_at !== undefined && data.start_at !== existing.startAt)
      diff.start_at = { from: existing.startAt, to: data.start_at };
    if (data.end_at !== undefined && (data.end_at ?? null) !== existing.endAt)
      diff.end_at = { from: existing.endAt, to: data.end_at ?? null };
    if (data.capacity !== undefined && (data.capacity ?? null) !== existing.capacity)
      diff.capacity = { from: existing.capacity, to: data.capacity ?? null };
    if (data.recurrence_rule !== undefined) {
      diffRecurrenceRule(existing.recurrenceRule, data.recurrence_rule, diff);
    }
    if (data.visibility_offset_minutes !== undefined && (data.visibility_offset_minutes ?? null) !== (existing.visibilityOffsetMinutes ?? null))
      diff.visibility_offset_minutes = { from: existing.visibilityOffsetMinutes, to: data.visibility_offset_minutes ?? null };
    if (data.auto_archive !== undefined && data.auto_archive !== existing.autoArchive)
      diff.auto_archive = { from: existing.autoArchive, to: data.auto_archive };
    return diff;
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}
