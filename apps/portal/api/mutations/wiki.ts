import type { WikiArticle, WikiCategory } from "@guild/shared";
import { apiRequest } from "../client";

export function createWikiCategory(payload: {
  name: string;
  slug?: string;
  sort_order?: number;
  parent_id?: string;
}): Promise<WikiCategory> {
  return apiRequest<WikiCategory>("/api/wiki/categories", {
    method: "POST",
    bodyJson: payload,
  });
}

export function updateWikiCategory(id: string, payload: Record<string, unknown>): Promise<WikiCategory> {
  return apiRequest<WikiCategory>(`/api/wiki/categories/${id}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function deleteWikiCategory(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/wiki/categories/${id}`, {
    method: "DELETE",
  });
}

export function createWikiArticle(payload: {
  title: string;
  slug?: string;
  category_id: string;
  body_json: string;
  sort_order?: number;
}): Promise<WikiArticle> {
  return apiRequest<WikiArticle>("/api/wiki/articles", {
    method: "POST",
    bodyJson: payload,
  });
}

export function updateWikiArticle(id: string, payload: Record<string, unknown>): Promise<WikiArticle> {
  return apiRequest<WikiArticle>(`/api/wiki/articles/${id}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function archiveWikiArticle(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/wiki/articles/${id}`, {
    method: "DELETE",
  });
}

export function rollbackWikiArticleVersion(articleId: string, versionId: string): Promise<WikiArticle> {
  return apiRequest<WikiArticle>(`/api/wiki/articles/${articleId}/versions/${versionId}/rollback`, {
    method: "POST",
  });
}

export function uploadWikiArticleImages(
  articleId: string,
  files: File[],
): Promise<{ keys: string[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return apiRequest<{ keys: string[] }>(`/api/wiki/articles/${articleId}/images`, {
    method: "POST",
    body: formData,
  });
}
