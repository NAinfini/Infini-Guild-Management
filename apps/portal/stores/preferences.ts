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

type ThemeMode = "light" | "dark";
type Accent = "teal" | "indigo" | "violet" | "orange";
const DEFAULT_ACCENT: Accent = "teal";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

function isAccent(value: string | null): value is Accent {
  return value === "teal" || value === "indigo" || value === "violet" || value === "orange";
}

function resolveDefaultThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type PreferencesState = {
  locale: Locale;
  themeMode: ThemeMode;
  accent: Accent;
  setLocale: (locale: Locale) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
  resetPreferences: () => void;
};

const initialLocaleRaw = readStorage("locale");
const initialLocale = isLocale(initialLocaleRaw) ? initialLocaleRaw : resolveDefaultLocale();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  locale: initialLocale,
  themeMode: (() => { const v = readStorage("themeMode"); return isThemeMode(v) ? v : resolveDefaultThemeMode(); })(),
  accent: (() => { const v = readStorage("accent"); return isAccent(v) ? v : DEFAULT_ACCENT; })(),
  setLocale: (locale) => {
    writeStorage("locale", locale);
    set({ locale });
  },
  setThemeMode: (themeMode) => {
    writeStorage("themeMode", themeMode);
    set({ themeMode });
  },
  setAccent: (accent) => {
    writeStorage("accent", accent);
    set({ accent });
  },
  resetPreferences: () => {
    const locale = resolveDefaultLocale();
    removeStorage("locale");
    removeStorage("themeMode");
    removeStorage("accent");
    set({
      locale,
      themeMode: resolveDefaultThemeMode(),
      accent: DEFAULT_ACCENT,
    });
  },
}));
