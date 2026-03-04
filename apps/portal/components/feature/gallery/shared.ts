import type { fetchGallery } from "../../../api/queries/gallery";

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export type UploadTask = {
  id: string;
  file: File;
  status: UploadStatus;
  caption: string;
  error?: string;
};

export type GalleryItem = Awaited<ReturnType<typeof fetchGallery>>["data"][number];
