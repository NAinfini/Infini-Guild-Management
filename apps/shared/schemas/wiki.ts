import { z } from "zod";
import { LIMITS } from "../config/limits";
import { richTextDocumentStringSchema } from "./rich-text";

const L = LIMITS.content;

export const wikiCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sort_order: z.number().int(),
  parent_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createWikiCategorySchema = z.object({
  name: z.string().min(L.wikiCategoryName.min).max(L.wikiCategoryName.max),
  slug: z.string().min(1).max(L.wikiCategoryName.max).optional(),
  sort_order: z.number().int().default(0),
  parent_id: z.string().optional(),
});

export const updateWikiCategorySchema = createWikiCategorySchema.partial().extend({
  parent_id: z.string().nullable().optional(),
});

/*
 * 分类编辑器的「保存」一次能改多行：改名、换父级、拖出新的顺序，往往同时发生。
 * 逐行 PATCH 的话，中途失败会留下一半改完一半没改的目录，客户端既回滚不了，
 * 也说不清是哪几行落了库——所以这里只开一个批量口，服务端一次 D1 batch 落库。
 *
 * 不收 slug：slug 一改，文章链接就变了，那是单行操作，走 PATCH /categories/:id。
 */
const batchUpdateWikiCategoryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(L.wikiCategoryName.min).max(L.wikiCategoryName.max).optional(),
  /* 「没有父级」只有 null 一种写法。空串会被 SQLite 当成一个真实的 id 写进外键列，
     所以这里直接拒掉，不做静默转换。 */
  parent_id: z.string().min(1).nullable().optional(),
  sort_order: z.number().int().optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.parent_id !== undefined || value.sort_order !== undefined,
  { message: "Each category update must change at least one field" },
);

export const batchUpdateWikiCategoriesSchema = z.object({
  updates: z.array(batchUpdateWikiCategoryItemSchema)
    .min(L.wikiCategoryBatch.min)
    .max(L.wikiCategoryBatch.max)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
      message: "Category updates must not list the same category twice",
    }),
}).strict();

export type BatchUpdateWikiCategoriesInput = z.infer<typeof batchUpdateWikiCategoriesSchema>;
export type BatchUpdateWikiCategoryItem = BatchUpdateWikiCategoriesInput["updates"][number];

export const wikiArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  category_id: z.string(),
  body_json: z.string(),
  sort_order: z.number().int(),
  pinned: z.boolean(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  updated_by: z.string().nullable(),
  updated_by_username: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createWikiArticleSchema = z.object({
  title: z.string().min(L.wikiArticleTitle.min).max(L.wikiArticleTitle.max),
  slug: z.string().optional(),
  category_id: z.string(),
  body_json: richTextDocumentStringSchema(
    z.string().min(L.wikiArticleBody.min).max(L.wikiArticleBody.max),
  ),
  sort_order: z.number().int().default(0),
  pinned: z.boolean().default(false),
});

export const updateWikiArticleSchema = createWikiArticleSchema.partial().extend({
  archived_at: z.string().datetime().nullable().optional(),
});

export const wikiRevisionListItemSchema = z.object({
  id: z.string(),
  article_id: z.string(),
  revision: z.number().int(),
  title: z.string(),
  edited_by: z.string(),
  edited_by_username: z.string().nullable(),
  restored_from: z.number().int().nullable(),
  created_at: z.string(),
});

export const wikiRevisionSchema = wikiRevisionListItemSchema.extend({
  slug: z.string(),
  category_id: z.string(),
  body_json: z.string(),
  sort_order: z.number().int(),
  pinned: z.boolean(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  media_ids: z.array(z.string()).max(50),
});

export const wikiRevisionListQuerySchema = z.object({
  before_revision: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
}).strict();
