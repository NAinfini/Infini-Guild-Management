import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  OggOutputFormat,
  Output,
  canEncodeAudio,
} from "mediabunny";

export const DEFAULT_IMAGE_WEBP_QUALITY = 0.8;

/*
 * 存下来的语音只有一种样子：Ogg 容器、Opus 编码、单声道 16 kHz。
 *
 * 以前是拿 MediaRecorder 现录现编，容器还要跟浏览器协商——Chromium 只给 WebM，
 * Firefox 才给 Ogg，于是同一段音频在不同浏览器上落库成不同格式，服务端只好把
 * 两个容器都收下。现在编码走 WebCodecs（mediabunny 负责封装），容器由我们指定，
 * 结果与浏览器无关，服务端也就能收窄到 audio/ogg 这一种。
 */
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
    return DEFAULT_IMAGE_WEBP_QUALITY;
  }
  if (value < 0.1) {
    return 0.1;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/**
 * 转成 WebP 反而会丢信息的两类图，一律原样存。理由见 convertImageToWebP 里的注释；
 * 服务端 media.ts 的白名单按同一份名单开口子。
 */
export const LOSSLESS_PASSTHROUGH_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/gif",
  "image/svg+xml",
]);

export type ImageConversionOptions = {
  quality?: number;
  /**
   * Always emit WebP even when the encoded file is larger. Intended for media
   * slots whose server contract deliberately accepts WebP only.
   */
  forceWebP?: boolean;
  /** Resize proportionally so neither edge exceeds this number of pixels. */
  maxDimension?: number;
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

export async function convertImageToWebP(
  file: File,
  onProgress?: (percent: number) => void,
  options: ImageConversionOptions = {},
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Image conversion requires an image file");
  }

  const forceWebP = options.forceWebP ?? false;
  const maxDimension = options.maxDimension === undefined
    ? null
    : Math.max(1, Math.floor(options.maxDimension));

  if (file.type === "image/webp" && maxDimension === null) {
    onProgress?.(100);
    return file;
  }

  /*
   * 明写的两个例外，forceWebP 也压不过去——因为这里转过去就是有损信息，
   * 而不是「换个编码」：
   *
   * - GIF：createImageBitmap 只解第一帧，重编码会把动画悄悄丢掉。
   * - SVG：矢量图栅格化之后就不能再无级缩放了。
   *
   * 别处一律 WebP，这两类原样存。服务端白名单里同样开着这两个口子，
   * 两边的理由写的是同一条。
   */
  if (LOSSLESS_PASSTHROUGH_IMAGE_TYPES.has(file.type)) {
    onProgress?.(100);
    return file;
  }

  onProgress?.(10);
  const bitmap = await createImageBitmap(file);
  onProgress?.(35);
  const scale = maxDimension === null
    ? 1
    : Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

  if (
    file.type === "image/webp"
    && targetWidth === bitmap.width
    && targetHeight === bitmap.height
  ) {
    bitmap.close();
    onProgress?.(100);
    return file;
  }

  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create canvas context for image conversion");
  }

  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();
  onProgress?.(70);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (nextBlob) => {
        if (!nextBlob) {
          reject(new Error("Failed to encode WebP image"));
          return;
        }
        resolve(nextBlob);
      },
      "image/webp",
      clampQuality(options.quality ?? DEFAULT_IMAGE_WEBP_QUALITY),
    );
  });
  /*
   * 重编码有可能变大——本来就压得很好的 JPEG，或者颜色很少的平涂 PNG。
   * 单看省空间当然是留小的那个，但上传路径一律传 forceWebP：留下来的原图
   * 过不了服务端白名单。这条分支现在只服务于不面向上传的调用方。
   */
  if (!forceWebP && blob.size >= file.size) {
    onProgress?.(100);
    return file;
  }

  onProgress?.(100);

  return new File([blob], fileNameWithExtension(file.name, "webp"), {
    type: "image/webp",
    lastModified: Date.now(),
  });
}

export type UploadConversionOptions = {
  /** WebP quality for images. Defaults to DEFAULT_IMAGE_WEBP_QUALITY. */
  imageQuality?: number;
  /** Overall progress across the whole batch, 0-100. */
  onProgress?: (percent: number) => void;
};

/**
 * The single conversion entry point for uploads: an image becomes WebP, audio
 * becomes Opus, anything else passes through untouched.
 *
 * Every upload path goes through here rather than reaching for a per-format
 * converter. Two implementations of this logic used to sit side by side, which is
 * how the audio path ended up producing files named `.opus` that were really
 * WebM, and how different flows drifted onto different WebP quality settings.
 */
export async function convertFileForUpload(
  file: File,
  options: UploadConversionOptions = {},
): Promise<File> {
  if (file.type.startsWith("image/")) {
    /*
     * forceWebP 恒为真：服务端的白名单只认 WebP 加上面那两个例外，所以「转出来
     * 反而更大就留原图」这条省空间的旧规则在这里必须让位——留下的原图会被服务端
     * 直接拒掉，用户看到的是一个莫名其妙的上传失败。
     */
    return convertImageToWebP(file, options.onProgress, {
      quality: options.imageQuality,
      forceWebP: true,
    });
  }
  if (file.type.startsWith("audio/")) {
    return convertAudioToOpus(file, options.onProgress);
  }
  options.onProgress?.(100);
  return file;
}

/**
 * Batch form of {@link convertFileForUpload}, reporting progress across the whole
 * batch.
 *
 * Sequential on purpose: each image costs a full canvas decode and each audio
 * file a full decode-and-encode pass, so converting a batch in parallel only
 * multiplies peak memory for no wall-clock gain.
 */
export async function convertFilesForUpload(
  files: readonly File[],
  options: UploadConversionOptions = {},
): Promise<File[]> {
  const converted: File[] = [];
  const total = files.length;

  for (const [index, file] of files.entries()) {
    converted.push(await convertFileForUpload(file, {
      imageQuality: options.imageQuality,
      onProgress: (percent) => {
        options.onProgress?.(Math.min(100, Math.round(((index + percent / 100) / total) * 100)));
      },
    }));
  }

  options.onProgress?.(100);
  return converted;
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

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  /*
   * 「已经是 Opus 了吗」只能问编码本身。以前是看容器：文件叫 audio/ogg 就当它是
   * Opus 直接放行——可是 Ogg 同样装得下 Vorbis，那种文件就这么原样进了库，
   * 而库里本该只有 Opus。这里读的是轨道的实际编码，Ogg/Vorbis 会照常重编。
   */
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
