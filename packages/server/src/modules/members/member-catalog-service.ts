import type {
  ClassCatalogItem,
  ClassTag,
  AuditChange,
  CreateClassCatalogItemInput,
  CreateClassTagInput,
  MemberBadge,
  ReorderClassCatalogInput,
  ReorderClassTagsInput,
  ReorderMemberBadgesInput,
  UpdateClassCatalogItemInput,
  UpdateClassTagInput,
} from "@guild/shared";
import { badgeAssignmentsListQuerySchema } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared";
import { AppError, type RequestContext } from "@guild/kernel";
import { createAuditEvent } from "../audit/public.js";
import type { ImageUpload } from "../media/public.js";
import type {
  BadgeAssignmentCursor,
  BadgeAssignmentRecord,
  ClassTagUsageReader,
  MemberMediaPort,
  MembersStore,
} from "./member-types";
import { sanitizeInlineHtml } from "./inline-html";

type CreateBadgeInput = Readonly<{
  name: string;
  label_html: string;
  color?: string;
  description?: string;
  sort_order?: number;
}>;

type UpdateBadgeInput = Readonly<{
  name?: string;
  label_html?: string;
  color?: string;
  description?: string | null;
  sort_order?: number;
}>;

export type MemberCatalogServiceOptions = Readonly<{
  store: MembersStore;
  media: MemberMediaPort;
  tagUsage: ClassTagUsageReader;
  generateId?: () => string;
}>;

export class MemberCatalogService {
  private readonly generateId: () => string;

  constructor(private readonly options: MemberCatalogServiceOptions) {
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  async listClasses(): Promise<readonly ClassCatalogItem[]> {
    const rows = await this.options.store.listClasses();
    const icons = await this.options.media.listClassIcons(rows.map((row) => row.id));
    return rows.map((row): ClassCatalogItem => row.icon_type === "image"
      ? {
          id: row.id, label: row.label, color: row.color, sort_order: row.sort_order,
          created_at: row.created_at, updated_at: row.updated_at,
          icon_type: "image", vector_icon: null,
          icon_media_id: icons.get(row.id) ?? this.missingClassIcon(row.id),
        }
      : {
          id: row.id, label: row.label, color: row.color, sort_order: row.sort_order,
          created_at: row.created_at, updated_at: row.updated_at,
          icon_type: "vector", vector_icon: row.vector_icon ?? this.missingVectorIcon(row.id),
          icon_media_id: null,
        });
  }

  async getClass(id: string): Promise<ClassCatalogItem> {
    const row = await this.options.store.findClass(id);
    if (!row) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Class not found" });
    const icon = (await this.options.media.listClassIcons([id])).get(id);
    return row.icon_type === "image"
      ? {
          id: row.id, label: row.label, color: row.color, sort_order: row.sort_order,
          created_at: row.created_at, updated_at: row.updated_at,
          icon_type: "image", vector_icon: null,
          icon_media_id: icon ?? this.missingClassIcon(id),
        }
      : {
          id: row.id, label: row.label, color: row.color, sort_order: row.sort_order,
          created_at: row.created_at, updated_at: row.updated_at,
          icon_type: "vector", vector_icon: row.vector_icon ?? this.missingVectorIcon(row.id),
          icon_media_id: null,
        };
  }

  async createClass(context: RequestContext, input: CreateClassCatalogItemInput): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const id = this.generateId();
    const outcome = await this.options.store.createClass({
      id,
      label: input.label,
      color: input.color,
      vectorIcon: input.vector_icon,
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: input.label,
      action: "create",
      context: [
        { field: "color", value: { type: "code", value: input.color } },
        { field: "icon", value: { type: "code", value: "vector" } },
        ...(input.sort_order === undefined ? [] : [{
          field: "sort_order" as const,
          value: { type: "number" as const, value: input.sort_order },
        }]),
      ],
    }));
    this.handleCatalogOutcome(outcome, "Class");
    return this.getClass(id);
  }

  async updateClass(context: RequestContext, id: string, input: UpdateClassCatalogItemInput): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.getClass(id);
    const changes: AuditChange[] = [];
    if (input.label !== undefined && input.label !== existing.label) changes.push({
      field: "label",
      before: { type: "text", value: existing.label },
      after: { type: "text", value: input.label },
    });
    if (input.color !== undefined && input.color !== existing.color) changes.push({
      field: "color",
      before: { type: "code", value: existing.color },
      after: { type: "code", value: input.color },
    });
    if (input.vector_icon !== undefined && input.vector_icon !== existing.vector_icon) changes.push({
      field: "icon",
      before: { type: "code", value: existing.vector_icon ?? existing.icon_type },
      after: { type: "code", value: input.vector_icon },
    });
    if (input.sort_order !== undefined && input.sort_order !== existing.sort_order) changes.push({
      field: "sort_order",
      before: { type: "number", value: existing.sort_order },
      after: { type: "number", value: input.sort_order },
    });
    if (changes.length === 0) return existing;
    const outcome = await this.options.store.updateClass(id, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.vector_icon === undefined ? {} : { vectorIcon: input.vector_icon }),
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: input.label ?? existing.label,
      action: "update",
      changes,
    }));
    this.handleCatalogOutcome(outcome, "Class");
    return this.getClass(id);
  }

  async reorderClasses(context: RequestContext, input: ReorderClassCatalogInput): Promise<readonly ClassCatalogItem[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.options.store.listClasses();
    if (input.order.length === existing.length
      && input.order.every((id, index) => id === existing[index]?.id)) return this.listClasses();
    const labels = new Map(existing.map((item) => [item.id, item.label]));
    if (input.order.length !== existing.length || input.order.some((id) => !labels.has(id))) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Class order is stale" });
    }
    const outcome = await this.options.store.reorderClasses(input.order, context.now, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: "catalog",
      subjectLabel: null,
      action: "reorder",
      changes: [orderChange(existing.map((item) => item.id), input.order, labels)],
    }));
    if (outcome === "stale_order") throw new AppError({ code: "CONFLICT", status: 409, message: "Class order is stale" });
    return this.listClasses();
  }

  async uploadClassIcon(context: RequestContext, id: string, upload: ImageUpload): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClass(id);
    await this.options.media.uploadClassIcon(context, id, upload, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: current.label,
      action: "upload_icon",
      context: [],
    }));
    return this.getClass(id);
  }

  async deleteClassIcon(context: RequestContext, id: string): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClass(id);
    if (current.icon_type !== "image") return current;
    await this.options.media.deleteClassIcon(context, id, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: current.label,
      action: "delete",
      context: [{ field: "icon", value: { type: "code", value: "image" } }],
    }));
    return this.getClass(id);
  }

  async deleteClass(context: RequestContext, id: string): Promise<{ deleted: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClass(id);
    const outcome = await this.options.store.deleteClass(id, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: current.label,
      action: "delete",
      context: [
        { field: "color", value: { type: "code", value: current.color } },
        { field: "icon", value: { type: "code", value: current.vector_icon ?? current.icon_type } },
        { field: "sort_order", value: { type: "number", value: current.sort_order } },
      ],
    }));
    if (outcome === "not_found") throw new AppError({ code: "NOT_FOUND", status: 404, message: "Class not found" });
    if (outcome === "referenced") throw new AppError({ code: "CONFLICT", status: 409, message: "Class is still referenced" });
    return { deleted: true };
  }

  async listClassTags(): Promise<readonly ClassTag[]> {
    const rows = await this.options.store.listClassTags();
    const usage = await this.options.tagUsage.countByTagIds(rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, usage_count: usage.get(row.id) ?? 0 }));
  }

  async createClassTag(context: RequestContext, input: CreateClassTagInput): Promise<ClassTag> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const classLabels = await this.classLabels(input.class_ids);
    const id = this.generateId();
    const outcome = await this.options.store.createClassTag({
      id,
      label: input.label,
      classIds: input.class_ids,
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "class_tag",
      subjectId: id,
      subjectLabel: input.label,
      action: "create",
      context: [{
        field: "class_ids",
        value: {
          type: "list",
          value: input.class_ids.map((classId) => ({
            type: "reference" as const,
            value: { id: classId, label: classLabels.get(classId) ?? null },
          })),
        },
      }],
    }));
    this.handleCatalogOutcome(outcome, "Class tag");
    return this.getClassTag(id);
  }

  async getClassTag(id: string): Promise<ClassTag> {
    const tag = await this.options.store.findClassTag(id);
    if (!tag) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Class tag not found" });
    const usage = await this.options.tagUsage.countByTagIds([id]);
    return { ...tag, usage_count: usage.get(id) ?? 0 };
  }

  async updateClassTag(context: RequestContext, id: string, input: UpdateClassTagInput): Promise<ClassTag> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.getClassTag(id);
    const classLabels = input.class_ids === undefined
      ? null
      : await this.classLabels([...existing.class_ids, ...input.class_ids]);
    const patch: {
      label?: string;
      classIds?: readonly string[];
      sortOrder?: number;
      now: string;
    } = { now: context.now };
    const changes: AuditChange[] = [];
    if (input.label !== undefined && input.label !== existing.label) {
      patch.label = input.label;
      changes.push({
        field: "label",
        before: { type: "text", value: existing.label },
        after: { type: "text", value: input.label },
      });
    }
    if (input.class_ids !== undefined) {
      const classIds = [...input.class_ids].sort();
      if (classIds.length !== existing.class_ids.length
        || classIds.some((classId, index) => classId !== existing.class_ids[index])) {
        patch.classIds = classIds;
        changes.push({
          field: "class_ids",
          before: auditReferences(existing.class_ids, classLabels!),
          after: auditReferences(classIds, classLabels!),
        });
      }
    }
    if (input.sort_order !== undefined && input.sort_order !== existing.sort_order) {
      patch.sortOrder = input.sort_order;
      changes.push({
        field: "sort_order",
        before: { type: "number", value: existing.sort_order },
        after: { type: "number", value: input.sort_order },
      });
    }
    if (changes.length === 0) return existing;
    const outcome = await this.options.store.updateClassTag(id, {
      ...patch,
    }, createAuditEvent(context, {
      subjectType: "class_tag",
      subjectId: id,
      subjectLabel: patch.label ?? existing.label,
      action: "update",
      changes,
    }));
    this.handleCatalogOutcome(outcome, "Class tag");
    return this.getClassTag(id);
  }

  async reorderClassTags(context: RequestContext, input: ReorderClassTagsInput): Promise<readonly ClassTag[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.listClassTags();
    if (input.order.length === existing.length
      && input.order.every((id, index) => id === existing[index]?.id)) return existing;
    const labels = new Map(existing.map((item) => [item.id, item.label]));
    if (input.order.length !== existing.length || input.order.some((id) => !labels.has(id))) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Class tag order is stale" });
    }
    const outcome = await this.options.store.reorderClassTags(input.order, context.now, createAuditEvent(context, {
      subjectType: "class_tag",
      subjectId: "catalog",
      subjectLabel: null,
      action: "reorder",
      changes: [orderChange(existing.map((item) => item.id), input.order, labels)],
    }));
    if (outcome === "stale_order") throw new AppError({ code: "CONFLICT", status: 409, message: "Class tag order is stale" });
    return this.listClassTags();
  }

  async deleteClassTag(context: RequestContext, id: string): Promise<{ deleted: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClassTag(id);
    if (!(await this.options.store.deleteClassTag(id, createAuditEvent(context, {
      subjectType: "class_tag",
      subjectId: id,
      subjectLabel: current.label,
      action: "delete",
      context: [
        { field: "class_ids", value: await this.auditClassReferences(current.class_ids) },
        { field: "sort_order", value: { type: "number", value: current.sort_order } },
      ],
    })))) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Class tag not found" });
    return { deleted: true };
  }

  listBadges(): Promise<readonly MemberBadge[]> {
    return this.options.store.listBadges();
  }

  async getBadge(id: string): Promise<MemberBadge> {
    const badge = await this.options.store.findBadge(id);
    if (!badge) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Badge not found" });
    return badge;
  }

  async createBadge(context: RequestContext, input: CreateBadgeInput): Promise<MemberBadge> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const id = this.generateId();
    const outcome = await this.options.store.createBadge({
      id,
      name: input.name,
      labelHtml: this.sanitizeBadgeHtml(input.label_html),
      color: input.color ?? "#3b82f6",
      description: input.description ?? null,
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "member_badge",
      subjectId: id,
      subjectLabel: input.name,
      action: "create",
      context: [
        { field: "color", value: { type: "code", value: input.color ?? "#3b82f6" } },
        ...(input.sort_order === undefined ? [] : [{
          field: "sort_order" as const,
          value: { type: "number" as const, value: input.sort_order },
        }]),
      ],
    }));
    this.handleCatalogOutcome(outcome, "Badge");
    return this.getBadge(id);
  }

  async updateBadge(context: RequestContext, id: string, input: UpdateBadgeInput): Promise<MemberBadge> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const existing = await this.getBadge(id);
    const labelHtml = input.label_html === undefined ? undefined : this.sanitizeBadgeHtml(input.label_html);
    const patch: {
      name?: string;
      labelHtml?: string;
      color?: string;
      description?: string | null;
      sortOrder?: number;
      now: string;
    } = { now: context.now };
    const changes: AuditChange[] = [];
    const changedSections: string[] = [];
    if (input.name !== undefined && input.name !== existing.name) {
      patch.name = input.name;
      changes.push({
        field: "name",
        before: { type: "text", value: existing.name },
        after: { type: "text", value: input.name },
      });
    }
    if (labelHtml !== undefined && labelHtml !== existing.label_html) {
      patch.labelHtml = labelHtml;
      changedSections.push("label_html");
    }
    if (input.color !== undefined && input.color !== existing.color) {
      patch.color = input.color;
      changes.push({
        field: "color",
        before: { type: "code", value: existing.color },
        after: { type: "code", value: input.color },
      });
    }
    if (input.description !== undefined && input.description !== existing.description) {
      patch.description = input.description;
      changes.push({
        field: "description",
        before: existing.description === null
          ? { type: "null", value: null }
          : { type: "text", value: existing.description },
        after: input.description === null
          ? { type: "null", value: null }
          : { type: "text", value: input.description },
      });
    }
    if (input.sort_order !== undefined && input.sort_order !== existing.sort_order) {
      patch.sortOrder = input.sort_order;
      changes.push({
        field: "sort_order",
        before: { type: "number", value: existing.sort_order },
        after: { type: "number", value: input.sort_order },
      });
    }
    if (changes.length === 0 && changedSections.length === 0) return existing;
    const outcome = await this.options.store.updateBadge(id, {
      ...patch,
    }, createAuditEvent(context, {
      subjectType: "member_badge",
      subjectId: id,
      subjectLabel: patch.name ?? existing.name,
      action: "update",
      changes,
      context: changedSections.length === 0 ? [] : [{
        field: "changed_sections",
        value: {
          type: "list",
          value: changedSections.map((value) => ({ type: "code" as const, value })),
        },
      }],
    }));
    this.handleCatalogOutcome(outcome, "Badge");
    return this.getBadge(id);
  }

  async reorderBadges(context: RequestContext, input: ReorderMemberBadgesInput): Promise<readonly MemberBadge[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const existing = await this.listBadges();
    if (input.order.length === existing.length
      && input.order.every((id, index) => id === existing[index]?.id)) return existing;
    const labels = new Map(existing.map((item) => [item.id, item.name]));
    if (input.order.length !== existing.length || input.order.some((id) => !labels.has(id))) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Badge order is stale" });
    }
    const outcome = await this.options.store.reorderBadges(input.order, context.now, createAuditEvent(context, {
      subjectType: "member_badge",
      subjectId: "catalog",
      subjectLabel: null,
      action: "reorder",
      changes: [orderChange(existing.map((item) => item.id), input.order, labels)],
    }));
    if (outcome === "stale_order") throw new AppError({ code: "CONFLICT", status: 409, message: "Badge order is stale" });
    return this.listBadges();
  }

  async deleteBadge(context: RequestContext, id: string): Promise<{ ok: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const current = await this.getBadge(id);
    if (!(await this.options.store.deleteBadge(id, createAuditEvent(context, {
      subjectType: "member_badge",
      subjectId: id,
      subjectLabel: current.name,
      action: "delete",
      context: [
        { field: "color", value: { type: "code", value: current.color } },
        { field: "description", value: current.description === null
          ? { type: "null", value: null }
          : { type: "text", value: current.description } },
        { field: "sort_order", value: { type: "number", value: current.sort_order } },
      ],
    })))) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Badge not found" });
    return { ok: true };
  }

  async listBadgeAssignments(
    context: RequestContext,
    badgeId: string,
    rawQuery: unknown,
  ): Promise<Readonly<{ data: readonly BadgeAssignmentRecord[]; next_cursor: string | null }>> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const parsed = badgeAssignmentsListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid badge assignment query" });
    }
    const page = await this.options.store.listBadgeAssignments(badgeId, {
      limit: parsed.data.limit,
      cursor: parsed.data.cursor ? decodeBadgeAssignmentCursor(parsed.data.cursor) : null,
    });
    const last = page.records.at(-1);
    return {
      data: page.records,
      next_cursor: page.hasMore && last
        ? encodeBadgeAssignmentCursor({ display_name: last.display_name, userId: last.userId })
        : null,
    };
  }

  async assignBadge(context: RequestContext, badgeId: string, userIds: readonly string[]) {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    this.assertBadgeAssignmentBatch(userIds);
    const badge = await this.getBadge(badgeId);
    const assigned = await this.options.store.assignBadge(
      badgeId,
      userIds,
      actor.userId,
      context.now,
      createAuditEvent(context, {
        subjectType: "member_badge",
        subjectId: badgeId,
        subjectLabel: badge.name,
        action: "assign",
        // The store appends the members it actually changed; a requested count here would contradict it.
      }),
    );
    return { assigned };
  }

  async unassignBadge(context: RequestContext, badgeId: string, userIds: readonly string[]) {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    this.assertBadgeAssignmentBatch(userIds);
    const badge = await this.getBadge(badgeId);
    const removed = await this.options.store.unassignBadge(badgeId, userIds, createAuditEvent(context, {
      subjectType: "member_badge",
      subjectId: badgeId,
      subjectLabel: badge.name,
      action: "unassign",
      // The store appends the members it actually changed; a requested count here would contradict it.
    }));
    return { removed };
  }

  private async classLabels(classIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const labels = new Map((await this.options.store.listClasses()).map((item) => [item.id, item.label]));
    const missing = [...new Set(classIds)].filter((id) => !labels.has(id));
    if (missing.length > 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Unknown classes",
        details: { class_ids: missing },
      });
    }
    return labels;
  }

  private async auditClassReferences(classIds: readonly string[]) {
    return auditReferences(classIds, await this.classLabels(classIds));
  }

  private handleCatalogOutcome(outcome: string, label: string): void {
    if (outcome === "not_found") throw new AppError({ code: "NOT_FOUND", status: 404, message: `${label} not found` });
    if (outcome === "conflict") throw new AppError({ code: "CONFLICT", status: 409, message: `${label} already exists` });
    if (outcome === "limit_reached") {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: `${label} limit reached` });
    }
  }

  private missingClassIcon(id: string): never {
    throw new AppError({ code: "SERVER_ERROR", status: 500, message: `Class ${id} image is missing` });
  }

  private missingVectorIcon(id: string): never {
    throw new AppError({ code: "SERVER_ERROR", status: 500, message: `Class ${id} vector icon is missing` });
  }

  private sanitizeBadgeHtml(html: string): string {
    const sanitized = sanitizeInlineHtml(html).trim();
    if (!sanitized) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Badge label must contain visible content" });
    }
    return sanitized;
  }

  private assertBadgeAssignmentBatch(userIds: readonly string[]): void {
    if (userIds.length < 1 || userIds.length > 100 || new Set(userIds).size !== userIds.length) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Badge assignments must contain 1 to 100 unique users",
      });
    }
  }
}

/** A new sequence only means anything beside the old one, so reordering travels as a single before/after change. */
function orderChange(
  previous: readonly string[],
  next: readonly string[],
  labels: ReadonlyMap<string, string>,
): AuditChange {
  return {
    field: "order",
    before: auditReferences(previous, labels),
    after: auditReferences(next, labels),
  };
}

function auditReferences(ids: readonly string[], labels: ReadonlyMap<string, string>) {
  return {
    type: "list" as const,
    value: ids.map((id) => ({ type: "reference" as const, value: { id, label: labels.get(id) ?? null } })),
  };
}

function encodeBadgeAssignmentCursor(cursor: BadgeAssignmentCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBadgeAssignmentCursor(value: string): BadgeAssignmentCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error();
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    )) as Partial<BadgeAssignmentCursor>;
    if (typeof parsed.display_name !== "string" || !parsed.display_name || parsed.display_name.length > 50
      || typeof parsed.userId !== "string" || !parsed.userId || parsed.userId.length > 128) throw new Error();
    return { display_name: parsed.display_name, userId: parsed.userId };
  } catch {
    throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid badge assignment cursor" });
  }
}
