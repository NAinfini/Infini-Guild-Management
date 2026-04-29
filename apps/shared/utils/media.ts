export const DEFAULT_IMAGE_WEBP_QUALITY = 0.8;
const OPUS_MIME_TYPE = "audio/ogg;codecs=opus";
const OPUS_TARGET_SAMPLE_RATE = 16_000;
const OPUS_TARGET_BITRATE = 48_000;

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

type ImageConversionOptions = {
  quality?: number;
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

  if (!MediaRecorder.isTypeSupported(OPUS_MIME_TYPE)) {
    return {
      supported: false,
      reason: "This browser cannot encode Opus (audio/ogg). Please use Chrome, Edge, or Firefox.",
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

  if (file.type === "image/webp") {
    onProgress?.(100);
    return file;
  }

  onProgress?.(10);
  const bitmap = await createImageBitmap(file);
  onProgress?.(35);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create canvas context for image conversion");
  }

  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
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
  onProgress?.(100);

  return new File([blob], fileNameWithExtension(file.name, "webp"), {
    type: "image/webp",
    lastModified: Date.now(),
  });
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
      mimeType: OPUS_MIME_TYPE,
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

    const blob = new Blob(chunks, { type: OPUS_MIME_TYPE });
    onProgress?.(100);

    return new File([blob], fileNameWithExtension(file.name, "ogg"), {
      type: OPUS_MIME_TYPE,
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
