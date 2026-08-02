import {
  LIMITS,
  classTagSchema,
  type ClassTag,
  type CreateClassTagInput,
  type UpdateClassTagInput,
} from "@guild/shared";
import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { classCatalog, classTagMembers, classTags } from "../db/schema/class-catalog";
import type { AuditLogStatementCondition, WriteAuditLogInput } from "./audit";
import { err, ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type TagRow = typeof classTags.$inferSelect;

export type ClassTagServiceDeps = {
  rawDb: D1Database;
  generateId: () => string;
  buildAuditLogStatements: (
    input: WriteAuditLogInput,
    condition?: AuditLogStatementCondition,
  ) => D1PreparedStatement[];
};

function isLabelUniqueConflict(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return /UNIQUE constraint failed:\s*(?:index ['"]?ux_class_tags_label_nocase['"]?|class_tags\.label)/i
    .test(messages.join(" "));
}

/*
 * 目录职业标签的读写。
 *
 * class_tags 这张表同时装着两种标签：owner_kind 为 NULL 的目录标签（管理员维护、全站
 * 可选），和某个活动／模板自己造的一次性标签。本服务只管前者，所以每条查询都得带上
 * owner_kind IS NULL——这是共用一张表换来的代价，漏一处就会把别人的临时组列进目录。
 *
 * 成员关系整组替换，不做增量比对：一条成员行只有 (tag, class) 两个字段，逐条 diff 换
 * 不来任何东西，反而多出几种中间状态。跟活动配额那边是同一个取舍。
 *
 * 标签里装什么一律不校验合理性——空标签、跟别的标签重叠、装下整个目录都放行。哪些
 * 职业算「治疗」是公会自己的判断。唯一会拒绝的是**目录里不存在的职业 id**：那是调用
 * 方传错了，静默丢掉会让管理员以为标签里有那个职业。
 */
export class ClassTagService {
  constructor(
    private readonly db: DrizzleDb,
    private readonly deps: ClassTagServiceDeps,
  ) {}

  async list(): Promise<ServiceResult<ClassTag[]>> {
    const rows = await this.db
      .select()
      .from(classTags)
      .where(isNull(classTags.ownerKind))
      .orderBy(asc(classTags.sortOrder), asc(classTags.id));
    const members = await this.loadMembers(rows.map((row) => row.id));
    return ok(rows.map((row) => serializeRow(row, members.get(row.id) ?? [])));
  }

  async get(id: string): Promise<ServiceResult<ClassTag>> {
    const row = await this.findRow(id);
    if (!row) return err("NOT_FOUND", "Class tag not found");
    const members = await this.loadMembers([id]);
    return ok(serializeRow(row, members.get(id) ?? []));
  }

  async create(input: CreateClassTagInput, actorId: string): Promise<ServiceResult<ClassTag>> {
    const total = await this.countTags();
    if (total >= LIMITS.content.classTags.max) {
      return err("VALIDATION_ERROR", `At most ${LIMITS.content.classTags.max} class tags are allowed`);
    }
    const unknown = await this.findUnknownClassIds(input.class_ids);
    if (unknown.length > 0) {
      return err("VALIDATION_ERROR", `Unknown class ids: ${unknown.join(", ")}`);
    }
    if (await this.labelExists(input.label)) {
      return err("CONFLICT", "A class tag with this label already exists");
    }

    const maxSortRow = (
      await this.db
        .select({ value: max(classTags.sortOrder) })
        .from(classTags)
        .where(isNull(classTags.ownerKind))
    )[0];
    const id = this.deps.generateId();
    const sortOrder = input.sort_order ?? Number(maxSortRow?.value ?? -10) + 10;
    const statements = [
      this.deps.rawDb
        .prepare("INSERT INTO class_tags (id, label, sort_order) VALUES (?, ?, ?)")
        .bind(id, input.label, sortOrder),
      ...this.buildMemberStatements(id, input.class_ids),
      ...this.deps.buildAuditLogStatements({
        entityType: "class_tag",
        action: "create",
        actorId,
        entityId: id,
        diffTitle: input.label,
      }, {
        sql: "EXISTS (SELECT 1 FROM class_tags WHERE id = ?)",
        bindings: [id],
      }),
    ];

    try {
      await this.deps.rawDb.batch(statements);
    } catch (error) {
      if (isLabelUniqueConflict(error)) {
        return err("CONFLICT", "A class tag with this label already exists");
      }
      throw error;
    }
    return this.get(id);
  }

  async update(
    id: string,
    input: UpdateClassTagInput,
    actorId: string,
  ): Promise<ServiceResult<ClassTag>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class tag not found");
    if (input.class_ids !== undefined) {
      const unknown = await this.findUnknownClassIds(input.class_ids);
      if (unknown.length > 0) {
        return err("VALIDATION_ERROR", `Unknown class ids: ${unknown.join(", ")}`);
      }
    }
    if (input.label !== undefined && await this.labelExists(input.label, id)) {
      return err("CONFLICT", "A class tag with this label already exists");
    }

    const { assignments, bindings } = buildTagAssignments(input);
    const statements = [
      this.deps.rawDb
        .prepare(`UPDATE class_tags SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...bindings, id),
      ...(input.class_ids === undefined ? [] : this.buildReplaceMemberStatements(id, input.class_ids)),
      ...this.deps.buildAuditLogStatements({
        entityType: "class_tag",
        action: "update",
        actorId,
        entityId: id,
        diffTitle: input.label ?? existing.label,
      }),
    ];

    try {
      await this.deps.rawDb.batch(statements);
    } catch (error) {
      if (isLabelUniqueConflict(error)) {
        return err("CONFLICT", "A class tag with this label already exists");
      }
      throw error;
    }
    return this.get(id);
  }

  async delete(id: string, actorId: string): Promise<ServiceResult<{ deleted: true }>> {
    const existing = await this.findRow(id);
    if (!existing) return err("NOT_FOUND", "Class tag not found");

    await this.deps.rawDb.batch([
      ...this.deps.buildAuditLogStatements({
        entityType: "class_tag",
        action: "delete",
        actorId,
        entityId: id,
        diffTitle: existing.label,
      }),
      /* class_tag_members 和两张配额表都对 class_tags 建了外键并级联，但本仓库从不假定
         D1 真的在执行外键约束（ClassCatalogService 至今仍手写级联删除），所以显式删一
         遍。配额行漏了的话会指着一个不存在的标签，那一格就永远配不齐。

         删标签会连带删掉正在用它的活动配额，这跟删职业一样是有损的，界面上要先讲清楚
         有多少活动在用。 */
      this.deps.rawDb.prepare("DELETE FROM event_class_quotas WHERE tag_id = ?").bind(id),
      this.deps.rawDb.prepare("DELETE FROM recurring_template_class_quotas WHERE tag_id = ?").bind(id),
      this.deps.rawDb.prepare("DELETE FROM class_tag_members WHERE tag_id = ?").bind(id),
      this.deps.rawDb.prepare("DELETE FROM class_tags WHERE id = ?").bind(id),
    ]);
    return ok({ deleted: true as const });
  }

  private buildMemberStatements(tagId: string, classIds: readonly string[]) {
    return classIds.slice(0, LIMITS.content.classesPerTag.max).map((classId) =>
      this.deps.rawDb
        .prepare("INSERT OR IGNORE INTO class_tag_members (tag_id, class_id) VALUES (?, ?)")
        .bind(tagId, classId),
    );
  }

  private buildReplaceMemberStatements(tagId: string, classIds: readonly string[]) {
    return [
      this.deps.rawDb.prepare("DELETE FROM class_tag_members WHERE tag_id = ?").bind(tagId),
      ...this.buildMemberStatements(tagId, classIds),
    ];
  }

  /**
   * 按目录顺序读回每个标签的职业。顺序必须稳定，否则同一个标签在两次请求里成员会
   * 换位置，编辑器上看着像是被人改过。
   */
  private async loadMembers(tagIds: readonly string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (tagIds.length === 0) return map;
    const rows = await this.db
      .select({ tagId: classTagMembers.tagId, classId: classTagMembers.classId })
      .from(classTagMembers)
      .innerJoin(classCatalog, eq(classCatalog.id, classTagMembers.classId))
      .where(inArray(classTagMembers.tagId, [...tagIds]))
      .orderBy(asc(classCatalog.sortOrder), asc(classCatalog.id));
    for (const row of rows) {
      const list = map.get(row.tagId) ?? [];
      list.push(row.classId);
      map.set(row.tagId, list);
    }
    return map;
  }

  private async findUnknownClassIds(classIds: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(classIds)];
    if (wanted.length === 0) return [];
    const rows = await this.db
      .select({ id: classCatalog.id })
      .from(classCatalog)
      .where(inArray(classCatalog.id, wanted));
    const known = new Set(rows.map((row) => row.id));
    return wanted.filter((classId) => !known.has(classId));
  }

  private async findRow(id: string): Promise<TagRow | undefined> {
    return (
      await this.db
        .select()
        .from(classTags)
        .where(and(eq(classTags.id, id), isNull(classTags.ownerKind)))
        .limit(1)
    )[0];
  }

  private async countTags(): Promise<number> {
    return (
      await this.db.select({ id: classTags.id }).from(classTags).where(isNull(classTags.ownerKind))
    ).length;
  }

  private async labelExists(label: string, excludeId?: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: classTags.id, label: classTags.label })
      .from(classTags)
      .where(isNull(classTags.ownerKind));
    const wanted = label.trim().toLowerCase();
    return rows.some((row) => row.id !== excludeId && row.label.trim().toLowerCase() === wanted);
  }
}

function buildTagAssignments(input: UpdateClassTagInput) {
  const assignments: string[] = [];
  const bindings: unknown[] = [];
  if (input.label !== undefined) {
    assignments.push("label = ?");
    bindings.push(input.label);
  }
  if (input.sort_order !== undefined) {
    assignments.push("sort_order = ?");
    bindings.push(input.sort_order);
  }
  /* updated_at 无条件推进：只改成员时标签行本身没有一列会变，不写这一列的话
     「这个标签最后一次被动过是什么时候」就查不出来。 */
  assignments.push("updated_at = ?");
  bindings.push(new Date().toISOString());
  return { assignments, bindings };
}

function serializeRow(row: TagRow, classIds: string[]): ClassTag {
  return classTagSchema.parse({
    id: row.id,
    label: row.label,
    class_ids: classIds,
    sort_order: row.sortOrder,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}
