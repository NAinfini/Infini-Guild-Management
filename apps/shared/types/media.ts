export interface ImageGridEditorItem {
  /** Unique key for this image (e.g. URL or storage key) */
  id: string;
  /** Display URL — if falsy, shows the id as a placeholder label */
  src?: string;
  /** Alt text */
  alt?: string;
  /** Optional: the converted File object for upload */
  file?: File;
}
