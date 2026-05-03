let audioEl: HTMLAudioElement | null = null;
let currentSrc = "";

function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.volume = 0.5;
    audioEl.loop = true;
  }
  return audioEl;
}

export function playAudio(src: string): void {
  const audio = getAudio();
  if (currentSrc !== src) {
    audio.src = src;
    currentSrc = src;
  }
  void audio.play().catch(() => {});
}

export function stopAudio(): void {
  if (!audioEl) return;
  audioEl.pause();
  audioEl.currentTime = 0;
}
