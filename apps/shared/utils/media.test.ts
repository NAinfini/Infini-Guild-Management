import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendImageUploadVariants,
  convertAudioToOpus,
  convertImageForUpload,
  getAudioConversionSupport,
} from "./media";

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
function stubImageEnvironment(encodedSize: number, width = 4, height = 4) {
  const drawImage = vi.fn();
  const canvases: Array<{ width: number; height: number }> = [];
  const qualities: number[] = [];
  stub("createImageBitmap", vi.fn(async () => ({ width, height, close: vi.fn() })));
  stub("document", {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toBlob: (cb: (blob: Blob) => void, _type: string, quality: number) => {
          qualities.push(quality);
          cb(new Blob([new Uint8Array(encodedSize)], { type: "image/webp" }));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  return { canvases, drawImage, qualities };
}

/*
 * mediabunny 走的是真实的 WebCodecs，node 里没有，所以整包 mock 掉。
 * 这里要钉的本来也不是「编码器编得对不对」——那是它的单测该管的事——
 * 而是「什么时候决定重编、什么时候放行」，那条判断是我们自己写的。
 */
const conversionCalls: Array<{ audio?: Record<string, unknown> }> = [];
let encoderState = { codec: "mp3" as string | null, canEncode: true, hasTrack: true };

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  BufferTarget: class {
    buffer: ArrayBuffer | null = new Uint8Array(64).buffer;
  },
  OggOutputFormat: class {},
  Output: class {
    constructor(public options: { target: { buffer: ArrayBuffer | null } }) {}
  },
  Input: class {
    async getPrimaryAudioTrack() {
      if (!encoderState.hasTrack) return null;
      return { getCodec: async () => encoderState.codec };
    }
  },
  canEncodeAudio: async () => encoderState.canEncode,
  Conversion: {
    init: async (options: { audio?: Record<string, unknown> }) => {
      conversionCalls.push({ audio: options.audio });
      return { isValid: true, onProgress: undefined, execute: async () => undefined };
    },
  },
}));

/** WebCodecs 存在，且 mediabunny 按给定的编码/能力作答。 */
function stubAudioEnvironment(
  options: { codec?: string | null; canEncode?: boolean; track?: null } = {},
) {
  conversionCalls.length = 0;
  encoderState = {
    codec: options.codec ?? "mp3",
    canEncode: options.canEncode ?? true,
    hasTrack: options.track !== null,
  };
  stub("AudioEncoder", class {});
  stub("window", {});
}

describe("image conversion", () => {
  it("rejects image formats outside the canonical upload contract", async () => {
    stubImageEnvironment(10);
    const gif = file("loop.gif", "image/gif", 5_000);
    const svg = file("logo.svg", "image/svg+xml", 5_000);
    const bmp = file("legacy.bmp", "image/bmp", 5_000);

    await expect(convertImageForUpload(gif)).rejects.toThrow(/JPEG, PNG, AVIF, or WebP/i);
    await expect(convertImageForUpload(svg)).rejects.toThrow(/JPEG, PNG, AVIF, or WebP/i);
    await expect(convertImageForUpload(bmp)).rejects.toThrow(/JPEG, PNG, AVIF, or WebP/i);
    expect(g.createImageBitmap).not.toHaveBeenCalled();
  });

  it("creates separate canonical full and view WebP files", async () => {
    stubImageEnvironment(400);
    const png = file("photo.png", "image/png", 5_000);

    const result = await convertImageForUpload(png);

    expect(result.full.name).toBe("photo.full.webp");
    expect(result.view.name).toBe("photo.view.webp");
    expect(result.full.type).toBe("image/webp");
    expect(result.view.type).toBe("image/webp");
    expect(result.view).not.toBe(result.full);
  });

  it.each([
    ["landscape", 3840, 2160, 1920, 1080],
    ["portrait", 2160, 3840, 1080, 1920],
    ["square", 3000, 3000, 1080, 1080],
  ])("fits a %s view inside the orientation-aware envelope", async (_label, width, height, expectedWidth, expectedHeight) => {
    const { canvases, drawImage } = stubImageEnvironment(400, width, height);

    const result = await convertImageForUpload(file("image.png", "image/png", 5_000));

    expect(result.viewWidth).toBe(expectedWidth);
    expect(result.viewHeight).toBe(expectedHeight);
    expect(canvases.at(-1)).toMatchObject({ width: expectedWidth, height: expectedHeight });
    expect(drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, expectedWidth, expectedHeight);
  });

  it("never upscales a small source but still creates an independent view object", async () => {
    const { canvases, qualities } = stubImageEnvironment(400, 800, 600);

    const result = await convertImageForUpload(file("small.png", "image/png", 5_000));

    expect(result).toMatchObject({ fullWidth: 800, fullHeight: 600, viewWidth: 800, viewHeight: 600 });
    expect(result.view).not.toBe(result.full);
    expect(canvases).toHaveLength(2);
    expect(canvases.at(-1)).toMatchObject({ width: 800, height: 600 });
    expect(qualities.at(-1)).toBe(0.8);
  });

  it("appends only aligned full/view fields to multipart form data", async () => {
    stubImageEnvironment(400, 800, 600);
    const variants = await convertImageForUpload(file("map.png", "image/png", 5_000));
    const formData = new FormData();

    appendImageUploadVariants(formData, [variants]);

    expect(formData.getAll("full")).toHaveLength(1);
    expect(formData.getAll("view")).toHaveLength(1);
    expect(formData.has("original_name")).toBe(false);
  });

  it("refuses a non-image outright rather than producing junk", async () => {
    stubImageEnvironment(10);
    await expect(convertImageForUpload(file("notes.txt", "text/plain", 10))).rejects.toThrow(/JPEG, PNG, AVIF, or WebP/i);
  });
});

describe("音频转 Opus", () => {
  it("mp3 转出来是 Ogg/Opus，容器不再跟浏览器协商", async () => {
    stubAudioEnvironment();
    const result = await convertAudioToOpus(file("clip.mp3", "audio/mpeg", 200_000));

    expect(result.name).toBe("clip.ogg");
    /* 裸容器类型，不带 ";codecs="：服务端按精确白名单比对声明的 Content-Type。 */
    expect(result.type).toBe("audio/ogg");
    expect(conversionCalls).toHaveLength(1);
    expect(conversionCalls[0]?.audio).toMatchObject({
      codec: "opus",
      numberOfChannels: 1,
      sampleRate: 16_000,
    });
  });

  it("已经是 Ogg/Opus 就原样退回，不做第二次有损", async () => {
    stubAudioEnvironment({ codec: "opus" });
    const ogg = file("clip.ogg", "audio/ogg", 5_000);

    await expect(convertAudioToOpus(ogg)).resolves.toBe(ogg);
    expect(conversionCalls).toHaveLength(0);
  });

  it("Ogg 装的是 Vorbis 就照样重编——只看容器会把它放进库里", async () => {
    stubAudioEnvironment({ codec: "vorbis" });
    const ogg = file("voice.ogg", "audio/ogg", 5_000);

    const result = await convertAudioToOpus(ogg);
    expect(result).not.toBe(ogg);
    expect(conversionCalls).toHaveLength(1);
  });

  it("WebM/Opus 也要重封装成 Ogg：落库只认一种容器", async () => {
    stubAudioEnvironment({ codec: "opus" });
    const webm = file("clip.webm", "audio/webm", 5_000);

    const result = await convertAudioToOpus(webm);
    expect(result.type).toBe("audio/ogg");
    expect(conversionCalls).toHaveLength(1);
  });

  it("浏览器没有 WebCodecs 时给出可读的理由", async () => {
    stub("window", {});
    const support = getAudioConversionSupport();
    expect(support).toMatchObject({ supported: false });
    expect(support.supported ? "" : support.reason).toMatch(/WebCodecs/i);
  });

  it("编不出 Opus 时明确报错，而不是悄悄退回原文件", async () => {
    stubAudioEnvironment({ canEncode: false });
    await expect(convertAudioToOpus(file("clip.wav", "audio/wav", 200_000)))
      .rejects.toThrow(/cannot encode Opus/i);
  });

  it("没有音轨的文件直接报错", async () => {
    stubAudioEnvironment({ track: null });
    await expect(convertAudioToOpus(file("silent.wav", "audio/wav", 200_000)))
      .rejects.toThrow(/no audio track/i);
  });
});
