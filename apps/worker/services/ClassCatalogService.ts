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
import type { MediaService, ParsedImageMediaUpload } from "./MediaService";
import { MediaValidationError } from "./MediaService";
import { err, ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type CatalogRow = typeof classCatalog.$inferSelect;

export type ClassCatalogServiceDeps = {
  rawDb: D1Database;
  mediaService: MediaService;
  generateId: () => string;
  buildAuditLogStatements: (
    input: WriteAuditLogInput,
    condition?: AuditLogStatementCondition,
  ) => D1PreparedStatement[];
};

function serializeRow(row: CatalogRow, iconMediaId: string | null): ClassCatalogItem {
  return classCatalogItemSchema.parse({
    id: row.id,
    label: row.label,
    color: row.color,
    icon_type: row.iconType,
    vector_icon: row.vectorIcon,
    icon_media_id: iconMediaId,
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
    const media = await this.deps.mediaService.listLinkedMedia("class_catalog", rows.map((row) => row.id), ["icon"]);
    return ok(rows.map((row) => serializeRow(row, media.get(row.id)?.[0]?.mediaId ?? null)));
  }

  async get(id: string): Promise<ServiceResult<ClassCatalogItem>> {
    const row = await this.findRow(id);
    if (!row) return err("NOT_FOUND", "Class not found");
    const mediaId = (await this.deps.mediaService.listLinkedMediaIds("class_catalog", id, "icon"))[0] ?? null;
    return ok(serializeRow(row, mediaId));
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
           (id, label, color, icon_type, vector_icon, sort_order)
         VALUES (?, ?, ?, 'vector', ?, ?)`,
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
      assignments.push("icon_type = 'vector'", "vector_icon = ?");
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

    const previousIconMedia = input.vector_icon !== undefined
      ? await this.deps.mediaService.listLinkedMediaIds("class_catalog", id, "icon")
      : [];
    if (input.vector_icon !== undefined) {
      await this.deps.mediaService.replace({
        entityType: "class_catalog",
        entityId: id,
        slot: "icon",
        media: [],
        ownerUserId: actorId,
        now: updatedAt,
      });
    }
    let results: D1Result[];
    try {
      results = await this.deps.rawDb.batch(statements);
    } catch (error) {
      if (input.vector_icon !== undefined) {
        try {
          await this.deps.mediaService.replace({
            entityType: "class_catalog",
            entityId: id,
            slot: "icon",
            media: previousIconMedia.map((mediaId) => ({ mediaId, sortOrder: 0 })),
            now: updatedAt,
          });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Class ${id} update and media rollback both failed`);
        }
      }
      if (isLabelUniqueConflict(error)) {
        return err("CONFLICT", "A class with this label already exists");
      }
      throw error;
    }
    if (!didChange(results[0])) {
      if (input.vector_icon !== undefined) {
        await this.deps.mediaService.replace({
          entityType: "class_catalog",
          entityId: id,
          slot: "icon",
          media: previousIconMedia.map((mediaId) => ({ mediaId, sortOrder: 0 })),
          now: updatedAt,
        });
      }
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
   * 职业顺序。部分提交会让未提交项与新号段交错，产生无明确归属的顺序。
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
        detail: { count: order.length, order },
      }),
    ];

    await this.deps.rawDb.batch(statements);
    return this.list();
  }

  async uploadIcon(
    id: string,
    upload: ParsedImageMediaUpload,
    actorId: string,
    maxBytes: number,
  ): Promise<ServiceResult<ClassCatalogItem>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class not found");
    const now = new Date().toISOString();
    const previousIconMedia = await this.deps.mediaService.listLinkedMediaIds("class_catalog", id, "icon");
    let replaced = false;
    try {
      const created = await this.deps.mediaService.createImages({
        ownerUserId: actorId,
        purpose: "class_icon",
        uploads: [upload],
        now,
        maxBytes,
      });
      await this.deps.mediaService.replace({
        entityType: "class_catalog",
        entityId: id,
        slot: "icon",
        media: [{ mediaId: created.mediaIds[0]!, sortOrder: 0 }],
        ownerUserId: actorId,
        now,
      });
      replaced = true;
      await this.db.update(classCatalog).set({
        iconType: "image",
        vectorIcon: null,
        updatedAt: now,
      }).where(eq(classCatalog.id, id));
    } catch (error) {
      if (replaced) {
        try {
          await this.deps.mediaService.replace({
            entityType: "class_catalog",
            entityId: id,
            slot: "icon",
            media: previousIconMedia.map((mediaId) => ({ mediaId, sortOrder: 0 })),
            now,
          });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Class ${id} icon update and media rollback both failed`);
        }
      }
      if (error instanceof MediaValidationError) {
        return err("VALIDATION_ERROR", error.message);
      }
      throw error;
    }
    await this.deps.rawDb.batch(this.deps.buildAuditLogStatements({
      entityType: "class_catalog",
      action: "upload_icon",
      actorId,
      entityId: id,
      diffTitle: existing.label,
    }));
    return this.get(id);
  }

  async removeIcon(id: string, actorId: string): Promise<ServiceResult<ClassCatalogItem>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class not found");

    const updatedAt = new Date().toISOString();
    const previousIconMedia = await this.deps.mediaService.listLinkedMediaIds("class_catalog", id, "icon");
    await this.deps.mediaService.replace({ entityType: "class_catalog", entityId: id, slot: "icon", media: [], ownerUserId: actorId, now: updatedAt });
    try {
      await this.db.update(classCatalog).set({ iconType: "vector", vectorIcon: "sword", updatedAt }).where(eq(classCatalog.id, id));
    } catch (error) {
      try {
        await this.deps.mediaService.replace({
          entityType: "class_catalog",
          entityId: id,
          slot: "icon",
          media: previousIconMedia.map((mediaId) => ({ mediaId, sortOrder: 0 })),
          now: updatedAt,
        });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Class ${id} icon removal and media rollback both failed`);
      }
      throw error;
    }
    await this.deps.rawDb.batch(this.deps.buildAuditLogStatements({
        entityType: "class_catalog",
        action: "update",
        actorId,
        entityId: id,
        diffTitle: existing.label,
        detail: { reason: "Removed custom class icon" },
      }));
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
      /*
       * class_tag_members 对 class_catalog 建了外键并级联，但本服务从不假定 D1 在执行
       * 外键约束，所以显式删一遍。漏了的话标签会指着一个已经不存在的职业，指向该标签
       * 的配额格子就多出一个永远填不上的名额。
       *
       * 配额表这里不用管：一格配额指的是标签而不是职业，标签还在，只是少了一个成员。
       */
      this.deps.rawDb.prepare("DELETE FROM class_tag_members WHERE class_id = ?").bind(id),
      this.deps.rawDb.prepare("DELETE FROM class_catalog WHERE id = ?").bind(id),
    ];
    // 索引跟着数组末尾走，别再手算偏移量——中间插一条语句就会错位。
    const deleteIndex = statements.length - 1;
    const results = await this.deps.rawDb.batch(statements);

    if (!didChange(results[deleteIndex])) {
      return err("NOT_FOUND", "Class not found");
    }
    return ok({ deleted: true });
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

}
