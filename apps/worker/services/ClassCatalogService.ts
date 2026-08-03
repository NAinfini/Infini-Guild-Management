import {
  classCatalogItemSchema,
  type ClassCatalogItem,
  type CreateClassCatalogItemInput,
  type UpdateClassCatalogItemInput,
} from "@guild/shared";
import { asc, eq, max } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { classCatalog } from "../db/schema/class-catalog";
import type {
  AuditLogStatementCondition,
  WriteAuditLogInput,
} from "./audit";
import { ClassIconUploadValidationError } from "./media";
import {
  deleteUploadedMedia,
  rethrowAfterUploadFailure,
} from "./media-upload-compensation";
import { parseMediaKey } from "./media-keys";
import { err, ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type CatalogRow = typeof classCatalog.$inferSelect;

export type ClassCatalogServiceDeps = {
  rawDb: D1Database;
  generateId: () => string;
  storeIcon: (classId: string, file: File) => Promise<string>;
  deleteObject: (key: string) => Promise<void>;
  buildAuditLogStatements: (
    input: WriteAuditLogInput,
    condition?: AuditLogStatementCondition,
  ) => D1PreparedStatement[];
  warn: (message: string, context?: Record<string, unknown>) => void;
};

function serializeRow(row: CatalogRow): ClassCatalogItem {
  return classCatalogItemSchema.parse({
    id: row.id,
    label: row.label,
    color: row.color,
    icon_type: row.iconType,
    vector_icon: row.vectorIcon,
    icon_key: row.iconKey,
    sort_order: row.sortOrder,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function didChange(result: D1Result | undefined): boolean {
  return result?.meta?.changes === 1;
}

function isLabelUniqueConflict(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  const message = messages.join(" ");
  return /UNIQUE constraint failed:\s*(?:index ['"]?ux_class_catalog_label_nocase['"]?|class_catalog\.label)/i
    .test(message);
}

function iconPointerCondition(
  id: string,
  row: Pick<CatalogRow, "iconType" | "iconKey">,
): { sql: string; bindings: unknown[] } {
  if (row.iconKey === null) {
    return {
      sql: "id = ? AND icon_type = ? AND icon_key IS NULL",
      bindings: [id, row.iconType],
    };
  }
  return {
    sql: "id = ? AND icon_type = ? AND icon_key = ?",
    bindings: [id, row.iconType, row.iconKey],
  };
}

function returnedIconKey(result: D1Result | undefined): string | null {
  const row = result?.results?.[0] as { icon_key?: unknown } | undefined;
  return typeof row?.icon_key === "string" ? row.icon_key : null;
}

export class ClassCatalogService {
  constructor(
    private readonly db: DrizzleDb,
    private readonly deps: ClassCatalogServiceDeps,
  ) {}

  async list(): Promise<ServiceResult<ClassCatalogItem[]>> {
    const rows = await this.db
      .select()
      .from(classCatalog)
      .orderBy(asc(classCatalog.sortOrder), asc(classCatalog.id));
    return ok(rows.map(serializeRow));
  }

  async get(id: string): Promise<ServiceResult<ClassCatalogItem>> {
    const row = await this.findRow(id);
    return row ? ok(serializeRow(row)) : err("NOT_FOUND", "Class not found");
  }

  async create(
    input: CreateClassCatalogItemInput,
    actorId: string,
  ): Promise<ServiceResult<ClassCatalogItem>> {
    if (await this.labelExists(input.label)) {
      return err("CONFLICT", "A class with this label already exists");
    }

    const maxSortRow = (
      await this.db.select({ value: max(classCatalog.sortOrder) }).from(classCatalog)
    )[0];
    const id = this.deps.generateId();
    const sortOrder = input.sort_order ?? Number(maxSortRow?.value ?? -10) + 10;
    const statements = [
      this.deps.rawDb.prepare(
        `INSERT INTO class_catalog
           (id, label, color, icon_type, vector_icon, icon_key, sort_order)
         VALUES (?, ?, ?, 'vector', ?, NULL, ?)`,
      ).bind(
        id,
        input.label,
        input.color.toUpperCase(),
        input.vector_icon,
        sortOrder,
      ),
      ...this.deps.buildAuditLogStatements({
        entityType: "class_catalog",
        action: "create",
        actorId,
        entityId: id,
        diffTitle: input.label,
      }, {
        sql: "EXISTS (SELECT 1 FROM class_catalog WHERE id = ?)",
        bindings: [id],
      }),
    ];

    try {
      await this.deps.rawDb.batch(statements);
    } catch (error) {
      if (isLabelUniqueConflict(error)) {
        return err("CONFLICT", "A class with this label already exists");
      }
      throw error;
    }
    return this.get(id);
  }

  async update(
    id: string,
    input: UpdateClassCatalogItemInput,
    actorId: string,
  ): Promise<ServiceResult<ClassCatalogItem>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class not found");
    if (input.label && await this.labelExists(input.label, id)) {
      return err("CONFLICT", "A class with this label already exists");
    }

    const updatedAt = new Date().toISOString();
    const assignments: string[] = [];
    const bindings: unknown[] = [];
    if (input.label !== undefined) {
      assignments.push("label = ?");
      bindings.push(input.label);
    }
    if (input.color !== undefined) {
      assignments.push("color = ?");
      bindings.push(input.color.toUpperCase());
    }
    if (input.vector_icon !== undefined) {
      assignments.push("vector_icon = ?");
      bindings.push(input.vector_icon);
    }
    if (input.sort_order !== undefined) {
      assignments.push("sort_order = ?");
      bindings.push(input.sort_order);
    }
    assignments.push("updated_at = ?");
    bindings.push(updatedAt, id);

    const updateStatement = this.deps.rawDb.prepare(
      `UPDATE class_catalog SET ${assignments.join(", ")} WHERE id = ?`,
    ).bind(...bindings);
    const statements = [
      updateStatement,
      ...this.deps.buildAuditLogStatements({
        entityType: "class_catalog",
        action: "update",
        actorId,
        entityId: id,
        diffTitle: input.label ?? existing.label,
      }, {
        sql: "EXISTS (SELECT 1 FROM class_catalog WHERE id = ? AND updated_at = ?)",
        bindings: [id, updatedAt],
      }),
    ];

    let results: D1Result[];
    try {
      results = await this.deps.rawDb.batch(statements);
    } catch (error) {
      if (isLabelUniqueConflict(error)) {
        return err("CONFLICT", "A class with this label already exists");
      }
      throw error;
    }
    if (!didChange(results[0])) {
      return (await this.findRow(id))
        ? err("CONFLICT", "Class changed while it was being updated")
        : err("NOT_FOUND", "Class not found");
    }
    return this.get(id);
  }

  /**
   * 整表重排。`order` 必须是当前目录里**每一个** id、各出现一次。
   *
   * 为什么这么严：sort_order 决定的是全站（成员卡、名册筛选、公会战面板）看到的
   * 职业顺序。如果允许只提交一部分，没提交的那些就会停在旧号段上，和新号段交错——
   * 排出来的顺序既不是客户端拖的那个，也不是原来那个，而且不会报错。
   * 所以少一个、多一个、或者中途有人加了/删了职业，一律回 CONFLICT，让客户端
   * 拿最新目录重来，而不是把一次基于过期快照的重排静默写进去。
   */
  async reorder(order: string[], actorId: string): Promise<ServiceResult<ClassCatalogItem[]>> {
    const existingIds = (
      await this.db.select({ id: classCatalog.id }).from(classCatalog)
    ).map((row) => row.id);

    if (existingIds.length !== order.length) {
      return err(
        "CONFLICT",
        `Class order must list all ${existingIds.length} classes; received ${order.length}`,
      );
    }
    const submitted = new Set(order);
    const missing = existingIds.filter((id) => !submitted.has(id));
    if (missing.length > 0) {
      return err("CONFLICT", `Class order is missing ${missing.length} class(es)`);
    }

    /* 下标 * 10 与 create() 的 max + 10 同一号段，给手工插值留空位。 */
    const updatedAt = new Date().toISOString();
    const statements = [
      ...order.map((id, index) => this.deps.rawDb.prepare(
        "UPDATE class_catalog SET sort_order = ?, updated_at = ? WHERE id = ?",
      ).bind(index * 10, updatedAt, id)),
      /* entityId 用 "batch"：这次改的是整张目录，不是某一行。和
         AdminService/GalleryService 的批量审计写法保持一致。 */
      ...this.deps.buildAuditLogStatements({
        entityType: "class_catalog",
        action: "batch_update",
        actorId,
        entityId: "batch",
        diffTitle: `${order.length} classes reordered`,
        detailText: JSON.stringify({ count: order.length, order }),
      }),
    ];

    await this.deps.rawDb.batch(statements);
    return this.list();
  }

  async uploadIcon(
    id: string,
    file: File,
    actorId: string,
  ): Promise<ServiceResult<ClassCatalogItem>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class not found");

    let nextKey: string;
    try {
      nextKey = await this.deps.storeIcon(id, file);
    } catch (error) {
      if (error instanceof ClassIconUploadValidationError) {
        return err("VALIDATION_ERROR", error.message);
      }
      throw error;
    }

    const updatedAt = new Date().toISOString();
    const previousPointer = iconPointerCondition(id, existing);
    const nextPointerCondition =
      "EXISTS (SELECT 1 FROM class_catalog WHERE id = ? AND icon_type = 'image' AND icon_key = ? AND updated_at = ?)";
    const statements = [
      this.deps.rawDb.prepare(
        `UPDATE class_catalog
         SET icon_type = 'image', icon_key = ?, updated_at = ?
         WHERE ${previousPointer.sql}`,
      ).bind(nextKey, updatedAt, ...previousPointer.bindings),
      this.deps.rawDb.prepare(
        `DELETE FROM media_references
         WHERE entity_type = 'class_icon' AND entity_id = ?
           AND ${nextPointerCondition}`,
      ).bind(id, id, nextKey, updatedAt),
      this.deps.rawDb.prepare(
        `INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
         SELECT ?, 'class_icon', ?
         WHERE ${nextPointerCondition}`,
      ).bind(nextKey, id, id, nextKey, updatedAt),
      ...this.deps.buildAuditLogStatements({
        entityType: "class_catalog",
        action: "upload_icon",
        actorId,
        entityId: id,
        diffTitle: existing.label,
      }, {
        sql: nextPointerCondition,
        bindings: [id, nextKey, updatedAt],
      }),
    ];

    let results: D1Result[];
    try {
      results = await this.deps.rawDb.batch(statements);
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (key) => this.deps.deleteObject(key),
        [nextKey],
      );
    }

    if (!didChange(results![0])) {
      await deleteUploadedMedia(
        (key) => this.deps.deleteObject(key),
        [nextKey],
      );
      return (await this.findRow(id))
        ? err("CONFLICT", "Class changed while its icon was being updated")
        : err("NOT_FOUND", "Class not found");
    }

    if (existing.iconKey && existing.iconKey !== nextKey) {
      await this.deleteOldIconBestEffort(existing.iconKey, id);
    }
    return this.get(id);
  }

  async removeIcon(id: string, actorId: string): Promise<ServiceResult<ClassCatalogItem>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class not found");

    const updatedAt = new Date().toISOString();
    const previousPointer = iconPointerCondition(id, existing);
    const nextPointerCondition =
      "EXISTS (SELECT 1 FROM class_catalog WHERE id = ? AND icon_type = 'vector' AND icon_key IS NULL AND updated_at = ?)";
    const statements = [
      this.deps.rawDb.prepare(
        `UPDATE class_catalog
         SET icon_type = 'vector', icon_key = NULL, updated_at = ?
         WHERE ${previousPointer.sql}`,
      ).bind(updatedAt, ...previousPointer.bindings),
      this.deps.rawDb.prepare(
        `DELETE FROM media_references
         WHERE entity_type = 'class_icon' AND entity_id = ?
           AND ${nextPointerCondition}`,
      ).bind(id, id, updatedAt),
      ...this.deps.buildAuditLogStatements({
        entityType: "class_catalog",
        action: "update",
        actorId,
        entityId: id,
        diffTitle: existing.label,
        detailText: "Removed custom class icon",
      }, {
        sql: nextPointerCondition,
        bindings: [id, updatedAt],
      }),
    ];

    const results = await this.deps.rawDb.batch(statements);
    if (!didChange(results[0])) {
      return (await this.findRow(id))
        ? err("CONFLICT", "Class changed while its icon was being removed")
        : err("NOT_FOUND", "Class not found");
    }

    if (existing.iconKey) await this.deleteOldIconBestEffort(existing.iconKey, id);
    return this.get(id);
  }

  async delete(id: string, actorId: string): Promise<ServiceResult<{ deleted: true }>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class not found");

    const auditStatements = this.deps.buildAuditLogStatements({
      entityType: "class_catalog",
      action: "delete",
      actorId,
      entityId: id,
      diffTitle: existing.label,
    }, {
      sql: "EXISTS (SELECT 1 FROM class_catalog WHERE id = ?)",
      bindings: [id],
    });
    const statements = [
      ...auditStatements,
      this.deps.rawDb.prepare(
        "DELETE FROM media_references WHERE entity_type = 'class_icon' AND entity_id = ?",
      ).bind(id),
      /*
       * class_tag_members 对 class_catalog 建了外键并级联，但本服务从不假定 D1 在执行
       * 外键约束，所以显式删一遍。漏了的话标签会指着一个已经不存在的职业，指向该标签
       * 的配额格子就多出一个永远填不上的名额。
       *
       * 配额表这里不用管：一格配额指的是标签而不是职业，标签还在，只是少了一个成员。
       */
      this.deps.rawDb.prepare("DELETE FROM class_tag_members WHERE class_id = ?").bind(id),
      this.deps.rawDb.prepare(
        "DELETE FROM class_catalog WHERE id = ? RETURNING icon_key",
      ).bind(id),
    ];
    // 索引跟着数组末尾走，别再手算偏移量——中间插一条语句就会错位。
    const deleteIndex = statements.length - 1;
    const results = await this.deps.rawDb.batch(statements);

    if (!didChange(results[deleteIndex])) {
      return err("NOT_FOUND", "Class not found");
    }
    const iconKey = returnedIconKey(results[deleteIndex]);
    if (iconKey) await this.deleteOldIconBestEffort(iconKey, id);
    return ok({ deleted: true });
  }

  async referencesIcon(key: string): Promise<boolean> {
    const parsed = parseMediaKey(key);
    if (parsed?.kind !== "class_icon" || !parsed.entityId || parsed.contentType !== "image/webp") {
      return false;
    }
    const row = await this.deps.rawDb
      .prepare("SELECT id FROM class_catalog WHERE id = ? AND icon_type = 'image' AND icon_key = ? LIMIT 1")
      .bind(parsed.entityId, key)
      .first<{ id: string }>();
    return Boolean(row?.id);
  }

  private async findRow(id: string): Promise<CatalogRow | null> {
    return (
      await this.db
        .select()
        .from(classCatalog)
        .where(eq(classCatalog.id, id))
        .limit(1)
    )[0] ?? null;
  }

  private async labelExists(label: string, excludingId?: string): Promise<boolean> {
    const row = await this.deps.rawDb
      .prepare(
        excludingId
          ? "SELECT id FROM class_catalog WHERE label = ? COLLATE NOCASE AND id <> ? LIMIT 1"
          : "SELECT id FROM class_catalog WHERE label = ? COLLATE NOCASE LIMIT 1",
      )
      .bind(...(excludingId ? [label, excludingId] : [label]))
      .first<{ id: string }>();
    return Boolean(row?.id);
  }

  private async deleteOldIconBestEffort(key: string, classId: string): Promise<void> {
    try {
      await this.deps.deleteObject(key);
    } catch (error) {
      this.deps.warn("Failed to remove replaced class icon; orphan cleanup will retry", {
        classId,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
