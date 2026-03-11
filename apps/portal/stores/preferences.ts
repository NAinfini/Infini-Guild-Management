import { create } from "zustand";

type Locale = "en" | "zh";
const DEFAULT_FANCY_EFFECTS = true;
const DEFAULT_PUSH_NOTIFICATION_SOUND = false;

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

type PreferencesState = {
  locale: Locale;
  fancyEffects: boolean;
  pushNotificationSound: boolean;
  setLocale: (locale: Locale) => void;
  setFancyEffects: (enabled: boolean) => void;
  setPushNotificationSound: (enabled: boolean) => void;
  resetPreferences: () => void;
};

const initialLocaleRaw = readStorage("locale");
const initialLocale = isLocale(initialLocaleRaw) ? initialLocaleRaw : resolveDefaultLocale();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  locale: initialLocale,
  fancyEffects: (() => { const v = readStorage("fancyEffects"); return v === null ? DEFAULT_FANCY_EFFECTS : v !== "false"; })(),
  pushNotificationSound: (() => { const v = readStorage("pushNotificationSound"); return v === null ? DEFAULT_PUSH_NOTIFICATION_SOUND : v !== "false"; })(),
  setLocale: (locale) => {
    writeStorage("locale", locale);
    set({ locale });
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
    removeStorage("fancyEffects");
    removeStorage("pushNotificationSound");
    set({
      locale,
      fancyEffects: DEFAULT_FANCY_EFFECTS,
      pushNotificationSound: DEFAULT_PUSH_NOTIFICATION_SOUND,
    });
  },
}));
