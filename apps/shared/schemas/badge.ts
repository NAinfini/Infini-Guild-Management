import { z } from "zod";
import { LIMITS } from "../config/limits";

const badgeColorSchema = z.string().regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/);

export const memberBadgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  label_html: z.string(),
  color: badgeColorSchema,
  description: z.string().nullable(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

const badgeSortOrderSchema = z.number().int().min(0).max(100_000);

export const createMemberBadgeSchema = z.object({
  name: z.string().min(1).max(80),
  label_html: z.string().min(1).max(2000),
  color: badgeColorSchema.default("#3b82f6"),
  description: z.string().max(500).optional(),
  /* 不带就排到末尾（服务端取当前最大值 + 10），和职业目录同一套。写死 0 的话
     新徽章会插到队首，而队首的号段已经被上一次拖拽占着了。 */
  sort_order: badgeSortOrderSchema.optional(),
});

/*
 * 刻意不写成 createMemberBadgeSchema.partial()：create 那份给 color 挂了 .default()，
 * 而 .default() 熬得过 .partial()——PATCH 里不带 color 会被补成默认蓝，等于每次改
 * 名字都把管理员挑的色号刷掉一次。
 */
export const updateMemberBadgeSchema = z.object({
  name: z.string().min(1).max(80),
  label_html: z.string().min(1).max(2000),
  color: badgeColorSchema,
  description: z.string().max(500),
  sort_order: badgeSortOrderSchema,
}).partial();

/*
 * 整表重排，和 reorderClassCatalogSchema 是同一套约定：请求体带**完整**的徽章 id
 * 顺序，服务端按下标 * 10 重写。为什么不是「只报被拖动的那一个」，理由写在
 * class-catalog.ts 那份 schema 上面，两处不重复一遍。
 */
export const reorderMemberBadgesSchema = z.object({
  order: z.array(z.string().min(1))
    .min(1)
    .max(LIMITS.content.badgeCatalogSize.max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Badge order must not list the same badge twice",
    }),
}).strict();

export const badgeAssignmentSchema = z.object({
  badge_id: z.string(),
  user_id: z.string(),
  username: z.string().nullable().optional(),
  assigned_by: z.string(),
  assigned_by_username: z.string().nullable().optional(),
  assigned_at: z.string(),
});

export const assignBadgeSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(100),
});

export const unassignBadgeSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(100),
});

export const userBadgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  label_html: z.string(),
  color: badgeColorSchema,
});
