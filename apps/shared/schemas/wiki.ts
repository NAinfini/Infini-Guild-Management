import { z } from "zod";
import { LIMITS } from "../config/limits";

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
  body_json: z.string().min(L.wikiArticleBody.min).max(L.wikiArticleBody.max),
  sort_order: z.number().int().default(0),
  pinned: z.boolean().default(false),
});

export const updateWikiArticleSchema = createWikiArticleSchema.partial().extend({
  archived_at: z.string().datetime().nullable().optional(),
});
