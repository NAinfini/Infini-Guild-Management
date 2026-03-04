import type { GalleryItem } from "@guild/shared";
import { apiRequest } from "../client";

export function uploadGalleryImages(
  files: File[],
  captions: Array<string | undefined> = [],
): Promise<{ data: GalleryItem[] }> {
  const formData = new FormData();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) {
      continue;
    }
    formData.append("files", file);
    formData.append("captions", captions[index] ?? "");
  }

  return apiRequest<{ data: GalleryItem[] }>("/api/gallery/images", {
    method: "POST",
    body: formData,
  });
}

export function createGalleryVideo(payload: {
  type: "video";
  url: string;
  caption?: string;
}): Promise<GalleryItem> {
  return apiRequest<GalleryItem>("/api/gallery/videos", {
    method: "POST",
    bodyJson: payload,
  });
}

export function deleteGalleryItem(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/gallery/${id}`, {
    method: "DELETE",
  });
}
