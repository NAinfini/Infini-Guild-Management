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

export function setAudioVolume(volume: number): void {
  getAudio().volume = Math.max(0, Math.min(1, volume));
}

export function setAudioMuted(muted: boolean): void {
  getAudio().muted = muted;
}

export function isAudioPlaying(): boolean {
  return audioEl !== null && !audioEl.paused;
}

export function getAudioSrc(): string {
  return currentSrc;
}
