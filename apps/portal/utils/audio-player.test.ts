import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { playAudio } from "./audio-player";

const play = vi.fn(() => Promise.resolve());
const originalUserActivation = Object.getOwnPropertyDescriptor(navigator, "userActivation");

class AudioMock {
  currentTime = 0;
  loop = false;
  muted = false;
  paused = true;
  src = "";
  volume = 1;

  pause() {}
  play = play;
}

function setUserActivation(hasBeenActive: boolean): void {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { hasBeenActive, isActive: hasBeenActive },
  });
}

beforeAll(() => {
  vi.stubGlobal("Audio", AudioMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (originalUserActivation) {
    Object.defineProperty(navigator, "userActivation", originalUserActivation);
  } else {
    Reflect.deleteProperty(navigator, "userActivation");
  }
});

describe("audio player autoplay policy", () => {
  it("waits for user activation before starting hover audio", () => {
    setUserActivation(false);
    playAudio("/api/media/audio1234567890abcdef/full");
    expect(play).not.toHaveBeenCalled();

    setUserActivation(true);
    playAudio("/api/media/audio1234567890abcdef/full");
    expect(play).toHaveBeenCalledTimes(1);
  });
});
