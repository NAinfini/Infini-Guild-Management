import {
  createWikiArticleSchema,
  createWikiCategorySchema,
  updateWikiArticleSchema,
  updateWikiCategorySchema,
  type WikiArticle,
  type WikiCategory,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { convertImageToWebP } from "../../utils/media-convert";

export type CreateWikiCategoryPayload = z.input<typeof createWikiCategorySchema>;
export type UpdateWikiCategoryPayload = z.input<typeof updateWikiCategorySchema>;
export type CreateWikiArticlePayload = z.input<typeof createWikiArticleSchema>;
export type UpdateWikiArticlePayload = z.input<typeof updateWikiArticleSchema>;

export function createWikiCategory(payload: CreateWikiCategoryPayload): Promise<WikiCategory> {
  const bodyJson = createWikiCategorySchema.parse(payload);
  return apiRequest<WikiCategory>("/api/wiki/categories", {
    method: "POST",
    bodyJson,
  });
}

export function updateWikiCategory(id: string, payload: UpdateWikiCategoryPayload): Promise<WikiCategory> {
  const bodyJson = updateWikiCategorySchema.parse(payload);
  return apiRequest<WikiCategory>(`/api/wiki/categories/${id}`, {
    method: "PATCH",
    bodyJson,
  });
}

export function deleteWikiCategory(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/wiki/categories/${id}`, {
    method: "DELETE",
  });
}

export function createWikiArticle(payload: CreateWikiArticlePayload): Promise<WikiArticle> {
  const bodyJson = createWikiArticleSchema.parse(payload);
  return apiRequest<WikiArticle>("/api/wiki/articles", {
    method: "POST",
    bodyJson,
  });
}

export function updateWikiArticle(id: string, payload: UpdateWikiArticlePayload, ifMatch?: string): Promise<WikiArticle> {
  const bodyJson = updateWikiArticleSchema.parse(payload);
  return apiRequest<WikiArticle>(`/api/wiki/articles/${id}`, {
    method: "PATCH",
    bodyJson,
    ifMatch,
  });
}

export function deleteWikiArticle(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/wiki/articles/${id}/permanent`, {
    method: "DELETE",
  });
}

export async function uploadWikiArticleImages(
  articleId: string,
  files: File[],
): Promise<{ keys: string[] }> {
  const converted = await Promise.all(files.map(convertImageToWebP));
  const formData = new FormData();
  for (const file of converted) {
    formData.append("files", file);
  }
  return apiRequest<{ keys: string[] }>(`/api/wiki/articles/${articleId}/images`, {
    method: "POST",
    body: formData,
  });
}
