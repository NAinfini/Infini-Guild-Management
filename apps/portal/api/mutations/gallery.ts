import { type GalleryItem, createGalleryItemSchema, updateGalleryItemSchema } from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { appendImageUploadVariants, convertImagesForUpload } from "../../utils/upload-media";

export type CreateGalleryVideoPayload = z.input<typeof createGalleryItemSchema>;
export type UpdateGalleryItemPayload = z.input<typeof updateGalleryItemSchema>;
export type GalleryImageMetadata = Readonly<{ title: string; description?: string }>;

export async function uploadGalleryImages(
  files: File[],
  metadata: readonly GalleryImageMetadata[],
  options: { signal?: AbortSignal } = {},
): Promise<{ data: GalleryItem[] }> {
  options.signal?.throwIfAborted();
  const converted = await convertImagesForUpload(files.filter(Boolean));
  options.signal?.throwIfAborted();
  const formData = new FormData();
  for (let index = 0; index < converted.length; index += 1) {
    const image = converted[index];
    if (!image) continue;
    appendImageUploadVariants(formData, [image]);
    const itemMetadata = metadata[index];
    if (!itemMetadata) throw new TypeError("Gallery image metadata must align with files");
    formData.append("titles", itemMetadata.title);
    formData.append("descriptions", itemMetadata.description ?? "");
  }

  return apiRequest<{ data: GalleryItem[] }>("/api/gallery/images", {
    method: "POST",
    body: formData,
    signal: options.signal,
  });
}

export function createGalleryVideo(payload: CreateGalleryVideoPayload): Promise<GalleryItem> {
  const bodyJson = createGalleryItemSchema.parse(payload);
  return apiRequest<GalleryItem>("/api/gallery/videos", {
    method: "POST",
    bodyJson,
  });
}

export function deleteGalleryItem(id: string, ifMatch: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/gallery/${id}`, {
    method: "DELETE",
    ifMatch,
  });
}

export function updateGalleryItem(
  id: string,
  payload: UpdateGalleryItemPayload,
  ifMatch: string,
): Promise<GalleryItem> {
  const bodyJson = updateGalleryItemSchema.parse(payload);
  return apiRequest<GalleryItem>(`/api/gallery/${id}`, {
    method: "PATCH",
    bodyJson,
    ifMatch,
  });
}

export function batchDeleteGalleryItems(ids: string[]): Promise<{ ok: true; deleted: number }> {
  return apiRequest<{ ok: true; deleted: number }>("/api/gallery/batch-delete", {
    method: "POST",
    bodyJson: { ids },
  });
}

export function likeGalleryItem(id: string): Promise<{ liked: true; like_count: number }> {
  return apiRequest<{ liked: true; like_count: number }>(`/api/gallery/${id}/like`, { method: "PUT" });
}

export function unlikeGalleryItem(id: string): Promise<{ liked: false; like_count: number }> {
  return apiRequest<{ liked: false; like_count: number }>(`/api/gallery/${id}/like`, { method: "DELETE" });
}
