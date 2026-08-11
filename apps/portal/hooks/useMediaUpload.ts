import { useCallback, useMemo, useRef, useState } from "react";
import {
  convertAudioToOpus,
  getAudioConversionSupport,
} from "../utils/upload-media";

type UploadContext = {
  onUploadProgress: (percent: number) => void;
};

type UploadFunction<TResult> = (files: File[], context: UploadContext) => Promise<TResult>;

type UseMediaUploadOptions = {
  maxFiles?: number;
  /** Images use WebP, audio uses Opus, and raw media bypasses conversion. */
  mediaType?: "image" | "audio" | "raw";
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
  const mediaType = options.mediaType ?? "raw";
  const supportError = useMemo(() => {
    if (mediaType !== "audio") {
      return null;
    }
    const support = getAudioConversionSupport();
    return support.supported ? null : support.reason;
  }, [mediaType]);

  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const inFlightRef = useRef(false);

  const selectFiles = useCallback(
    (source: FileList | File[] | null) => {
      const selected = source ? Array.from(source) : [];
      const limited = options.maxFiles === undefined
        ? selected
        : selected.slice(0, options.maxFiles);
      setError(null);
      if (supportError) {
        setFiles([]);
        setConversionProgress(0);
        setUploadProgress(0);
        setError(supportError);
        return;
      }
      setFiles(limited);
      setConversionProgress(0);
      setUploadProgress(0);
    },
    [options.maxFiles, supportError],
  );

  const clearFiles = useCallback(() => {
    setFiles([]);
    setConversionProgress(0);
    setUploadProgress(0);
  }, []);

  const preprocessFiles = useCallback(async () => {
    if (mediaType !== "audio") {
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

      converted.push(await convertAudioToOpus(file, updateProgress));
    }
    setConversionProgress(100);
    return converted;
  }, [files, mediaType]);

  const upload = useCallback(async () => {
    if (files.length === 0) {
      setError("No files selected");
      return null;
    }
    if (supportError) {
      setError(supportError);
      return null;
    }
    if (inFlightRef.current) {
      return null;
    }

    inFlightRef.current = true;
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
      inFlightRef.current = false;
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
      inFlightRef.current = false;
      setIsConverting(false);
      setIsUploading(false);
    }
  }, [files, preprocessFiles, supportError, uploadFn]);

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
