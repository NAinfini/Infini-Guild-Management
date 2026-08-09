import {
  batchUpdateWikiCategoriesSchema,
  createWikiArticleSchema,
  createWikiCategorySchema,
  updateWikiArticleSchema,
  wikiCategorySchema,
  type BatchUpdateWikiCategoryItem,
  type WikiArticle,
  type WikiCategory,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { appendImageUploadVariants, convertImagesForUpload } from "@guild/shared/utils/media";

export type CreateWikiCategoryPayload = z.input<typeof createWikiCategorySchema>;
export type CreateWikiArticlePayload = z.input<typeof createWikiArticleSchema>;
export type UpdateWikiArticlePayload = z.input<typeof updateWikiArticleSchema>;

export function createWikiCategory(payload: CreateWikiCategoryPayload): Promise<WikiCategory> {
  const bodyJson = createWikiCategorySchema.parse(payload);
  return apiRequest<WikiCategory>("/api/wiki/categories", {
    method: "POST",
    bodyJson,
  });
}

/**
 * 一次提交多行分类改动，服务端整批落库或整批不落库，返回落库之后的完整目录。
 * 任何一行不合法（父级不存在、两层嵌套、id 不存在）都会整批回退——不要在这里
 * 剔掉出问题的那一行再重发，那会把冲突吞掉，用户看到的顺序就不是库里的顺序。
 */
export async function batchUpdateWikiCategories(
  updates: BatchUpdateWikiCategoryItem[],
): Promise<WikiCategory[]> {
  const bodyJson = batchUpdateWikiCategoriesSchema.parse({ updates });
  return wikiCategorySchema.array().parse(await apiRequest("/api/wiki/categories/batch", {
    method: "PATCH",
    bodyJson,
  }));
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

export function restoreWikiArticleRevision(articleId: string, revision: number): Promise<WikiArticle> {
  return apiRequest<WikiArticle>(`/api/wiki/articles/${articleId}/revisions/${revision}/restore`, {
    method: "POST",
  });
}

export async function uploadWikiArticleImages(
  articleId: string,
  files: File[],
): Promise<{ media_ids: string[] }> {
  const converted = await convertImagesForUpload(files);
  const formData = new FormData();
  appendImageUploadVariants(formData, converted);
  return apiRequest<{ media_ids: string[] }>(`/api/wiki/articles/${articleId}/images`, {
    method: "POST",
    body: formData,
  });
}
