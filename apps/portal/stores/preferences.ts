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

type PreferencesState = {
  locale: Locale;
  fancyEffects: boolean;
  pushNotificationSound: boolean;
  setLocale: (locale: Locale) => void;
  setFancyEffects: (enabled: boolean) => void;
  setPushNotificationSound: (enabled: boolean) => void;
  resetPreferences: () => void;
};

const initialLocaleRaw = localStorage.getItem("locale");
const initialLocale = isLocale(initialLocaleRaw) ? initialLocaleRaw : resolveDefaultLocale();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  locale: initialLocale,
  fancyEffects: localStorage.getItem("fancyEffects") === null ? DEFAULT_FANCY_EFFECTS : localStorage.getItem("fancyEffects") !== "false",
  pushNotificationSound:
    localStorage.getItem("pushNotificationSound") === null
      ? DEFAULT_PUSH_NOTIFICATION_SOUND
      : localStorage.getItem("pushNotificationSound") !== "false",
  setLocale: (locale) => {
    localStorage.setItem("locale", locale);
    set({ locale });
  },
  setFancyEffects: (fancyEffects) => {
    localStorage.setItem("fancyEffects", String(fancyEffects));
    set({ fancyEffects });
  },
  setPushNotificationSound: (pushNotificationSound) => {
    localStorage.setItem("pushNotificationSound", String(pushNotificationSound));
    set({ pushNotificationSound });
  },
  resetPreferences: () => {
    const locale = resolveDefaultLocale();
    localStorage.removeItem("locale");
    localStorage.removeItem("fancyEffects");
    localStorage.removeItem("pushNotificationSound");
    set({
      locale,
      fancyEffects: DEFAULT_FANCY_EFFECTS,
      pushNotificationSound: DEFAULT_PUSH_NOTIFICATION_SOUND,
    });
  },
}));
