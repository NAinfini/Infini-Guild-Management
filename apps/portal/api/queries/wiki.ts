import {
  wikiCategoryCatalogSchema,
  type PaginatedResponse,
  type WikiArticle,
  type WikiCategoryCatalog,
  type WikiRevision,
  type WikiRevisionListItem,
} from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";
export type WikiSort = "curated" | "updated_desc" | "updated_asc";

export async function fetchWikiCategories(): Promise<WikiCategoryCatalog> {
  return wikiCategoryCatalogSchema.parse(await apiRequest("/api/wiki/categories"));
}

export function fetchWikiArticles(params: {
  page?: number;
  limit?: number;
  category_id?: string | string[];
  archived?: boolean;
  pinned?: boolean;
  search?: string;
  sort?: WikiSort;
}): Promise<PaginatedResponse<WikiArticle>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? LIMITS.pagination.wiki));
  query.set("sort", params.sort ?? "curated");
  const categoryIds = typeof params.category_id === "string"
    ? [params.category_id]
    : params.category_id ?? [];
  for (const categoryId of categoryIds) {
    if (categoryId) query.append("category_id", categoryId);
  }
  if (params.archived !== undefined) query.set("archived", String(params.archived));
  if (params.pinned !== undefined) query.set("pinned", String(params.pinned));
  if (params.search) query.set("search", params.search);

  return apiRequest<PaginatedResponse<WikiArticle>>(`/api/wiki/articles?${query.toString()}`);
}

export function fetchWikiArticleBySlug(slug: string): Promise<WikiArticle> {
  return apiRequest<WikiArticle>(`/api/wiki/articles/${slug}`);
}

export function recordWikiArticleView(slug: string): Promise<{ view_count: number }> {
  return apiRequest<{ view_count: number }>(`/api/wiki/articles/${slug}/view`, { method: "POST" });
}

export function fetchWikiArticleRevisions(articleId: string): Promise<WikiRevisionListItem[]> {
  return apiRequest<WikiRevisionListItem[]>(`/api/wiki/articles/${articleId}/revisions`);
}

export function fetchWikiArticleRevision(articleId: string, revision: number): Promise<WikiRevision> {
  return apiRequest<WikiRevision>(`/api/wiki/articles/${articleId}/revisions/${revision}`);
}
