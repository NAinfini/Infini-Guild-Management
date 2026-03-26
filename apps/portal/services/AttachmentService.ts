import { useEffect, useRef } from "react";
import { type ImageGridEditorItem } from "@infini-dev-kit/react";
import { convertImageToWebP } from "@infini-dev-kit/react";

export type AttachmentItem = ImageGridEditorItem;

function createAttachmentId() {
  return `attachment-${crypto.randomUUID()}`;
}

export class AttachmentService {
  private readonly blobUrls = new Set<string>();

  async prepareFiles(files: File[]): Promise<AttachmentItem[]> {
    const preparedItems: AttachmentItem[] = [];

    for (const file of files) {
      const preparedFile = file.type.startsWith("image/")
        ? await convertImageToWebP(file, undefined, { quality: 0.8 })
        : file;
      const blobUrl = URL.createObjectURL(preparedFile);
      this.blobUrls.add(blobUrl);
      preparedItems.push({
        id: createAttachmentId(),
        src: blobUrl,
        alt: preparedFile.name,
        file: preparedFile,
      });
    }

    return preparedItems;
  }

  extractNewFiles(items: AttachmentItem[]): File[] {
    return items.flatMap((item) => (item.file ? [item.file] : []));
  }

  extractExistingUrls(items: AttachmentItem[]): string[] {
    return items.flatMap((item) => (!item.file && item.src ? [item.src] : []));
  }

  releaseItem(item: AttachmentItem) {
    if (!item.src?.startsWith("blob:")) {
      return;
    }
    URL.revokeObjectURL(item.src);
    this.blobUrls.delete(item.src);
  }

  releaseItems(items: AttachmentItem[]) {
    for (const item of items) {
      this.releaseItem(item);
    }
  }

  cleanup() {
    for (const blobUrl of this.blobUrls) {
      URL.revokeObjectURL(blobUrl);
    }
    this.blobUrls.clear();
  }
}

export function useAttachmentService() {
  const serviceRef = useRef<AttachmentService | null>(null);

  if (!serviceRef.current) {
    serviceRef.current = new AttachmentService();
  }

  useEffect(() => {
    return () => {
      serviceRef.current?.cleanup();
    };
  }, []);

  return serviceRef.current;
}
