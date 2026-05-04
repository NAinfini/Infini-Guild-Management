const WEBP_QUALITY = 0.85;

export async function convertImageToWebP(file: File): Promise<File> {
  if (file.type === "image/webp") return file;

  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
  const name = file.name.replace(/\.[^.]+$/, ".webp");
  return new File([blob], name, { type: "image/webp" });
}

export async function convertAudioToOpus(file: File): Promise<File> {
  if (file.type === "audio/ogg" || file.type === "audio/opus") return file;

  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const streamCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate });
  const streamDest = streamCtx.createMediaStreamDestination();
  const bufferSource = streamCtx.createBufferSource();
  bufferSource.buffer = audioBuffer;
  bufferSource.connect(streamDest);

  const recorder = new MediaRecorder(streamDest.stream, {
    mimeType: "audio/webm;codecs=opus",
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
  });

  recorder.start();
  bufferSource.start();

  await new Promise<void>((resolve) => {
    bufferSource.onended = () => {
      setTimeout(() => { recorder.stop(); resolve(); }, 100);
    };
  });

  const blob = await done;
  await streamCtx.close();

  const name = file.name.replace(/\.[^.]+$/, ".opus");
  return new File([blob], name, { type: "audio/webm" });
}
