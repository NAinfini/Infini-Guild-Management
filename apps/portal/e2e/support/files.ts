/*
 * 上传用例的素材。
 *
 * 这里放的是真正合法的编码产物，不是随手拼的字节。服务端每条上传路径都会
 * 按魔术字节复核声明的 MIME（apps/worker/services/media.ts 的 validateUploadBytes），
 * 拼出来的假字节会被直接拒掉。
 */

/** 1×1 无损 WebP（RIFF/WEBP/VP8L），26 字节。 */
export const TINY_WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

/** 1×1 PNG，用来验证「非 WebP 会被拒绝」这类分支。 */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * 0.2 秒、8 kHz、16 位单声道的静音 WAV。
 *
 * 语音上传在浏览器里先解码再用 MediaRecorder 重编成 Opus
 * （shared/utils/media.ts 的 convertAudioToOpus），所以素材必须是
 * decodeAudioData 真能解出来的文件——随手拼的字节在解码那一步就抛错，
 * 报出来的是「转换失败」，看不出是素材的问题。
 * 采样全是 0：静音照样能解码、能录制，而字节数只有 1.6 KB。
 */
function silentWav(sampleRate: number, sampleCount: number): Buffer {
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 单声道
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // 字节率 = 采样率 × 块对齐
  buffer.writeUInt16LE(2, 32); // 块对齐
  buffer.writeUInt16LE(16, 34); // 位深
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

export const TINY_WAV = silentWav(8_000, 1_600);

export type UploadPayload = { name: string; mimeType: string; buffer: Buffer };

export function webpUpload(name: string): UploadPayload {
  return { name, mimeType: "image/webp", buffer: TINY_WEBP };
}

export function pngUpload(name: string): UploadPayload {
  return { name, mimeType: "image/png", buffer: TINY_PNG };
}

export function wavUpload(name: string): UploadPayload {
  return { name, mimeType: "audio/wav", buffer: TINY_WAV };
}
