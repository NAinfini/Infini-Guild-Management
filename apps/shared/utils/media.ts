export const DEFAULT_IMAGE_WEBP_QUALITY = 0.8;
/*
 * Opus is the codec; the container is whatever the browser will encode into.
 * Chromium only offers Opus inside WebM (verified on Chrome 148:
 * isTypeSupported("audio/ogg;codecs=opus") === false, "audio/webm;codecs=opus"
 * === true), while Firefox offers Ogg. Demanding Ogg alone made this converter
 * unusable on the majority of browsers, which is why both call sites had the
 * conversion switched off. The worker accepts audio/ogg and audio/webm alike, so
 * negotiating the container costs nothing and the bytes are Opus either way.
 */
type OpusContainer = {
  /** Passed to MediaRecorder, which needs the codec spelled out. */
  recorderMimeType: string;
  /*
   * Stored on the File, and therefore the Content-Type the worker validates and
   * R2 serves. It must stay a bare container type: the upload validator compares
   * the declared type against an exact allow-list, so "audio/webm;codecs=opus"
   * is rejected as an unsupported file type.
   */
  fileMimeType: string;
  extension: string;
};

const OPUS_CONTAINERS: readonly OpusContainer[] = [
  { recorderMimeType: "audio/ogg;codecs=opus", fileMimeType: "audio/ogg", extension: "ogg" },
  { recorderMimeType: "audio/webm;codecs=opus", fileMimeType: "audio/webm", extension: "webm" },
];
const OPUS_TARGET_SAMPLE_RATE = 16_000;
const OPUS_TARGET_BITRATE = 48_000;

function resolveOpusContainer(): OpusContainer | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  return OPUS_CONTAINERS.find((candidate) => MediaRecorder.isTypeSupported(candidate.recorderMimeType)) ?? null;
}

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

type AudioContextLikeCtor = new (contextOptions?: AudioContextOptions) => AudioContext;
type OfflineAudioContextLikeCtor = new (
  numberOfChannels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

function resolveAudioContextCtor(): AudioContextLikeCtor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextLikeCtor }).webkitAudioContext;
  return ctor ?? null;
}

function resolveOfflineAudioContextCtor(): OfflineAudioContextLikeCtor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const ctor =
    window.OfflineAudioContext ??
    (window as Window & { webkitOfflineAudioContext?: OfflineAudioContextLikeCtor }).webkitOfflineAudioContext;
  return ctor ?? null;
}

export type AudioConversionSupport =
  | { supported: true }
  | { supported: false; reason: string };

export function getAudioConversionSupport(): AudioConversionSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Audio conversion is only available in browser runtime." };
  }

  if (!resolveAudioContextCtor()) {
    return { supported: false, reason: "This browser does not support AudioContext." };
  }

  if (!resolveOfflineAudioContextCtor()) {
    return { supported: false, reason: "This browser does not support OfflineAudioContext." };
  }

  if (typeof MediaRecorder === "undefined") {
    return { supported: false, reason: "This browser does not support MediaRecorder." };
  }

  if (!resolveOpusContainer()) {
    return {
      supported: false,
      reason: "This browser cannot encode Opus audio. Please use Chrome, Edge, or Firefox.",
    };
  }

  return { supported: true };
}

function createAudioContext(options?: AudioContextOptions): AudioContext {
  const ctor = resolveAudioContextCtor();
  if (!ctor) {
    throw new Error("AudioContext is unavailable");
  }

  return new ctor(options);
}

async function renderMonoAudioAtTargetRate(input: AudioBuffer): Promise<AudioBuffer> {
  const offlineCtor = resolveOfflineAudioContextCtor();
  if (!offlineCtor) {
    throw new Error("OfflineAudioContext is unavailable");
  }

  const frameCount = Math.max(1, Math.ceil(input.duration * OPUS_TARGET_SAMPLE_RATE));
  const offlineContext = new offlineCtor(1, frameCount, OPUS_TARGET_SAMPLE_RATE);
  const source = offlineContext.createBufferSource();
  source.buffer = input;
  source.connect(offlineContext.destination);
  source.start(0);
  return offlineContext.startRendering();
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
   * GIFs pass through untouched: createImageBitmap decodes only the first frame,
   * so re-encoding an animated GIF silently throws the animation away. Leaving
   * it alone costs some R2 space but never destroys the image.
   */
  if (file.type === "image/gif" && !forceWebP) {
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
   * Re-encoding can make a file bigger — an already-optimised JPEG, or a flat
   * PNG with few colours. The whole point is to save R2 space, so keep whichever
   * is actually smaller rather than assuming WebP always wins.
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
    return convertImageToWebP(file, options.onProgress, { quality: options.imageQuality });
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
 * file a real-time render, so converting a batch in parallel only multiplies peak
 * memory for no wall-clock gain.
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

  /*
   * Prefix tests, because this function's own output is
   * "audio/ogg;codecs=opus" or "audio/webm;codecs=opus" — an equality check
   * against "audio/ogg" did not recognise it and re-encoded an already-converted
   * file, costing a second lossy pass and another real-time render. Both
   * containers essentially only ever carry Opus or Vorbis here, so passing them
   * through is a fair trade for never double-encoding.
   */
  if (file.type.startsWith("audio/ogg") || file.type.startsWith("audio/webm")) {
    onProgress?.(100);
    return file;
  }

  const support = getAudioConversionSupport();
  if (!support.supported) {
    throw new Error(support.reason);
  }

  const container = resolveOpusContainer();
  if (!container) {
    throw new Error("This browser cannot encode Opus audio.");
  }

  let decodeContext: AudioContext | null = null;
  let streamContext: AudioContext | null = null;

  try {
    onProgress?.(10);
    const audioData = await file.arrayBuffer();
    decodeContext = createAudioContext();
    const decodedAudio = await decodeContext.decodeAudioData(audioData.slice(0));
    onProgress?.(35);

    const renderedAudio = await renderMonoAudioAtTargetRate(decodedAudio);
    onProgress?.(55);

    streamContext = createAudioContext({ sampleRate: OPUS_TARGET_SAMPLE_RATE });
    const destination = streamContext.createMediaStreamDestination();
    const source = streamContext.createBufferSource();
    source.buffer = renderedAudio;
    source.connect(destination);

    const recorder = new MediaRecorder(destination.stream, {
      mimeType: container.recorderMimeType,
      audioBitsPerSecond: OPUS_TARGET_BITRATE,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const recording = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start(200);
    onProgress?.(75);
    source.start();
    source.onended = () => {
      recorder.stop();
    };
    await recording;
    onProgress?.(95);

    source.disconnect();
    destination.disconnect();

    if (chunks.length === 0) {
      throw new Error("Audio conversion produced empty output.");
    }

    const blob = new Blob(chunks, { type: container.fileMimeType });
    onProgress?.(100);

    // Extension has to follow the container actually produced, not a fixed guess.
    return new File([blob], fileNameWithExtension(file.name, container.extension), {
      type: container.fileMimeType,
      lastModified: Date.now(),
    });
  } finally {
    if (decodeContext) {
      await decodeContext.close().catch(() => undefined);
    }
    if (streamContext) {
      await streamContext.close().catch(() => undefined);
    }
  }
}
