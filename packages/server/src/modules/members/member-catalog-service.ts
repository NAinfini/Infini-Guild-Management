import type {
  ClassCatalogItem,
  ClassTag,
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
import { createAuditMutation } from "../audit/public.js";
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
  description?: string;
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
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const id = this.generateId();
    const outcome = await this.options.store.createClass({
      id,
      label: input.label,
      color: input.color,
      vectorIcon: input.vector_icon,
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditMutation(context, {
      entityType: "class_catalog",
      entityId: id,
      action: "create",
      summary: input.label,
      details: { actor_id: actor.userId },
    }));
    this.handleCatalogOutcome(outcome, "Class");
    return this.getClass(id);
  }

  async updateClass(context: RequestContext, id: string, input: UpdateClassCatalogItemInput): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const outcome = await this.options.store.updateClass(id, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.vector_icon === undefined ? {} : { vectorIcon: input.vector_icon }),
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditMutation(context, {
      entityType: "class_catalog",
      entityId: id,
      action: "update",
      summary: input.label ?? id,
    }));
    this.handleCatalogOutcome(outcome, "Class");
    return this.getClass(id);
  }

  async reorderClasses(context: RequestContext, input: ReorderClassCatalogInput): Promise<readonly ClassCatalogItem[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const outcome = await this.options.store.reorderClasses(input.order, context.now, createAuditMutation(context, {
      entityType: "class_catalog",
      entityId: "catalog",
      action: "update",
      summary: "Class order",
      details: { order: input.order },
    }));
    if (outcome === "stale_order") throw new AppError({ code: "CONFLICT", status: 409, message: "Class order is stale" });
    return this.listClasses();
  }

  async uploadClassIcon(context: RequestContext, id: string, upload: ImageUpload): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    await this.getClass(id);
    await this.options.media.uploadClassIcon(context, id, upload, createAuditMutation(context, {
      entityType: "class_catalog",
      entityId: id,
      action: "upload_icon",
      summary: id,
    }));
    return this.getClass(id);
  }

  async deleteClassIcon(context: RequestContext, id: string): Promise<ClassCatalogItem> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const current = await this.getClass(id);
    if (current.icon_type !== "image") return current;
    await this.options.media.deleteClassIcon(context, id, createAuditMutation(context, {
      entityType: "class_catalog",
      entityId: id,
      action: "delete",
      summary: "Class icon",
    }));
    return this.getClass(id);
  }

  async deleteClass(context: RequestContext, id: string): Promise<{ deleted: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const outcome = await this.options.store.deleteClass(id, createAuditMutation(context, {
      entityType: "class_catalog",
      entityId: id,
      action: "delete",
      summary: id,
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
    await this.assertClassesExist(input.class_ids);
    const id = this.generateId();
    const outcome = await this.options.store.createClassTag({
      id,
      label: input.label,
      classIds: input.class_ids,
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditMutation(context, {
      entityType: "class_tag",
      entityId: id,
      action: "create",
      summary: input.label,
      details: { class_ids: input.class_ids },
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
    if (input.class_ids) await this.assertClassesExist(input.class_ids);
    const outcome = await this.options.store.updateClassTag(id, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.class_ids === undefined ? {} : { classIds: input.class_ids }),
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditMutation(context, {
      entityType: "class_tag",
      entityId: id,
      action: "update",
      summary: input.label ?? id,
    }));
    this.handleCatalogOutcome(outcome, "Class tag");
    return this.getClassTag(id);
  }

  async reorderClassTags(context: RequestContext, input: ReorderClassTagsInput): Promise<readonly ClassTag[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const outcome = await this.options.store.reorderClassTags(input.order, context.now, createAuditMutation(context, {
      entityType: "class_tag",
      entityId: "catalog",
      action: "update",
      summary: "Class tag order",
      details: { order: input.order },
    }));
    if (outcome === "stale_order") throw new AppError({ code: "CONFLICT", status: 409, message: "Class tag order is stale" });
    return this.listClassTags();
  }

  async deleteClassTag(context: RequestContext, id: string): Promise<{ deleted: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    if (!(await this.options.store.deleteClassTag(id, createAuditMutation(context, {
      entityType: "class_tag",
      entityId: id,
      action: "delete",
      summary: id,
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
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const id = this.generateId();
    const outcome = await this.options.store.createBadge({
      id,
      name: input.name,
      labelHtml: this.sanitizeBadgeHtml(input.label_html),
      color: input.color ?? "#3b82f6",
      description: input.description ?? null,
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditMutation(context, {
      entityType: "member_badge",
      entityId: id,
      action: "create",
      summary: input.name,
      details: { actor_id: actor.userId },
    }));
    this.handleCatalogOutcome(outcome, "Badge");
    return this.getBadge(id);
  }

  async updateBadge(context: RequestContext, id: string, input: UpdateBadgeInput): Promise<MemberBadge> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const outcome = await this.options.store.updateBadge(id, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.label_html === undefined ? {} : { labelHtml: this.sanitizeBadgeHtml(input.label_html) }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      now: context.now,
    }, createAuditMutation(context, {
      entityType: "member_badge",
      entityId: id,
      action: "update",
      summary: input.name ?? id,
    }));
    this.handleCatalogOutcome(outcome, "Badge");
    return this.getBadge(id);
  }

  async reorderBadges(context: RequestContext, input: ReorderMemberBadgesInput): Promise<readonly MemberBadge[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    const outcome = await this.options.store.reorderBadges(input.order, context.now, createAuditMutation(context, {
      entityType: "member_badge",
      entityId: "catalog",
      action: "update",
      summary: "Badge order",
      details: { order: input.order },
    }));
    if (outcome === "stale_order") throw new AppError({ code: "CONFLICT", status: 409, message: "Badge order is stale" });
    return this.listBadges();
  }

  async deleteBadge(context: RequestContext, id: string): Promise<{ ok: true }> {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    if (!(await this.options.store.deleteBadge(id, createAuditMutation(context, {
      entityType: "member_badge",
      entityId: id,
      action: "delete",
      summary: id,
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
        ? encodeBadgeAssignmentCursor({ username: last.username, userId: last.userId })
        : null,
    };
  }

  async assignBadge(context: RequestContext, badgeId: string, userIds: readonly string[]) {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    this.assertBadgeAssignmentBatch(userIds);
    await this.getBadge(badgeId);
    const assigned = await this.options.store.assignBadge(
      badgeId,
      userIds,
      actor.userId,
      context.now,
      createAuditMutation(context, {
        entityType: "member_badge",
        entityId: badgeId,
        action: "assign",
        summary: badgeId,
        details: { user_ids: [...userIds] },
      }),
    );
    return { assigned };
  }

  async unassignBadge(context: RequestContext, badgeId: string, userIds: readonly string[]) {
    context.authorization.require(PERMISSION_ID.ADMIN_BADGES_MANAGE);
    this.assertBadgeAssignmentBatch(userIds);
    await this.getBadge(badgeId);
    const removed = await this.options.store.unassignBadge(badgeId, userIds, createAuditMutation(context, {
      entityType: "member_badge",
      entityId: badgeId,
      action: "unassign",
      summary: badgeId,
      details: { user_ids: [...userIds] },
    }));
    return { removed };
  }

  private async assertClassesExist(classIds: readonly string[]): Promise<void> {
    const missing = await this.options.store.findMissingClassIds(classIds);
    if (missing.length > 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Unknown classes",
        details: { class_ids: missing },
      });
    }
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
    if (typeof parsed.username !== "string" || !parsed.username || parsed.username.length > 50
      || typeof parsed.userId !== "string" || !parsed.userId || parsed.userId.length > 128) throw new Error();
    return { username: parsed.username, userId: parsed.userId };
  } catch {
    throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid badge assignment cursor" });
  }
}
