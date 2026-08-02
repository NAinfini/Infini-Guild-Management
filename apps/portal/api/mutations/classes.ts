import {
  LIMITS,
  classCatalogItemSchema,
  type ClassCatalogItem,
  type CreateClassCatalogItemInput,
  type UpdateClassCatalogItemInput,
} from "@guild/shared";
import { convertImageToWebP } from "@guild/shared/utils/media";
import { apiRequest } from "../client";

export async function createClassCatalogItem(
  input: CreateClassCatalogItemInput,
): Promise<ClassCatalogItem> {
  return classCatalogItemSchema.parse(await apiRequest("/api/classes", {
    method: "POST",
    bodyJson: input,
  }));
}

export async function updateClassCatalogItem(
  id: string,
  input: UpdateClassCatalogItemInput,
): Promise<ClassCatalogItem> {
  return classCatalogItemSchema.parse(await apiRequest(`/api/classes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    bodyJson: input,
  }));
}

/**
 * 整表重排。`order` 必须覆盖当前目录里的每一个职业 id，服务端对不上会回 409，
 * 客户端要重新拉一次目录再排——不要在这里补齐或裁剪，那会把冲突吞掉。
 */
export async function reorderClassCatalog(order: string[]): Promise<ClassCatalogItem[]> {
  return classCatalogItemSchema.array().parse(await apiRequest("/api/classes/reorder", {
    method: "PATCH",
    bodyJson: { order },
  }));
}

export async function uploadClassCatalogIcon(
  id: string,
  source: File,
  onProgress?: (percent: number) => void,
): Promise<ClassCatalogItem> {
  const file = await convertImageToWebP(source, onProgress, {
    forceWebP: true,
    maxDimension: 512,
    quality: 0.84,
  });
  if (file.type !== "image/webp") {
    throw new Error("Class icon conversion did not produce WebP");
  }
  if (file.size > LIMITS.media.maxFileSize.classIcon) {
    throw new Error("Converted class icon exceeds 512 KiB");
  }

  const form = new FormData();
  form.append("file", file);
  return classCatalogItemSchema.parse(await apiRequest(
    `/api/classes/${encodeURIComponent(id)}/icon`,
    { method: "POST", body: form },
  ));
}

export async function removeClassCatalogIcon(id: string): Promise<ClassCatalogItem> {
  return classCatalogItemSchema.parse(await apiRequest(
    `/api/classes/${encodeURIComponent(id)}/icon`,
    { method: "DELETE" },
  ));
}

export function deleteClassCatalogItem(id: string): Promise<{ deleted: true }> {
  return apiRequest(`/api/classes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
