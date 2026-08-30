import type {
  ClassCatalogItem,
  ClassTag,
  CatalogRevisionEntry,
  AuditChange,
  CreateClassCatalogItemInput,
  CreateClassTagInput,
  MemberBadge,
  ReorderClassCatalogInput,
  ReorderClassTagsInput,
  ReorderMemberBadgeCatalogInput,
  UpdateClassCatalogItemInput,
  UpdateClassTagInput,
} from "@guild/shared";
import { badgeAssignmentsListQuerySchema, catalogRevisionToken } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared";
import { AppError, type RequestContext } from "@guild/kernel";
import { createAuditEvent } from "../audit/public.js";
import type { ImageUpload } from "../media/public.js";
import type {
  BadgeAssignmentCursor,
  BadgeAssignmentRecord,
  CatalogCreateResult,
  ClassCatalogStoreRecord,
  ClassTagStoreRecord,
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
  expected_updated_at: string;
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
    return rows.map((row) => this.projectClass(row, icons.get(row.id) ?? null));
  }

  async getClass(id: string): Promise<ClassCatalogItem> {
    const row = await this.options.store.findClass(id);
    if (!row) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Class not found" });
    const icon = (await this.options.media.listClassIcons([id])).get(id) ?? null;
    return this.projectClass(row, icon);
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
    return this.projectClass(this.createdCatalogRecord(outcome, "Class"), null);
  }

  async updateClass(context: RequestContext, id: string, input: UpdateClassCatalogItemInput): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.getClass(id);
    if (input.expected_updated_at !== existing.updated_at) throw catalogConflict("Class changed since this editor was opened");
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
    const updatedAt = monotonicTimestamp(context.now, existing.updated_at);
    const outcome = await this.options.store.updateClass(id, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.vector_icon === undefined ? {} : { vectorIcon: input.vector_icon }),
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      expectedUpdatedAt: existing.updated_at,
      now: updatedAt,
    }, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: input.label ?? existing.label,
      action: "update",
      changes,
    }));
    if (outcome !== "updated") this.throwCatalogOutcome(outcome, "Class");
    return this.projectClass({
      id: existing.id,
      label: input.label ?? existing.label,
      color: input.color ?? existing.color,
      sort_order: input.sort_order ?? existing.sort_order,
      created_at: existing.created_at,
      updated_at: updatedAt,
      icon_type: input.vector_icon === undefined ? existing.icon_type : "vector",
      vector_icon: input.vector_icon === undefined ? existing.vector_icon : input.vector_icon,
    }, input.vector_icon === undefined && existing.icon_type === "image" ? existing.icon_media_id : null);
  }

  async reorderClasses(context: RequestContext, input: ReorderClassCatalogInput): Promise<readonly ClassCatalogItem[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.listClasses();
    if (input.expected_revision_token !== catalogRevisionToken(existing)) {
      throw catalogConflict("Class order is stale");
    }
    if (input.order.length === existing.length
      && input.order.every((id, index) => id === existing[index]?.id)) return this.listClasses();
    const labels = new Map(existing.map((item) => [item.id, item.label]));
    if (input.order.length !== existing.length || input.order.some((id) => !labels.has(id))) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Class order is stale" });
    }
    const next = reorderedCatalogEntries(existing, input.order, context.now);
    const outcome = await this.options.store.reorderClasses({
      order: input.order,
      expected: catalogEntries(existing),
      next,
    }, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: "catalog",
      subjectLabel: null,
      action: "reorder",
      changes: [orderChange(existing.map((item) => item.id), input.order, labels)],
    }));
    if (outcome === "stale_order") throw catalogConflict("Class order is stale");
    return reorderedCatalogSnapshot(existing, next);
  }

  async uploadClassIcon(
    context: RequestContext,
    id: string,
    upload: ImageUpload,
    expectedUpdatedAt: string,
  ): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClass(id);
    if (expectedUpdatedAt !== current.updated_at) throw catalogConflict("Class changed since this editor was opened");
    const snapshot = await this.options.media.uploadClassIcon(context, id, upload, {
      expectedUpdatedAt,
      updatedAt: monotonicTimestamp(context.now, current.updated_at),
    }, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: current.label,
      action: "upload_icon",
      context: [],
    }));
    return this.projectClass({
      id: current.id,
      label: current.label,
      color: current.color,
      sort_order: current.sort_order,
      created_at: current.created_at,
      updated_at: snapshot.updatedAt,
      icon_type: snapshot.iconType,
      vector_icon: snapshot.vectorIcon,
    }, snapshot.iconMediaId);
  }

  async deleteClassIcon(context: RequestContext, id: string, expectedUpdatedAt: string): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClass(id);
    if (expectedUpdatedAt !== current.updated_at) throw catalogConflict("Class changed since this editor was opened");
    if (current.icon_type !== "image") return current;
    const snapshot = await this.options.media.deleteClassIcon(context, id, {
      expectedUpdatedAt,
      updatedAt: monotonicTimestamp(context.now, current.updated_at),
    }, createAuditEvent(context, {
      subjectType: "class_catalog",
      subjectId: id,
      subjectLabel: current.label,
      action: "delete",
      context: [{ field: "icon", value: { type: "code", value: "image" } }],
    }));
    return this.projectClass({
      id: current.id,
      label: current.label,
      color: current.color,
      sort_order: current.sort_order,
      created_at: current.created_at,
      updated_at: snapshot.updatedAt,
      icon_type: snapshot.iconType,
      vector_icon: snapshot.vectorIcon,
    }, snapshot.iconMediaId);
  }

  async deleteClass(context: RequestContext, id: string, expectedUpdatedAt: string): Promise<{ deleted: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClass(id);
    if (expectedUpdatedAt !== current.updated_at) throw catalogConflict("Class changed since this editor was opened");
    const outcome = await this.options.store.deleteClass(id, expectedUpdatedAt, createAuditEvent(context, {
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
    if (outcome === "stale") throw catalogConflict("Class changed since this editor was opened");
    if (outcome === "referenced") throw new AppError({ code: "CONFLICT", status: 409, message: "Class is still referenced" });
    return { deleted: true };
  }

  async listClassTags(): Promise<readonly ClassTag[]> {
    const rows = await this.options.store.listClassTags();
    const usage = await this.options.tagUsage.countByTagIds(rows.map((row) => row.id));
    return rows.map((row) => this.projectClassTag(row, usage.get(row.id) ?? 0));
  }

  async createClassTag(context: RequestContext, input: CreateClassTagInput): Promise<ClassTag> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const classIds = [...input.class_ids].sort();
    const classLabels = await this.classLabels(classIds);
    const id = this.generateId();
    const outcome = await this.options.store.createClassTag({
      id,
      label: input.label,
      classIds,
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
          value: classIds.map((classId) => ({
            type: "reference" as const,
            value: { id: classId, label: classLabels.get(classId) ?? null },
          })),
        },
      }],
    }));
    return this.projectClassTag(this.createdCatalogRecord(outcome, "Class tag"), 0);
  }

  async getClassTag(id: string): Promise<ClassTag> {
    const tag = await this.options.store.findClassTag(id);
    if (!tag) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Class tag not found" });
    const usage = await this.options.tagUsage.countByTagIds([id]);
    return this.projectClassTag(tag, usage.get(id) ?? 0);
  }

  async updateClassTag(context: RequestContext, id: string, input: UpdateClassTagInput): Promise<ClassTag> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.getClassTag(id);
    if (input.expected_updated_at !== existing.updated_at) throw catalogConflict("Class tag changed since this editor was opened");
    const classLabels = input.class_ids === undefined
      ? null
      : await this.classLabels([...existing.class_ids, ...input.class_ids]);
    const patch: {
      label?: string;
      classIds?: readonly string[];
      sortOrder?: number;
      expectedUpdatedAt: string;
      now: string;
    } = {
      expectedUpdatedAt: existing.updated_at,
      now: monotonicTimestamp(context.now, existing.updated_at),
    };
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
    if (outcome !== "updated") this.throwCatalogOutcome(outcome, "Class tag");
    return this.projectClassTag({
      id: existing.id,
      label: patch.label ?? existing.label,
      class_ids: [...(patch.classIds ?? existing.class_ids)],
      sort_order: patch.sortOrder ?? existing.sort_order,
      created_at: existing.created_at,
      updated_at: patch.now,
    }, existing.usage_count);
  }

  async reorderClassTags(context: RequestContext, input: ReorderClassTagsInput): Promise<readonly ClassTag[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const existing = await this.listClassTags();
    if (input.expected_revision_token !== catalogRevisionToken(existing)) {
      throw catalogConflict("Class tag order is stale");
    }
    if (input.order.length === existing.length
      && input.order.every((id, index) => id === existing[index]?.id)) return this.listClassTags();
    const labels = new Map(existing.map((item) => [item.id, item.label]));
    if (input.order.length !== existing.length || input.order.some((id) => !labels.has(id))) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Class tag order is stale" });
    }
    const next = reorderedCatalogEntries(existing, input.order, context.now);
    const outcome = await this.options.store.reorderClassTags({
      order: input.order,
      expected: catalogEntries(existing),
      next,
    }, createAuditEvent(context, {
      subjectType: "class_tag",
      subjectId: "catalog",
      subjectLabel: null,
      action: "reorder",
      changes: [orderChange(existing.map((item) => item.id), input.order, labels)],
    }));
    if (outcome === "stale_order") throw catalogConflict("Class tag order is stale");
    return reorderedCatalogSnapshot(existing, next);
  }

  async deleteClassTag(
    context: RequestContext,
    id: string,
    expectedUpdatedAt: string,
    expectedUsageCount: number,
  ): Promise<{ deleted: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClassTag(id);
    if (expectedUpdatedAt !== current.updated_at) throw catalogConflict("Class tag changed since this editor was opened");
    if (expectedUsageCount !== current.usage_count) throw catalogConflict("Class tag usage changed since this confirmation was opened");
    const outcome = await this.options.store.deleteClassTag(id, expectedUpdatedAt, expectedUsageCount, createAuditEvent(context, {
      subjectType: "class_tag",
      subjectId: id,
      subjectLabel: current.label,
      action: "delete",
      context: [
        { field: "class_ids", value: await this.auditClassReferences(current.class_ids) },
        { field: "sort_order", value: { type: "number", value: current.sort_order } },
      ],
    }));
    if (outcome === "not_found") throw new AppError({ code: "NOT_FOUND", status: 404, message: "Class tag not found" });
    if (outcome === "stale") throw catalogConflict("Class tag changed since this editor was opened");
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
    return this.createdCatalogRecord(outcome, "Badge");
  }

  async updateBadge(context: RequestContext, id: string, input: UpdateBadgeInput): Promise<MemberBadge> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const existing = await this.getBadge(id);
    if (input.expected_updated_at !== existing.updated_at) throw catalogConflict("Badge changed since this editor was opened");
    const labelHtml = input.label_html === undefined ? undefined : this.sanitizeBadgeHtml(input.label_html);
    const patch: {
      name?: string;
      labelHtml?: string;
      color?: string;
      description?: string | null;
      sortOrder?: number;
      expectedUpdatedAt: string;
      now: string;
    } = {
      expectedUpdatedAt: existing.updated_at,
      now: monotonicTimestamp(context.now, existing.updated_at),
    };
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
    if (outcome !== "updated") this.throwCatalogOutcome(outcome, "Badge");
    return {
      id: existing.id,
      name: patch.name ?? existing.name,
      label_html: patch.labelHtml ?? existing.label_html,
      color: patch.color ?? existing.color,
      description: patch.description === undefined ? existing.description : patch.description,
      sort_order: patch.sortOrder ?? existing.sort_order,
      created_at: existing.created_at,
      updated_at: patch.now,
    };
  }

  async reorderBadges(context: RequestContext, input: ReorderMemberBadgeCatalogInput): Promise<readonly MemberBadge[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const existing = await this.listBadges();
    if (input.expected_revision_token !== catalogRevisionToken(existing)) {
      throw catalogConflict("Badge order is stale");
    }
    if (input.order.length === existing.length
      && input.order.every((id, index) => id === existing[index]?.id)) return existing;
    const labels = new Map(existing.map((item) => [item.id, item.name]));
    if (input.order.length !== existing.length || input.order.some((id) => !labels.has(id))) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Badge order is stale" });
    }
    const next = reorderedCatalogEntries(existing, input.order, context.now);
    const outcome = await this.options.store.reorderBadges({
      order: input.order,
      expected: catalogEntries(existing),
      next,
    }, createAuditEvent(context, {
      subjectType: "member_badge",
      subjectId: "catalog",
      subjectLabel: null,
      action: "reorder",
      changes: [orderChange(existing.map((item) => item.id), input.order, labels)],
    }));
    if (outcome === "stale_order") throw catalogConflict("Badge order is stale");
    return reorderedCatalogSnapshot(existing, next);
  }

  async deleteBadge(context: RequestContext, id: string, expectedUpdatedAt: string): Promise<{ ok: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const current = await this.getBadge(id);
    if (expectedUpdatedAt !== current.updated_at) throw catalogConflict("Badge changed since this editor was opened");
    const outcome = await this.options.store.deleteBadge(id, expectedUpdatedAt, createAuditEvent(context, {
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
    }));
    if (outcome === "not_found") throw new AppError({ code: "NOT_FOUND", status: 404, message: "Badge not found" });
    if (outcome === "stale") throw catalogConflict("Badge changed since this editor was opened");
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
    const outcome = await this.options.store.assignBadge(
      badgeId,
      userIds,
      actor.userId,
      monotonicTimestamp(context.now, badge.updated_at),
      createAuditEvent(context, {
        subjectType: "member_badge",
        subjectId: badgeId,
        subjectLabel: badge.name,
        action: "assign",
        // The store appends the members it actually changed; a requested count here would contradict it.
      }),
    );
    if (outcome.updatedAt === null) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Badge not found" });
    return { assigned: outcome.changed, updated_at: outcome.updatedAt };
  }

  async unassignBadge(context: RequestContext, badgeId: string, userIds: readonly string[]) {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    this.assertBadgeAssignmentBatch(userIds);
    const badge = await this.getBadge(badgeId);
    const outcome = await this.options.store.unassignBadge(badgeId, userIds, monotonicTimestamp(context.now, badge.updated_at), createAuditEvent(context, {
      subjectType: "member_badge",
      subjectId: badgeId,
      subjectLabel: badge.name,
      action: "unassign",
      // The store appends the members it actually changed; a requested count here would contradict it.
    }));
    if (outcome.updatedAt === null) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Badge not found" });
    return { removed: outcome.changed, updated_at: outcome.updatedAt };
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

  private projectClass(row: ClassCatalogStoreRecord, iconMediaId: string | null): ClassCatalogItem {
    if (row.icon_type === "image") {
      return {
        id: row.id, label: row.label, color: row.color, sort_order: row.sort_order,
        created_at: row.created_at, updated_at: row.updated_at,
        icon_type: "image", vector_icon: null,
        icon_media_id: iconMediaId ?? this.missingClassIcon(row.id),
      };
    }
    return {
      id: row.id, label: row.label, color: row.color, sort_order: row.sort_order,
      created_at: row.created_at, updated_at: row.updated_at,
      icon_type: "vector", vector_icon: row.vector_icon ?? this.missingVectorIcon(row.id),
      icon_media_id: null,
    };
  }

  private projectClassTag(row: ClassTagStoreRecord, usageCount: number): ClassTag {
    return { ...row, usage_count: usageCount };
  }

  private createdCatalogRecord<TRecord>(outcome: CatalogCreateResult<TRecord>, label: string): TRecord {
    if (outcome.outcome === "created") return outcome.record;
    return this.throwCatalogOutcome(outcome.outcome, label);
  }

  private throwCatalogOutcome(outcome: string, label: string): never {
    if (outcome === "not_found") throw new AppError({ code: "NOT_FOUND", status: 404, message: `${label} not found` });
    if (outcome === "conflict") throw new AppError({ code: "CONFLICT", status: 409, message: `${label} already exists` });
    if (outcome === "stale") throw catalogConflict(`${label} changed since this editor was opened`);
    if (outcome === "limit_reached") {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: `${label} limit reached` });
    }
    throw new AppError({ code: "SERVER_ERROR", status: 500, message: `Unknown ${label} mutation outcome` });
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

function catalogEntries(entries: readonly CatalogRevisionEntry[]): CatalogRevisionEntry[] {
  return entries.map(({ id, sort_order, updated_at }) => ({ id, sort_order, updated_at }));
}

function reorderedCatalogSnapshot<T extends CatalogRevisionEntry>(
  existing: readonly T[],
  revisions: readonly CatalogRevisionEntry[],
): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  return revisions.map((revision) => ({ ...byId.get(revision.id)!, ...revision }));
}

function reorderedCatalogEntries(
  existing: readonly CatalogRevisionEntry[],
  order: readonly string[],
  now: string,
): CatalogRevisionEntry[] {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  return order.map((id, index) => {
    const current = byId.get(id);
    if (!current) throw catalogConflict("Catalog order is stale");
    const sort_order = index * 10;
    return {
      id,
      sort_order,
      updated_at: sort_order === current.sort_order
        ? current.updated_at
        : monotonicTimestamp(now, current.updated_at),
    };
  });
}

function monotonicTimestamp(now: string, previous: string): string {
  const nowMs = Date.parse(now);
  const previousMs = Date.parse(previous);
  if (!Number.isFinite(nowMs) || !Number.isFinite(previousMs)) return now;
  return new Date(Math.max(nowMs, previousMs + 1)).toISOString();
}

function catalogConflict(message: string): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message });
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
