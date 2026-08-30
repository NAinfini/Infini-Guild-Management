import { z } from "zod";
import { LIMITS } from "../config/limits";
import { richTextDocumentStringSchema } from "./rich-text";
import { mediaIdSchema } from "./media";

const L = LIMITS.content;

export const wikiCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const wikiCategoryRevisionTokenSchema = z.string().min(1).max(200);

export const wikiCategoryCatalogSchema = z.object({
  categories: z.array(wikiCategorySchema),
  revision_token: wikiCategoryRevisionTokenSchema,
}).strict();

export const createWikiCategorySchema = z.object({
  name: z.string().min(L.wikiCategoryName.min).max(L.wikiCategoryName.max),
  slug: z.string().min(1).max(L.wikiCategoryName.max).optional(),
  sort_order: z.number().int().default(0),
});

export const updateWikiCategorySchema = createWikiCategorySchema.partial().extend({
  expected_revision_token: wikiCategoryRevisionTokenSchema,
}).strict().refine(({ expected_revision_token: _revisionToken, ...changes }) => Object.keys(changes).length > 0, {
  message: "At least one category field is required",
});

export const deleteWikiCategorySchema = z.object({
  expected_revision_token: wikiCategoryRevisionTokenSchema,
}).strict();

/*
 * 分类编辑器的「保存」一次能改多行：改名和调整顺序往往同时发生。
 * 逐行 PATCH 的话，中途失败会留下一半改完一半没改的目录，客户端既回滚不了，
 * 也说不清是哪几行落了库——所以这里只开一个批量口，服务端一次 D1 batch 落库。
 *
 * 不收 slug：slug 一改，文章链接就变了，那是单行操作，走 PATCH /categories/:id。
 */
const batchUpdateWikiCategoryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(L.wikiCategoryName.min).max(L.wikiCategoryName.max).optional(),
  sort_order: z.number().int().optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.sort_order !== undefined,
  { message: "Each category update must change at least one field" },
);

export const batchUpdateWikiCategoriesSchema = z.object({
  expected_revision_token: wikiCategoryRevisionTokenSchema,
  updates: z.array(batchUpdateWikiCategoryItemSchema)
    .min(L.wikiCategoryBatch.min)
    .max(L.wikiCategoryBatch.max)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
      message: "Category updates must not list the same category twice",
    }),
}).strict();

export type BatchUpdateWikiCategoriesInput = z.infer<typeof batchUpdateWikiCategoriesSchema>;
export type BatchUpdateWikiCategoryItem = BatchUpdateWikiCategoriesInput["updates"][number];
export type WikiCategoryCatalog = z.infer<typeof wikiCategoryCatalogSchema>;

export const wikiArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  category_id: z.string(),
  body_json: z.string(),
  sort_order: z.number().int(),
  pinned: z.boolean(),
  view_count: z.number().int().nonnegative(),
  excerpt: z.string().max(L.contentPreviewExcerpt.max),
  preview_media_id: mediaIdSchema.nullable(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  updated_by: z.string().nullable(),
  updated_by_display_name: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export function wikiArticleEtag(
  record: Pick<z.infer<typeof wikiArticleSchema>, "id" | "updated_at">,
): string {
  return `"wiki-${record.id}-${record.updated_at}"`;
}

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

export const wikiArticleViewCountSchema = z.object({
  view_count: z.number().int().nonnegative(),
});

export const wikiRevisionListItemSchema = z.object({
  id: z.string(),
  article_id: z.string(),
  revision: z.number().int(),
  title: z.string(),
  edited_by: z.string(),
  edited_by_display_name: z.string().nullable(),
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
