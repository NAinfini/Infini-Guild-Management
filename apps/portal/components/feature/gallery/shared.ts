export type { GalleryItem } from "@guild/shared";

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export type UploadTask = {
  id: string;
  file: File;
  status: UploadStatus;
  caption: string;
  error?: string;
};
