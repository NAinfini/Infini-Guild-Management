import { type GalleryItem, createGalleryItemSchema } from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { appendImageUploadVariants, convertImagesForUpload } from "@guild/shared/utils/media";

export type CreateGalleryVideoPayload = z.input<typeof createGalleryItemSchema>;

export async function uploadGalleryImages(
  files: File[],
  captions: Array<string | undefined> = [],
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
    formData.append("captions", captions[index] ?? "");
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

export function deleteGalleryItem(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/gallery/${id}`, {
    method: "DELETE",
  });
}

export function batchDeleteGalleryItems(ids: string[]): Promise<{ ok: true; deleted: number }> {
  return apiRequest<{ ok: true; deleted: number }>("/api/gallery/batch-delete", {
    method: "POST",
    bodyJson: { ids },
  });
}
