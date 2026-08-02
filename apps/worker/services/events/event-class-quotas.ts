import { LIMITS } from "@guild/shared";
import type { RawDbLike } from "./EventCrudService";

export type ClassQuotaRow = { class_id: string; required: number };

/*
 * 配额表有两张——活动一张、周期模板一张——形状完全一致，只有父表那一列名字不同。
 * 把差异收在这个描述符里，两边共用同一套读写逻辑，省得各写一遍再慢慢长歪。
 * 表名和列名都是本模块的常量，不来自请求，直接拼进 SQL 是安全的。
 */
export type ClassQuotaTable = {
  readonly table: string;
  readonly parentColumn: string;
};

export const EVENT_CLASS_QUOTA_TABLE: ClassQuotaTable = {
  table: "event_class_quotas",
  parentColumn: "event_id",
};

export const TEMPLATE_CLASS_QUOTA_TABLE: ClassQuotaTable = {
  table: "recurring_template_class_quotas",
  parentColumn: "template_id",
};

type BoundStatement = ReturnType<ReturnType<RawDbLike["prepare"]>["bind"]>;

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(", ");
}

function readRows<T>(result: { results?: unknown[] } | unknown[] | undefined): T[] {
  const rows = Array.isArray(result) ? result : result?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * 找出目录里不存在的职业 id。
 *
 * 两张配额表都对 class_catalog 建了外键，但本仓库不假定 D1 真的在执行外键约束
 * （ClassCatalogService 至今仍手写级联删除），所以写入前显式查一次。查不到就报错，
 * 不静默丢弃——管理员传了个不存在的职业，配额少一格是他必须知道的事。
 */
export async function findUnknownClassIds(
  rawDb: RawDbLike,
  quotas: readonly ClassQuotaRow[],
): Promise<string[]> {
  const wanted = [...new Set(quotas.map((quota) => quota.class_id))];
  if (wanted.length === 0) {
    return [];
  }
  const result = await rawDb
    .prepare(`SELECT id FROM class_catalog WHERE id IN (${placeholders(wanted.length)})`)
    .bind(...wanted)
    .all?.();
  const known = new Set(readRows<{ id: string }>(result).map((row) => row.id));
  return wanted.filter((classId) => !known.has(classId));
}

/** 配额条数上限，和 zod 一致；服务层再挡一次，因为模板生成走的是复制而不是校验。 */
export const MAX_CLASS_QUOTAS = LIMITS.content.eventClassQuotas.max;

/**
 * 整组替换某一行的配额。先删后插，没有增量比对——配额行只有 (parent, class) 和
 * required 三个字段，逐条 diff 换不来任何东西，反而多出几种中间状态。
 * 返回语句而不是直接执行，好让调用方塞进它自己那个 batch 里，跟父行的写入同生共死。
 */
export function buildReplaceClassQuotaStatements(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentId: string,
  quotas: readonly ClassQuotaRow[],
): BoundStatement[] {
  return [
    ...buildDeleteClassQuotaStatements(rawDb, spec, parentId),
    ...quotas.slice(0, MAX_CLASS_QUOTAS).map((quota) =>
      rawDb
        .prepare(`INSERT INTO ${spec.table} (${spec.parentColumn}, class_id, required) VALUES (?1, ?2, ?3)`)
        .bind(parentId, quota.class_id, quota.required),
    ),
  ];
}

export function buildDeleteClassQuotaStatements(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentId: string,
): BoundStatement[] {
  return [
    rawDb.prepare(`DELETE FROM ${spec.table} WHERE ${spec.parentColumn} = ?1`).bind(parentId),
  ];
}

export async function replaceClassQuotas(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentId: string,
  quotas: readonly ClassQuotaRow[],
): Promise<void> {
  await rawDb.batch(buildReplaceClassQuotaStatements(rawDb, spec, parentId, quotas));
}

/**
 * 按父行 id 批量读回配额，顺序跟职业目录一致——筹码行的排列必须稳定，否则同一个
 * 活动在两次请求里筹码会换位置。
 *
 * 这里用 LEFT JOIN 而不是 INNER JOIN：目录条目被删时配额行应该跟着走（外键级联加
 * ClassCatalogService 里的显式删除），真出现了对不上目录的配额行，那是 bug，要让它
 * 露出来而不是被 JOIN 悄悄滤掉。这类行排在最后。
 */
export async function loadClassQuotas(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentIds: readonly string[],
): Promise<Map<string, ClassQuotaRow[]>> {
  const map = new Map<string, ClassQuotaRow[]>();
  if (parentIds.length === 0) {
    return map;
  }
  const result = await rawDb
    .prepare(
      `SELECT q.${spec.parentColumn} AS parent_id, q.class_id AS class_id, q.required AS required
       FROM ${spec.table} q
       LEFT JOIN class_catalog c ON c.id = q.class_id
       WHERE q.${spec.parentColumn} IN (${placeholders(parentIds.length)})
       ORDER BY c.sort_order IS NULL, c.sort_order, q.class_id`,
    )
    .bind(...parentIds)
    .all?.();

  for (const row of readRows<{ parent_id: string; class_id: string; required: number }>(result)) {
    const list = map.get(row.parent_id) ?? [];
    list.push({ class_id: row.class_id, required: Number(row.required) });
    map.set(row.parent_id, list);
  }
  return map;
}

export async function loadClassQuotasFor(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentId: string,
): Promise<ClassQuotaRow[]> {
  return (await loadClassQuotas(rawDb, spec, [parentId])).get(parentId) ?? [];
}

/**
 * 投票的「参与者」是投票人，抽奖的是抽签池，两者都不是一支队伍——这两种类型不带配额。
 * 校验层已经拒收带配额的投票／抽奖请求，但类型是可以改的：活动改成投票时没人会再
 * 传 class_quotas，旧配额行必须在这里清掉，否则改回来就会冒出一批没人设过的配额。
 */
export function typeSupportsClassQuotas(type: string): boolean {
  return type !== "poll" && type !== "raffle";
}
