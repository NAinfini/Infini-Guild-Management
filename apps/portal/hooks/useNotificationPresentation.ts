import { notifications } from "@mantine/notifications";
import type { PushMessage } from "@guild/shared";
import { useEffect, useRef, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "../stores/notifications";

type UseNotificationPresentationOptions = {
  enabled?: boolean;
  showToast?: boolean;
  playSound?: boolean;
};

type PushSignalPayload = {
  key: string;
  titleKey: string;
  message: string;
  color: "blue" | "yellow";
  frequencyHz: number;
};

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const SIGNAL_DEDUPE_MS = 10_000;
const SIGNAL_TONE_MS = 120;

function resolveSignalPayload(message: PushMessage): PushSignalPayload | null {
  if (message.type === "announcement_published") {
    return {
      key: `announcement:${message.announcement_id}`,
      titleKey: "notification.type.announcement",
      message: message.title,
      color: "blue",
      frequencyHz: 880,
    };
  }

  return null;
}

function getAudioContextInstance(cache: MutableRefObject<AudioContext | null>): AudioContext | null {
  if (cache.current) {
    return cache.current;
  }

  const ctor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
  if (!ctor) {
    return null;
  }
  cache.current = new ctor();
  return cache.current;
}

async function playSignalTone(cache: MutableRefObject<AudioContext | null>, frequencyHz: number): Promise<void> {
  const context = getAudioContextInstance(cache);
  if (!context) {
    throw new Error("AudioContext is not supported in this browser.");
  }

  if (context.state === "suspended") {
    await context.resume();
  }

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequencyHz, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + SIGNAL_TONE_MS / 1000);

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start(now);
  oscillator.stop(now + SIGNAL_TONE_MS / 1000 + 0.01);
}

export function useNotificationPresentation(options: UseNotificationPresentationOptions = {}) {
  const enabled = options.enabled ?? true;
  const showToast = options.showToast ?? true;
  const playSound = options.playSound ?? false;
  const { t } = useTranslation("common");
  const signalSequence = useNotificationStore((state) => state.signalSequence);
  const lastSignalMessage = useNotificationStore((state) => state.lastSignalMessage);
  const lastSignalRef = useRef<Map<string, number>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled || !lastSignalMessage || signalSequence <= 0) {
      return;
    }

    const payload = resolveSignalPayload(lastSignalMessage);
    if (!payload) {
      return;
    }

    const now = Date.now();
    const lastSignalAt = lastSignalRef.current.get(payload.key) ?? 0;
    if (now - lastSignalAt < SIGNAL_DEDUPE_MS) {
      return;
    }
    lastSignalRef.current.set(payload.key, now);

    if (showToast) {
      notifications.show({
        color: payload.color,
        title: t(payload.titleKey),
        message: payload.message,
      });
    }

    if (playSound) {
      void playSignalTone(audioContextRef, payload.frequencyHz).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[push-sound] ${message}`);
      });
    }
  }, [enabled, lastSignalMessage, playSound, showToast, signalSequence, t]);

  useEffect(() => {
    if (playSound) {
      return;
    }
    if (!audioContextRef.current) {
      return;
    }
    const context = audioContextRef.current;
    audioContextRef.current = null;
    void context.close().catch(() => undefined);
  }, [playSound]);

  useEffect(
    () => () => {
      if (!audioContextRef.current) {
        return;
      }
      const context = audioContextRef.current;
      audioContextRef.current = null;
      void context.close().catch(() => undefined);
    },
    [],
  );
}


