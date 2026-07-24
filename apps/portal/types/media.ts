export interface ImageGridEditorItem {
  id: string;
  src?: string;
  alt?: string;
  file?: File;
}

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export type UploadTask = {
  id: string;
  file: File;
  status: UploadStatus;
  caption: string;
  error?: string;
};
