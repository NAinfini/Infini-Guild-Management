import { memberBadgeSchema } from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { users } from "../db/schema/auth";
import { memberBadgeAssignments, memberBadges } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };

export type BadgeServiceDeps = {
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
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
const ALLOWED_INLINE_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "br"]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeBadgeLabelHtml(html: string): string {
  const withoutBlockedElements = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  let output = "";
  const tokenPattern = /<[^>]*>/g;
  let lastIndex = 0;

  for (const match of withoutBlockedElements.matchAll(tokenPattern)) {
    output += escapeHtml(withoutBlockedElements.slice(lastIndex, match.index));
    const rawTag = match[0];
    const tagMatch = /^<\/?\s*([a-zA-Z0-9-]+)([^>]*)>$/.exec(rawTag);
    if (tagMatch) {
      const tag = tagMatch[1]!.toLowerCase();
      if (ALLOWED_INLINE_TAGS.has(tag)) {
        const isClosing = /^<\//.test(rawTag);
        if (tag === "br") {
          output += "<br>";
        } else if (isClosing) {
          output += `</${tag}>`;
        } else {
          const styleMatch = /\bstyle\s*=\s*"([^"]*)"/.exec(tagMatch[2]!);
          output += styleMatch ? `<${tag} style="${styleMatch[1]!}">` : `<${tag}>`;
        }
      }
    }
    lastIndex = match.index + rawTag.length;
  }

  output += escapeHtml(withoutBlockedElements.slice(lastIndex));
  return output.trim();
}

function hasVisibleBadgeLabelContent(html: string): boolean {
  return html.replace(/<br>/g, "").replace(/<[^>]+>/g, "").trim().length > 0;
}

function normalizeBadgeColor(color?: string): string {
  return color && HEX_COLOR_PATTERN.test(color) ? color : DEFAULT_BADGE_COLOR;
}

function sanitizeBadgeCreateInput(data: { name: string; label_html: string; color?: string; description?: string; sort_order?: number }) {
  const labelHtml = sanitizeBadgeLabelHtml(data.label_html);
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
    const labelHtml = sanitizeBadgeLabelHtml(data.label_html);
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
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
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
    await this.db.insert(memberBadges).values({
      id: badgeId,
      name: safeData.name,
      labelHtml: safeData.label_html,
      color: safeData.color,
      description: safeData.description ?? null,
      sortOrder: safeData.sort_order ?? 0,
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
    await this.deps.writeAuditLog({ entityType: "member_badge", action: "update", actorId, entityId: badgeId, diffTitle: updated.name, detailText: diff ? JSON.stringify(diff) : null });
    return ok(toBadgePayload(updated));
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
        detailText: JSON.stringify({ user_ids: userIds, assigned: toInsert.length }),
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
        detailText: JSON.stringify({ user_ids: removeUserIds, removed }),
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
