import { create } from "zustand";

type Locale = "en" | "zh";
type MotionMode = "off" | "minimum" | "reduced" | "full";
const DEFAULT_FANCY_EFFECTS = true;
const DEFAULT_PUSH_NOTIFICATION_SOUND = false;
const DEFAULT_MOTION_MODE: MotionMode = "full";

function resolveDefaultLocale(): Locale {
  if (typeof navigator !== "undefined" && navigator.language.startsWith("zh")) {
    return "zh";
  }
  return "en";
}

function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "zh";
}

function readStorage(key: string): string | null {
  try {
    return typeof window !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — keep in-memory state only.
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable — ignore.
  }
}

function isMotionMode(value: string | null): value is MotionMode {
  return value === "off" || value === "minimum" || value === "reduced" || value === "full";
}

type PreferencesState = {
  locale: Locale;
  motionMode: MotionMode;
  fancyEffects: boolean;
  pushNotificationSound: boolean;
  setLocale: (locale: Locale) => void;
  setMotionMode: (mode: MotionMode) => void;
  setFancyEffects: (enabled: boolean) => void;
  setPushNotificationSound: (enabled: boolean) => void;
  resetPreferences: () => void;
};

const initialLocaleRaw = readStorage("locale");
const initialLocale = isLocale(initialLocaleRaw) ? initialLocaleRaw : resolveDefaultLocale();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  locale: initialLocale,
  motionMode: (() => { const v = readStorage("motionMode"); return isMotionMode(v) ? v : DEFAULT_MOTION_MODE; })(),
  fancyEffects: (() => { const v = readStorage("fancyEffects"); return v === null ? DEFAULT_FANCY_EFFECTS : v !== "false"; })(),
  pushNotificationSound: (() => { const v = readStorage("pushNotificationSound"); return v === null ? DEFAULT_PUSH_NOTIFICATION_SOUND : v !== "false"; })(),
  setLocale: (locale) => {
    writeStorage("locale", locale);
    set({ locale });
  },
  setMotionMode: (motionMode) => {
    writeStorage("motionMode", motionMode);
    set({ motionMode });
  },
  setFancyEffects: (fancyEffects) => {
    writeStorage("fancyEffects", String(fancyEffects));
    set({ fancyEffects });
  },
  setPushNotificationSound: (pushNotificationSound) => {
    writeStorage("pushNotificationSound", String(pushNotificationSound));
    set({ pushNotificationSound });
  },
  resetPreferences: () => {
    const locale = resolveDefaultLocale();
    removeStorage("locale");
    removeStorage("motionMode");
    removeStorage("fancyEffects");
    removeStorage("pushNotificationSound");
    set({
      locale,
      motionMode: DEFAULT_MOTION_MODE,
      fancyEffects: DEFAULT_FANCY_EFFECTS,
      pushNotificationSound: DEFAULT_PUSH_NOTIFICATION_SOUND,
    });
  },
}));
