import type { PaginatedResponse, WikiArticle, WikiArticleVersion, WikiCategory } from "@guild/shared";
import { apiRequest } from "../client";

export function fetchWikiCategories(): Promise<WikiCategory[]> {
  return apiRequest<WikiCategory[]>("/api/wiki/categories");
}

export function fetchWikiArticles(params: {
  page?: number;
  limit?: number;
  category_id?: string;
  archived?: boolean;
  search?: string;
}): Promise<PaginatedResponse<WikiArticle>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? 50));
  if (params.category_id) query.set("category_id", params.category_id);
  if (params.archived !== undefined) query.set("archived", String(params.archived));
  if (params.search) query.set("search", params.search);

  return apiRequest<PaginatedResponse<WikiArticle>>(`/api/wiki/articles?${query.toString()}`);
}

export function fetchWikiArticleBySlug(slug: string): Promise<WikiArticle> {
  return apiRequest<WikiArticle>(`/api/wiki/articles/${slug}`);
}

export function fetchWikiArticleVersions(params: {
  articleId: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<WikiArticleVersion>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? 20));

  return apiRequest<PaginatedResponse<WikiArticleVersion>>(
    `/api/wiki/articles/${params.articleId}/versions?${query.toString()}`,
  );
}

export function compareWikiArticleVersions(params: {
  articleId: string;
  fromVersionId: string;
  toVersionId: string;
}): Promise<{
  from_version: WikiArticleVersion;
  to_version: WikiArticleVersion;
  changed_fields: string[];
}> {
  const query = new URLSearchParams({
    from_version_id: params.fromVersionId,
    to_version_id: params.toVersionId,
  });

  return apiRequest<{
    from_version: WikiArticleVersion;
    to_version: WikiArticleVersion;
    changed_fields: string[];
  }>(`/api/wiki/articles/${params.articleId}/versions/compare?${query.toString()}`);
}
