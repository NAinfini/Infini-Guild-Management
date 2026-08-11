import {
  mediaIdsResponseSchema,
  wikiArticleSchema,
  wikiCategorySchema,
  wikiRevisionListItemSchema,
  wikiRevisionSchema,
  type PaginatedResponse,
  type WikiArticle,
  type WikiCategory,
  type WikiRevision,
  type WikiRevisionListItem,
} from "@guild/shared";
import { z } from "zod";

const wikiArticlePageSchema = z.object({
  data: z.array(wikiArticleSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
});
const okSchema = z.object({ ok: z.literal(true) });

export function presentWikiCategories(value: unknown): WikiCategory[] {
  return z.array(wikiCategorySchema).parse(value);
}

export function presentWikiCategory(value: unknown): WikiCategory {
  return wikiCategorySchema.parse(value);
}

export function presentWikiArticlePage(value: unknown): PaginatedResponse<WikiArticle> {
  return wikiArticlePageSchema.parse(value);
}

export function presentWikiArticle(value: unknown): WikiArticle {
  return wikiArticleSchema.parse(value);
}

export function presentWikiRevisions(value: unknown): WikiRevisionListItem[] {
  return z.array(wikiRevisionListItemSchema).parse(value);
}

export function presentWikiRevision(value: unknown): WikiRevision {
  return wikiRevisionSchema.parse(value);
}

export function presentWikiMediaIds(value: unknown): { media_ids: string[] } {
  return mediaIdsResponseSchema.parse(value);
}

export function presentWikiOk(value: unknown): { ok: true } {
  return okSchema.parse(value);
}
