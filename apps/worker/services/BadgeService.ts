import { memberBadgeSchema, type JsonValue } from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { users } from "../db/schema/auth";
import { memberBadgeAssignments, memberBadges } from "../db/schema";
import { sanitizeInlineHtml } from "./inline-html";
import { ok, err, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };

export type BadgeServiceDeps = {
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  /* 整表重排要在一次 batch 里改完所有行，drizzle 的 update 一次只发一条。 */
  rawDb: D1Database;
};

type BadgeRow = {
  id: string;
  name: string;
  labelHtml: string;
  color: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const BADGE_COLS = {
  id: memberBadges.id,
  name: memberBadges.name,
  labelHtml: memberBadges.labelHtml,
  color: memberBadges.color,
  description: memberBadges.description,
  sortOrder: memberBadges.sortOrder,
  createdAt: memberBadges.createdAt,
  updatedAt: memberBadges.updatedAt,
} as const;

const DEFAULT_BADGE_COLOR = "#3b82f6";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

function hasVisibleBadgeLabelContent(html: string): boolean {
  return html.replace(/<br>/g, "").replace(/<[^>]+>/g, "").trim().length > 0;
}

function normalizeBadgeColor(color?: string): string {
  return color && HEX_COLOR_PATTERN.test(color) ? color : DEFAULT_BADGE_COLOR;
}

function sanitizeBadgeCreateInput(data: { name: string; label_html: string; color?: string; description?: string; sort_order?: number }) {
  const labelHtml = sanitizeInlineHtml(data.label_html).trim();
  if (!hasVisibleBadgeLabelContent(labelHtml)) {
    return err("VALIDATION_ERROR", "Badge label must contain visible allowed content");
  }
  return ok({
    ...data,
    label_html: labelHtml,
    color: normalizeBadgeColor(data.color),
  });
}

function sanitizeBadgeUpdateInput(data: { name?: string; label_html?: string; color?: string; description?: string; sort_order?: number }) {
  const patch = { ...data };
  if (data.label_html !== undefined) {
    const labelHtml = sanitizeInlineHtml(data.label_html).trim();
    if (!hasVisibleBadgeLabelContent(labelHtml)) {
      return err("VALIDATION_ERROR", "Badge label must contain visible allowed content");
    }
    patch.label_html = labelHtml;
  }
  if (data.color !== undefined) {
    patch.color = normalizeBadgeColor(data.color);
  }
  return ok(patch);
}

function buildBadgeDiff(
  existing: BadgeRow,
  data: { name?: string; label_html?: string; color?: string; description?: string; sort_order?: number },
): Record<string, { from: JsonValue; to: JsonValue }> | null {
  const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
  if (data.name !== undefined && data.name !== existing.name) diff.name = { from: existing.name, to: data.name };
  if (data.label_html !== undefined && data.label_html !== existing.labelHtml) diff.label_html = { from: existing.labelHtml, to: data.label_html };
  if (data.color !== undefined && data.color !== existing.color) diff.color = { from: existing.color, to: data.color };
  if (data.description !== undefined && (data.description ?? null) !== existing.description) diff.description = { from: existing.description, to: data.description ?? null };
  if (data.sort_order !== undefined && data.sort_order !== existing.sortOrder) diff.sort_order = { from: existing.sortOrder, to: data.sort_order };
  return Object.keys(diff).length > 0 ? diff : null;
}

function toBadgePayload(row: BadgeRow) {
  return memberBadgeSchema.parse({
    id: row.id,
    name: row.name,
    label_html: row.labelHtml,
    color: row.color,
    description: row.description,
    sort_order: row.sortOrder,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

export class BadgeService {
  private db: DrizzleDb;
  private deps: BadgeServiceDeps;

  constructor(db: DrizzleDb, deps: BadgeServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  async listBadges(): Promise<ServiceResult<unknown[]>> {
    const rows = await this.db.select(BADGE_COLS).from(memberBadges).orderBy(asc(memberBadges.sortOrder), asc(memberBadges.id));
    return ok(rows.map(toBadgePayload));
  }

  async getBadge(badgeId: string): Promise<ServiceResult<unknown>> {
    const row = (await this.db.select(BADGE_COLS).from(memberBadges).where(eq(memberBadges.id, badgeId)).limit(1))[0];
    if (!row) return err("NOT_FOUND", "Badge not found");
    return ok(toBadgePayload(row));
  }

  async createBadge(actorId: string, data: { name: string; label_html: string; color?: string; description?: string; sort_order?: number }): Promise<ServiceResult<unknown>> {
    const sanitized = sanitizeBadgeCreateInput(data);
    if (!sanitized.ok) return sanitized;
    const safeData = sanitized.data;
    const badgeId = nanoid();
    /* 不指定顺序就排到末尾：拖拽序里「新建的在最后」，插到队首会跟已有的号段撞上。 */
    const maxSortRow = (await this.db.select({ value: max(memberBadges.sortOrder) }).from(memberBadges))[0];
    await this.db.insert(memberBadges).values({
      id: badgeId,
      name: safeData.name,
      labelHtml: safeData.label_html,
      color: safeData.color,
      description: safeData.description ?? null,
      sortOrder: safeData.sort_order ?? Number(maxSortRow?.value ?? -10) + 10,
    });
    const created = (await this.db.select(BADGE_COLS).from(memberBadges).where(eq(memberBadges.id, badgeId)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create badge");
    await this.deps.writeAuditLog({ entityType: "member_badge", action: "create", actorId, entityId: badgeId, diffTitle: safeData.name });
    return ok(toBadgePayload(created));
  }

  async updateBadge(actorId: string, badgeId: string, data: { name?: string; label_html?: string; color?: string; description?: string; sort_order?: number }): Promise<ServiceResult<unknown>> {
    const existing = (await this.db.select(BADGE_COLS).from(memberBadges).where(eq(memberBadges.id, badgeId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Badge not found");
    const sanitized = sanitizeBadgeUpdateInput(data);
    if (!sanitized.ok) return sanitized;
    const safeData = sanitized.data;

    const patch: Partial<typeof memberBadges.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (safeData.name !== undefined) patch.name = safeData.name;
    if (safeData.label_html !== undefined) patch.labelHtml = safeData.label_html;
    if (safeData.color !== undefined) patch.color = safeData.color;
    if (safeData.description !== undefined) patch.description = safeData.description;
    if (safeData.sort_order !== undefined) patch.sortOrder = safeData.sort_order;

    await this.db.update(memberBadges).set(patch).where(eq(memberBadges.id, badgeId));
    const updated = (await this.db.select(BADGE_COLS).from(memberBadges).where(eq(memberBadges.id, badgeId)).limit(1))[0];
    if (!updated) return err("SERVER_ERROR", "Failed to load updated badge");
    const diff = buildBadgeDiff(existing, safeData);
    await this.deps.writeAuditLog({ entityType: "member_badge", action: "update", actorId, entityId: badgeId, diffTitle: updated.name, detail: diff });
    return ok(toBadgePayload(updated));
  }

  /*
   * 整表重排，和 ClassCatalogService.reorder 一模一样的形状：请求体必须列全所有
   * 徽章，服务端按下标 * 10 重写。少一个就拒绝——顺序是全序，收下半张表就得去猜
   * 剩下那些排在哪，而猜出来的结果客户端看不见。
   */
  async reorderBadges(actorId: string, order: string[]): Promise<ServiceResult<unknown[]>> {
    const existingIds = (await this.db.select({ id: memberBadges.id }).from(memberBadges)).map((row) => row.id);

    if (existingIds.length !== order.length) {
      return err(
        "CONFLICT",
        `Badge order must list all ${existingIds.length} badges; received ${order.length}`,
      );
    }
    const submitted = new Set(order);
    const missing = existingIds.filter((id) => !submitted.has(id));
    if (missing.length > 0) {
      return err("CONFLICT", `Badge order is missing ${missing.length} badge(s)`);
    }

    const updatedAt = new Date().toISOString();
    await this.deps.rawDb.batch(
      order.map((id, index) => this.deps.rawDb
        .prepare("UPDATE member_badges SET sort_order = ?, updated_at = ? WHERE id = ?")
        .bind(index * 10, updatedAt, id)),
    );
    /* entityId 用 "batch"：这次改的是整张表，不是某一行。 */
    await this.deps.writeAuditLog({
      entityType: "member_badge",
      action: "batch_update",
      actorId,
      entityId: "batch",
      diffTitle: `${order.length} badges reordered`,
      detail: { count: order.length, order },
    });
    return this.listBadges();
  }

  async deleteBadge(actorId: string, badgeId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = (await this.db.select(BADGE_COLS).from(memberBadges).where(eq(memberBadges.id, badgeId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Badge not found");
    await this.db.delete(memberBadges).where(eq(memberBadges.id, badgeId));
    await this.deps.writeAuditLog({ entityType: "member_badge", action: "delete", actorId, entityId: badgeId, diffTitle: existing.name });
    return ok({ ok: true });
  }

  async assignBadge(actorId: string, badgeId: string, userIds: string[]): Promise<ServiceResult<{ assigned: number }>> {
    const existing = (await this.db.select(BADGE_COLS).from(memberBadges).where(eq(memberBadges.id, badgeId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Badge not found");
    if (userIds.length === 0) return ok({ assigned: 0 });

    const alreadyAssigned = await this.db
      .select({ userId: memberBadgeAssignments.userId })
      .from(memberBadgeAssignments)
      .where(and(eq(memberBadgeAssignments.badgeId, badgeId), inArray(memberBadgeAssignments.userId, userIds)));
    const existingSet = new Set(alreadyAssigned.map((r) => r.userId));
    const toInsert = userIds.filter((id) => !existingSet.has(id));

    if (toInsert.length > 0) {
      await this.db.insert(memberBadgeAssignments).values(
        toInsert.map((userId) => ({ badgeId, userId, assignedBy: actorId })),
      );
      await this.deps.writeAuditLog({
        entityType: "member_badge",
        action: "assign",
        actorId,
        entityId: badgeId,
        diffTitle: existing.name,
        detail: { user_ids: userIds, assigned: toInsert.length },
      });
      await this.deps.publishEntityChanged({ entityType: "member_badge", entityId: badgeId, hint: "badge_assigned" });
    }
    return ok({ assigned: toInsert.length });
  }

  async unassignBadge(actorId: string, badgeId: string, userIds: string[]): Promise<ServiceResult<{ removed: number }>> {
    const existing = (await this.db.select(BADGE_COLS).from(memberBadges).where(eq(memberBadges.id, badgeId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Badge not found");
    if (userIds.length === 0) return ok({ removed: 0 });

    const rowsToRemove = await this.db
      .select({ userId: memberBadgeAssignments.userId })
      .from(memberBadgeAssignments)
      .where(and(eq(memberBadgeAssignments.badgeId, badgeId), inArray(memberBadgeAssignments.userId, userIds)));
    const removeUserIds = rowsToRemove.map((row) => row.userId);

    if (removeUserIds.length === 0) return ok({ removed: 0 });

    await this.db
      .delete(memberBadgeAssignments)
      .where(and(eq(memberBadgeAssignments.badgeId, badgeId), inArray(memberBadgeAssignments.userId, removeUserIds)));
    const removed = removeUserIds.length;

    if (removed > 0) {
      await this.deps.writeAuditLog({
        entityType: "member_badge",
        action: "unassign",
        actorId,
        entityId: badgeId,
        diffTitle: existing.name,
        detail: { user_ids: removeUserIds, removed },
      });
      await this.deps.publishEntityChanged({ entityType: "member_badge", entityId: badgeId, hint: "badge_unassigned" });
    }
    return ok({ removed });
  }

  async listBadgeAssignments(badgeId: string): Promise<ServiceResult<unknown[]>> {
    const rows = await this.db
      .select({
        badgeId: memberBadgeAssignments.badgeId,
        userId: memberBadgeAssignments.userId,
        assignedBy: memberBadgeAssignments.assignedBy,
        assignedAt: memberBadgeAssignments.assignedAt,
      })
      .from(memberBadgeAssignments)
      .where(eq(memberBadgeAssignments.badgeId, badgeId));

    if (rows.length === 0) return ok([]);

    const allUserIds = [...new Set(rows.flatMap((r) => [r.userId, r.assignedBy]))];
    const userRows = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, allUserIds));
    const usernameMap = new Map(userRows.map((u) => [u.id, u.username]));

    return ok(rows.map((r) => ({
      badge_id: r.badgeId,
      user_id: r.userId,
      username: usernameMap.get(r.userId) ?? null,
      assigned_by: r.assignedBy,
      assigned_by_username: usernameMap.get(r.assignedBy) ?? null,
      assigned_at: r.assignedAt,
    })));
  }

  async getUserBadges(userId: string): Promise<{ id: string; name: string; label_html: string; color: string }[]> {
    const rows = await this.db
      .select({
        id: memberBadges.id,
        name: memberBadges.name,
        labelHtml: memberBadges.labelHtml,
        color: memberBadges.color,
      })
      .from(memberBadgeAssignments)
      .innerJoin(memberBadges, eq(memberBadgeAssignments.badgeId, memberBadges.id))
      .where(eq(memberBadgeAssignments.userId, userId))
      .orderBy(asc(memberBadges.sortOrder), asc(memberBadges.id));

    return rows.map((r) => ({ id: r.id, name: r.name, label_html: r.labelHtml, color: r.color }));
  }

  async getBulkUserBadges(userIds: string[]): Promise<Map<string, { id: string; name: string; label_html: string; color: string }[]>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        userId: memberBadgeAssignments.userId,
        id: memberBadges.id,
        name: memberBadges.name,
        labelHtml: memberBadges.labelHtml,
        color: memberBadges.color,
      })
      .from(memberBadgeAssignments)
      .innerJoin(memberBadges, eq(memberBadgeAssignments.badgeId, memberBadges.id))
      .where(inArray(memberBadgeAssignments.userId, userIds))
      .orderBy(asc(memberBadges.sortOrder), asc(memberBadges.id));

    const result = new Map<string, { id: string; name: string; label_html: string; color: string }[]>();
    for (const r of rows) {
      const list = result.get(r.userId) ?? [];
      list.push({ id: r.id, name: r.name, label_html: r.labelHtml, color: r.color });
      result.set(r.userId, list);
    }
    return result;
  }
}
