import { create } from "zustand";

type Locale = "en" | "zh";

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

export type ThemeMode = "system" | "light" | "dark";
export type MotionPreference = "system" | "reduce";

export const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";
export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

type Accent = "teal" | "indigo" | "violet" | "orange";
const DEFAULT_ACCENT: Accent = "teal";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isMotionPreference(value: string | null): value is MotionPreference {
  return value === "system" || value === "reduce";
}

function isAccent(value: string | null): value is Accent {
  return value === "teal" || value === "indigo" || value === "violet" || value === "orange";
}

export function resolveThemeMode(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

type PreferencesState = {
  locale: Locale;
  themeMode: ThemeMode;
  motionPreference: MotionPreference;
  accent: Accent;
  setLocale: (locale: Locale) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setMotionPreference: (preference: MotionPreference) => void;
  setAccent: (accent: Accent) => void;
  resetPreferences: () => void;
};

const initialLocaleRaw = readStorage("locale");
const initialLocale = isLocale(initialLocaleRaw) ? initialLocaleRaw : resolveDefaultLocale();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  locale: initialLocale,
  themeMode: (() => { const v = readStorage("themeMode"); return isThemeMode(v) ? v : "system"; })(),
  motionPreference: (() => { const v = readStorage("motionPreference"); return isMotionPreference(v) ? v : "system"; })(),
  accent: (() => { const v = readStorage("accent"); return isAccent(v) ? v : DEFAULT_ACCENT; })(),
  setLocale: (locale) => {
    writeStorage("locale", locale);
    set({ locale });
  },
  setThemeMode: (themeMode) => {
    writeStorage("themeMode", themeMode);
    set({ themeMode });
  },
  setMotionPreference: (motionPreference) => {
    writeStorage("motionPreference", motionPreference);
    set({ motionPreference });
  },
  setAccent: (accent) => {
    writeStorage("accent", accent);
    set({ accent });
  },
  resetPreferences: () => {
    const locale = resolveDefaultLocale();
    removeStorage("locale");
    removeStorage("themeMode");
    removeStorage("motionPreference");
    removeStorage("accent");
    set({
      locale,
      themeMode: "system",
      motionPreference: "system",
      accent: DEFAULT_ACCENT,
    });
  },
}));
