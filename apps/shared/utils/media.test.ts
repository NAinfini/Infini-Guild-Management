import { afterEach, describe, expect, it, vi } from "vitest";
import { convertAudioToOpus, convertImageToWebP, getAudioConversionSupport } from "./media";

/*
 * These tests run in the node environment, so every browser API the converters
 * touch is stubbed explicitly. That is deliberate: the bugs being guarded against
 * are all about which browser API is asked for and what is handed back.
 */

type Globals = typeof globalThis & Record<string, unknown>;
const g = globalThis as Globals;

const originals = new Map<string, unknown>();

function stub(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, g[name]);
  g[name] = value;
}

afterEach(() => {
  for (const [name, value] of originals) {
    if (value === undefined) delete g[name];
    else g[name] = value;
  }
  originals.clear();
  vi.restoreAllMocks();
});

function file(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

/** Canvas that encodes to a blob of exactly `encodedSize` bytes. */
function stubImageEnvironment(encodedSize: number) {
  stub("createImageBitmap", vi.fn(async () => ({ width: 4, height: 4, close: vi.fn() })));
  stub("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (blob: Blob) => void) => cb(new Blob([new Uint8Array(encodedSize)], { type: "image/webp" })),
    }),
  });
}

/** MediaRecorder that only advertises the container types in `supported`. */
function stubAudioEnvironment(supported: string[]) {
  class FakeMediaRecorder {
    static isTypeSupported = (type: string) => supported.includes(type);
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    readonly mimeType: string;
    constructor(_stream: unknown, options: { mimeType: string }) {
      this.mimeType = options.mimeType;
      recordedMimeTypes.push(options.mimeType);
    }
    start() {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(8)]) });
    }
    stop() {
      this.onstop?.();
    }
  }

  const audioBuffer = { duration: 1, sampleRate: 48_000 };
  class FakeAudioContext {
    createMediaStreamDestination = () => ({ stream: {}, disconnect: vi.fn() });
    createBufferSource = () => {
      const source: Record<string, unknown> = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
        start: () => {
          /*
           * Deferred, because the converter assigns `onended` on the line after
           * start(). A real AudioBufferSourceNode dispatches onended as a task,
           * so the assignment always wins; firing it synchronously here would
           * deadlock the test rather than reflect the browser.
           */
          queueMicrotask(() => (source.onended as (() => void) | null)?.());
        },
      };
      return source;
    };
    decodeAudioData = async () => audioBuffer;
    close = async () => undefined;
  }
  class FakeOfflineAudioContext {
    createBufferSource = () => ({ buffer: null, connect: vi.fn(), start: vi.fn() });
    destination = {};
    startRendering = async () => audioBuffer;
  }

  stub("MediaRecorder", FakeMediaRecorder);
  stub("AudioContext", FakeAudioContext);
  stub("OfflineAudioContext", FakeOfflineAudioContext);
  stub("window", { AudioContext: FakeAudioContext, OfflineAudioContext: FakeOfflineAudioContext });
}

const recordedMimeTypes: string[] = [];

describe("image conversion", () => {
  it("passes an animated GIF through instead of flattening it to one frame", async () => {
    stubImageEnvironment(10);
    const gif = file("loop.gif", "image/gif", 5_000);

    // createImageBitmap decodes only the first frame, so converting would be data loss.
    await expect(convertImageToWebP(gif)).resolves.toBe(gif);
    expect(g.createImageBitmap).not.toHaveBeenCalled();
  });

  it("is idempotent for input that is already WebP", async () => {
    stubImageEnvironment(10);
    const webp = file("already.webp", "image/webp", 5_000);
    await expect(convertImageToWebP(webp)).resolves.toBe(webp);
  });

  it("keeps the original when the WebP re-encode came out bigger", async () => {
    // A flat PNG or an already-optimised JPEG can grow; uploading the bigger of
    // the two would defeat the point of converting at all.
    stubImageEnvironment(9_000);
    const png = file("flat.png", "image/png", 1_000);
    await expect(convertImageToWebP(png)).resolves.toBe(png);
  });

  it("returns the WebP when it is genuinely smaller", async () => {
    stubImageEnvironment(400);
    const png = file("photo.png", "image/png", 5_000);

    const result = await convertImageToWebP(png);
    expect(result).not.toBe(png);
    expect(result.name).toBe("photo.webp");
    expect(result.type).toBe("image/webp");
  });

  it("refuses a non-image outright rather than producing junk", async () => {
    stubImageEnvironment(10);
    await expect(convertImageToWebP(file("notes.txt", "text/plain", 10))).rejects.toThrow(/image file/i);
  });
});

describe("audio conversion container negotiation", () => {
  it("encodes into WebM when the browser only offers Opus in WebM", async () => {
    /*
     * This is Chromium, verified on Chrome 148: it reports
     * isTypeSupported("audio/ogg;codecs=opus") === false. Demanding Ogg made the
     * converter unusable there, which is why both call sites had it disabled.
     */
    recordedMimeTypes.length = 0;
    stubAudioEnvironment(["audio/webm;codecs=opus"]);

    const result = await convertAudioToOpus(file("clip.mp3", "audio/mpeg", 200_000));

    expect(recordedMimeTypes).toEqual(["audio/webm;codecs=opus"]);
    expect(result.name).toBe("clip.webm");
    /*
     * Bare container type, no ";codecs=" parameter: the worker validates the
     * declared Content-Type against an exact allow-list, so a parameterised type
     * is rejected as an unsupported file type.
     */
    expect(result.type).toBe("audio/webm");
  });

  it("prefers Ogg when the browser offers it", async () => {
    recordedMimeTypes.length = 0;
    stubAudioEnvironment(["audio/ogg;codecs=opus", "audio/webm;codecs=opus"]);

    const result = await convertAudioToOpus(file("clip.wav", "audio/wav", 200_000));

    expect(recordedMimeTypes).toEqual(["audio/ogg;codecs=opus"]);
    expect(result.name).toBe("clip.ogg");
    expect(result.type).toBe("audio/ogg");
  });

  it("reports a clear reason when no container can carry Opus", async () => {
    stubAudioEnvironment([]);
    const support = getAudioConversionSupport();
    expect(support).toMatchObject({ supported: false });
    expect(support.supported ? "" : support.reason).toMatch(/cannot encode Opus/i);
  });

  it("does not re-encode audio that is already in an Opus container", async () => {
    // The converter's own output must be recognised, or a second call runs
    // another lossy real-time render over it.
    stubAudioEnvironment(["audio/webm;codecs=opus"]);
    const converted = file("clip.webm", "audio/webm", 5_000);
    await expect(convertAudioToOpus(converted)).resolves.toBe(converted);

    const ogg = file("clip.ogg", "audio/ogg", 5_000);
    await expect(convertAudioToOpus(ogg)).resolves.toBe(ogg);
  });
});
