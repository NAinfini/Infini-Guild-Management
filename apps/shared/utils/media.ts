import { getMediaViewDimensions, SELECTABLE_IMAGE_TYPES } from "../constants/media";

export const FULL_IMAGE_WEBP_QUALITY = 0.92;
export const VIEW_IMAGE_WEBP_QUALITY = 0.8;

/* 存储契约固定为 Ogg 容器、Opus 编码、单声道 16 kHz。 */
const OPUS_FILE_MIME_TYPE = "audio/ogg";
const OPUS_FILE_EXTENSION = "ogg";
const OPUS_TARGET_SAMPLE_RATE = 16_000;
const OPUS_TARGET_BITRATE = 48_000;
const OPUS_TARGET_CHANNELS = 1;

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function fileNameWithExtension(name: string, extension: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${extension}`;
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value)) {
    return VIEW_IMAGE_WEBP_QUALITY;
  }
  if (value < 0.1) {
    return 0.1;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export type ImageUploadVariants = {
  full: File;
  view: File;
  fullWidth: number;
  fullHeight: number;
  viewWidth: number;
  viewHeight: number;
};

export type ImageUploadConversionOptions = {
  fullQuality?: number;
  viewQuality?: number;
  onProgress?: (percent: number) => void;
};

export type AudioConversionSupport =
  | { supported: true }
  | { supported: false; reason: string };

/*
 * 同步的门槛检查，界面在用户选文件之前就要给出答复，所以只能查「有没有 WebCodecs」
 * 这个可以同步问的条件。「这个浏览器能不能编 Opus」必须 await，留给
 * convertAudioToOpus 在真正开工前问一次——那里是异步的，问得起。
 */
export function getAudioConversionSupport(): AudioConversionSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Audio conversion is only available in browser runtime." };
  }

  if (typeof AudioEncoder === "undefined") {
    return {
      supported: false,
      reason: "This browser does not support WebCodecs audio encoding. Please use Chrome, Edge, or Firefox.",
    };
  }

  return { supported: true };
}

async function encodeWebP(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
  name: string,
): Promise<File> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create canvas context for image conversion");
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error("Failed to encode WebP image"));
    }, "image/webp", clampQuality(quality));
  });
  return new File([blob], name, { type: "image/webp", lastModified: Date.now() });
}

export async function convertImageForUpload(
  file: File,
  options: ImageUploadConversionOptions = {},
): Promise<ImageUploadVariants> {
  if (!(SELECTABLE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Image uploads must be JPEG, PNG, AVIF, or WebP");
  }

  options.onProgress?.(10);
  const bitmap = await createImageBitmap(file);
  try {
    const baseName = fileNameWithExtension(file.name, "").replace(/\.$/, "");
    const fullName = `${baseName}.full.webp`;
    const viewName = `${baseName}.view.webp`;
    const viewSize = getMediaViewDimensions(bitmap.width, bitmap.height);
    const full = file.type === "image/webp"
      ? new File([file], fullName, { type: "image/webp", lastModified: file.lastModified })
      : await encodeWebP(
          bitmap,
          bitmap.width,
          bitmap.height,
          options.fullQuality ?? FULL_IMAGE_WEBP_QUALITY,
          fullName,
        );
    options.onProgress?.(55);
    const view = await encodeWebP(
      bitmap,
      viewSize.width,
      viewSize.height,
      options.viewQuality ?? VIEW_IMAGE_WEBP_QUALITY,
      viewName,
    );
    options.onProgress?.(100);
    return {
      full,
      view,
      fullWidth: bitmap.width,
      fullHeight: bitmap.height,
      viewWidth: viewSize.width,
      viewHeight: viewSize.height,
    };
  } finally {
    bitmap.close();
  }
}

/** Sequential conversion keeps peak canvas memory bounded for large batches. */
export async function convertImagesForUpload(
  files: readonly File[],
  options: ImageUploadConversionOptions = {},
): Promise<ImageUploadVariants[]> {
  const converted: ImageUploadVariants[] = [];
  const total = Math.max(files.length, 1);

  for (const [index, file] of files.entries()) {
    converted.push(await convertImageForUpload(file, {
      fullQuality: options.fullQuality,
      viewQuality: options.viewQuality,
      onProgress: (percent) => {
        options.onProgress?.(Math.min(100, Math.round(((index + percent / 100) / total) * 100)));
      },
    }));
  }

  options.onProgress?.(100);
  return converted;
}

export function appendImageUploadVariants(formData: FormData, variants: readonly ImageUploadVariants[]): void {
  for (const image of variants) {
    formData.append("full", image.full);
    formData.append("view", image.view);
  }
}

export async function convertAudioToOpus(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<File> {
  if (!file.type.startsWith("audio/")) {
    throw new Error("Audio conversion requires an audio file");
  }

  const support = getAudioConversionSupport();
  if (!support.supported) {
    throw new Error(support.reason);
  }

  /*
   * mediabunny 只有音频转码用得到，但静态 import 会把它整个打进首屏公共包。
   * 动态加载让它变成独立 chunk，只在用户真的上传音频时才下载。
   */
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, OggOutputFormat, Output, canEncodeAudio } =
    await import("mediabunny");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  /* 必须读取实际音轨编码；只有 Ogg 容器中的 Opus 轨道可以直接复用。 */
  const track = await input.getPrimaryAudioTrack();
  if (!track) {
    throw new Error("This file contains no audio track.");
  }
  if ((await track.getCodec()) === "opus" && file.type.startsWith(OPUS_FILE_MIME_TYPE)) {
    onProgress?.(100);
    return file;
  }

  if (!(await canEncodeAudio("opus", {
    numberOfChannels: OPUS_TARGET_CHANNELS,
    sampleRate: OPUS_TARGET_SAMPLE_RATE,
    bitrate: OPUS_TARGET_BITRATE,
  }))) {
    throw new Error("This browser cannot encode Opus audio. Please use Chrome, Edge, or Firefox.");
  }

  const target = new BufferTarget();
  const output = new Output({ format: new OggOutputFormat(), target });
  const conversion = await Conversion.init({
    input,
    output,
    audio: {
      codec: "opus",
      numberOfChannels: OPUS_TARGET_CHANNELS,
      sampleRate: OPUS_TARGET_SAMPLE_RATE,
      bitrate: OPUS_TARGET_BITRATE,
      /*
       * 能走到这里只有两种情况：编码根本不是 Opus，或者是 Opus 但装错了容器
       * （比如 WebM/Opus）。后一种只需要换个封装，参数对得上时 mediabunny 会
       * 直接搬运数据包而不重编——省掉一次没有必要的有损。写死 true 的话，
       * 每一个 WebM/Opus 都要白白再压一遍。
       */
      forceTranscode: false,
    },
  });
  if (!conversion.isValid) {
    throw new Error("This audio file cannot be converted to Opus.");
  }

  /* 必须在 execute 之前挂上，否则 mediabunny 根本不计算进度。 */
  conversion.onProgress = (progress: number) => onProgress?.(Math.min(99, Math.round(progress * 100)));
  await conversion.execute();

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Audio conversion produced empty output.");
  }

  onProgress?.(100);
  return new File([buffer], fileNameWithExtension(file.name, OPUS_FILE_EXTENSION), {
    type: OPUS_FILE_MIME_TYPE,
    lastModified: Date.now(),
  });
}
