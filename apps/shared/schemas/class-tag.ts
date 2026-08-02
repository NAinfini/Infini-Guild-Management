import { z } from "zod";
import { LIMITS } from "../config/limits";
import { classIdSchema } from "./class-catalog";

const L = LIMITS.content;

/*
 * 职业标签：给一组职业起个名字，比如「治疗」同时收牵丝霖和破竹风。
 *
 * 活动配额可以指着一个标签说「这一格要 2 个」，于是「需要两个治疗，哪种都行」终于
 * 有了表达方式——在此之前配额只能指向单个职业，这句话根本写不出来。
 *
 * 标签里装什么**不设任何限制**：
 *   - 一个职业可以进任意多个标签
 *   - 标签之间可以任意重叠
 *   - 允许空标签
 * 这是刻意的。哪些职业算「治疗」是公会自己的判断，不是这一层该替它决定的事。代价是
 * 重叠标签会让只挂一个职业的人也算成摇摆位（见 utils/class-quota.ts 的说明），那是
 * 数学上正确的结果，展示层负责讲清楚。
 */
export const classTagIdSchema = z.string().trim().min(1).max(128);

const classTagLabelSchema = z
  .string()
  .trim()
  .min(L.classTagLabel.min)
  .max(L.classTagLabel.max);

/* 同一个职业在一个标签里出现两次一定是调用方出了错。去重会把这个错吞掉，报错不会。 */
const classTagMembersSchema = z
  .array(classIdSchema)
  .max(L.classesPerTag.max)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Class tag must not list the same class twice",
  });

export const classTagSchema = z.object({
  id: classTagIdSchema,
  label: classTagLabelSchema,
  class_ids: classTagMembersSchema,
  sort_order: z.number().int().min(0).max(100_000),
  /* 有多少个活动／模板的配额指着这个标签。删标签会连带删掉那些配额格，删除确认必须
     把这个数说出来，否则管理员是在盲删。必填而不是可选：漏算会显示成 0，等于骗人。 */
  usage_count: z.number().int().min(0),
  created_at: z.string(),
  updated_at: z.string(),
});

const classTagSortOrderSchema = z.number().int().min(0).max(100_000);

export const createClassTagSchema = z.object({
  label: classTagLabelSchema,
  class_ids: classTagMembersSchema.default([]),
  sort_order: classTagSortOrderSchema.optional(),
}).strict();

/*
 * 刻意不写成 createClassTagSchema.partial()：create 那份给 class_ids 挂了 .default([])，
 * 而 .default() 熬得过 .partial()——空 body 会被补成 { class_ids: [] }，「至少改一个字段」
 * 这条检查就永远通过，一个空 PATCH 会当成「把成员清空」写进去。
 */
export const updateClassTagSchema = z.object({
  label: classTagLabelSchema,
  class_ids: classTagMembersSchema,
  sort_order: classTagSortOrderSchema,
}).partial().strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one class tag field is required",
});

export type ClassTag = z.infer<typeof classTagSchema>;
export type CreateClassTagInput = z.infer<typeof createClassTagSchema>;
export type UpdateClassTagInput = z.infer<typeof updateClassTagSchema>;
