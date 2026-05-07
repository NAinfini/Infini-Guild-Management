import type { PaginatedResponse, WikiArticle, WikiCategory } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";

export function fetchWikiCategories(): Promise<WikiCategory[]> {
  return apiRequest<WikiCategory[]>("/api/wiki/categories");
}

export function fetchWikiArticles(params: {
  page?: number;
  limit?: number;
  category_id?: string;
  archived?: boolean;
  pinned?: boolean;
  search?: string;
}): Promise<PaginatedResponse<WikiArticle>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? LIMITS.pagination.wiki));
  if (params.category_id) query.set("category_id", params.category_id);
  if (params.archived !== undefined) query.set("archived", String(params.archived));
  if (params.pinned !== undefined) query.set("pinned", String(params.pinned));
  if (params.search) query.set("search", params.search);

  return apiRequest<PaginatedResponse<WikiArticle>>(`/api/wiki/articles?${query.toString()}`);
}

export function fetchWikiArticleBySlug(slug: string): Promise<WikiArticle> {
  return apiRequest<WikiArticle>(`/api/wiki/articles/${slug}`);
}
