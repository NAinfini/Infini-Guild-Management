import { inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eventClassQuotas, recurringTemplateClassQuotas } from "../db/schema/events";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;

/**
 * 数一数每个标签被多少格配额引用着（活动 + 周期模板）。
 *
 * 删标签会把这些配额格一起删掉，所以删除确认必须先把这个数摆出来。两张表分开查再相加，
 * 不写 UNION：两张表的父列名不同，UNION 得先各自投影成同一形状，读起来还不如加法直白。
 * 没有引用的标签不出现在结果里，调用方按 0 处理。
 */
export async function loadClassTagUsage(
  db: DrizzleDb,
  tagIds: readonly string[],
): Promise<Map<string, number>> {
  const usage = new Map<string, number>();
  if (tagIds.length === 0) return usage;
  const wanted = [...tagIds];

  const [eventRows, templateRows] = await Promise.all([
    db
      .select({ tagId: eventClassQuotas.tagId, total: sql<number>`count(*)` })
      .from(eventClassQuotas)
      .where(inArray(eventClassQuotas.tagId, wanted))
      .groupBy(eventClassQuotas.tagId),
    db
      .select({ tagId: recurringTemplateClassQuotas.tagId, total: sql<number>`count(*)` })
      .from(recurringTemplateClassQuotas)
      .where(inArray(recurringTemplateClassQuotas.tagId, wanted))
      .groupBy(recurringTemplateClassQuotas.tagId),
  ]);

  for (const row of [...eventRows, ...templateRows]) {
    usage.set(row.tagId, (usage.get(row.tagId) ?? 0) + Number(row.total));
  }
  return usage;
}
