import { useCallback, useMemo, useState } from "react";
import {
  DEFAULT_IMAGE_WEBP_QUALITY,
  convertAudioToOpus,
  convertImageToWebP,
  getAudioConversionSupport,
} from "@guild/shared/utils/media";

type UploadContext = {
  onUploadProgress: (percent: number) => void;
};

type UploadFunction<TResult> = (files: File[], context: UploadContext) => Promise<TResult>;

type UseMediaUploadOptions = {
  maxFiles?: number;
  maxFileSizeBytes?: number;
  mediaType?: "image" | "audio" | "raw";
  convertImagesToWebp?: boolean;
  imageWebpQuality?: number;
  convertAudioToOpus?: boolean;
};

type UseMediaUploadState<TResult> = {
  files: File[];
  supportError: string | null;
  isUploading: boolean;
  isConverting: boolean;
  conversionProgress: number;
  uploadProgress: number;
  error: string | null;
  result: TResult | null;
  selectFiles: (source: FileList | File[] | null) => void;
  clearFiles: () => void;
  upload: () => Promise<TResult | null>;
  reset: () => void;
};

export type { UseMediaUploadState };

export function useMediaUpload<TResult>(
  uploadFn: UploadFunction<TResult>,
  options: UseMediaUploadOptions = {},
): UseMediaUploadState<TResult> {
  const maxFiles = options.maxFiles ?? 10;
  const mediaType = options.mediaType ?? "raw";
  const convertImagesToWebp = options.convertImagesToWebp ?? true;
  const imageWebpQuality = options.imageWebpQuality ?? DEFAULT_IMAGE_WEBP_QUALITY;
  const convertAudioToOpusEnabled = options.convertAudioToOpus ?? true;
  const supportError = useMemo(() => {
    if (mediaType !== "audio" || !convertAudioToOpusEnabled) {
      return null;
    }
    const support = getAudioConversionSupport();
    return support.supported ? null : support.reason;
  }, [convertAudioToOpusEnabled, mediaType]);

  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TResult | null>(null);

  const selectFiles = useCallback(
    (source: FileList | File[] | null) => {
      const selected = source ? Array.from(source) : [];
      const limited = selected.slice(0, maxFiles);
      const oversized = limited.filter(
        (file) => options.maxFileSizeBytes !== undefined && file.size > options.maxFileSizeBytes,
      );
      if (oversized.length > 0) {
        setError(`File(s) too large: ${oversized.map((file) => file.name).join(", ")}`);
      } else {
        setError(null);
      }
      const valid = limited.filter(
        (file) => options.maxFileSizeBytes === undefined || file.size <= options.maxFileSizeBytes,
      );
      if (supportError) {
        setFiles([]);
        setConversionProgress(0);
        setUploadProgress(0);
        setError(supportError);
        return;
      }
      setFiles(valid);
      setConversionProgress(0);
      setUploadProgress(0);
    },
    [maxFiles, options.maxFileSizeBytes, supportError],
  );

  const clearFiles = useCallback(() => {
    setFiles([]);
    setConversionProgress(0);
    setUploadProgress(0);
  }, []);

  const preprocessFiles = useCallback(async () => {
    if (mediaType === "raw") {
      setConversionProgress(100);
      return files;
    }

    setIsConverting(true);
    const converted: File[] = [];
    for (const [index, file] of files.entries()) {
      const offset = (index / files.length) * 100;
      const scale = 1 / files.length;
      const updateProgress = (percent: number) => {
        setConversionProgress(Math.min(100, Math.round(offset + percent * scale)));
      };

      if (mediaType === "image" && convertImagesToWebp) {
        converted.push(await convertImageToWebP(file, updateProgress, { quality: imageWebpQuality }));
        continue;
      }
      if (mediaType === "audio" && convertAudioToOpusEnabled) {
        converted.push(await convertAudioToOpus(file, updateProgress));
        continue;
      }
      converted.push(file);
      updateProgress(100);
    }
    setConversionProgress(100);
    return converted;
  }, [convertAudioToOpusEnabled, convertImagesToWebp, files, imageWebpQuality, mediaType]);

  const upload = useCallback(async () => {
    if (files.length === 0) {
      setError("No files selected");
      return null;
    }
    if (supportError) {
      setError(supportError);
      return null;
    }
    if (isUploading) {
      return null;
    }

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);
    setConversionProgress(0);

    let preparedFiles: File[] = [];
    try {
      preparedFiles = await preprocessFiles();
    } catch (conversionError) {
      const message = conversionError instanceof Error ? conversionError.message : "Media conversion failed";
      setError(`Conversion failed: ${message}`);
      setIsConverting(false);
      setIsUploading(false);
      return null;
    }

    setIsConverting(false);

    try {
      const uploadResult = await uploadFn(preparedFiles, {
        onUploadProgress: (percent) => setUploadProgress(Math.min(100, Math.max(0, Math.round(percent)))),
      });
      setUploadProgress(100);
      setResult(uploadResult);
      setFiles([]);
      return uploadResult;
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setError(`Upload failed: ${message}`);
      return null;
    } finally {
      setIsConverting(false);
      setIsUploading(false);
    }
  }, [files, isUploading, preprocessFiles, supportError, uploadFn]);

  const reset = useCallback(() => {
    setFiles([]);
    setIsUploading(false);
    setIsConverting(false);
    setConversionProgress(0);
    setUploadProgress(0);
    setError(null);
    setResult(null);
  }, []);

  return useMemo(
    () => ({
      files,
      supportError,
      isUploading,
      isConverting,
      conversionProgress,
      uploadProgress,
      error,
      result,
      selectFiles,
      clearFiles,
      upload,
      reset,
    }),
    [
      clearFiles,
      conversionProgress,
      error,
      files,
      isConverting,
      isUploading,
      reset,
      result,
      selectFiles,
      supportError,
      upload,
      uploadProgress,
    ],
  );
}
