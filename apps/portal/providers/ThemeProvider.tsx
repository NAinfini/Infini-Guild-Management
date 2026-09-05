import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { MotionConfig } from "motion/react";

import { ConfirmDialogHost } from "@portal/components/shared/ConfirmDialogHost";
import { Toaster } from "@portal/components/ui/toast";
import {
  TOOLTIP_CLOSE_DELAY_MS,
  TOOLTIP_GROUP_TIMEOUT_MS,
  TOOLTIP_OPEN_DELAY_MS,
  TooltipProvider,
} from "@portal/components/ui/tooltip";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { useReducedMotionPreference } from "../hooks/useReducedMotionPreference";
import { DARK_MODE_MEDIA_QUERY, resolveThemeMode, usePreferencesStore, type ThemeMode } from "../stores/preferences";

const KEYBOARD_FOCUS_KEYS = new Set([
  "Tab",
  "Enter",
  " ",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

type Theme = "light" | "dark";
type Accent = "teal" | "indigo" | "violet" | "orange";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export function PortalThemeProvider({ children }: { children: ReactNode }) {
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const systemDark = useMediaQuery(DARK_MODE_MEDIA_QUERY);
  const theme = resolveThemeMode(themeMode, systemDark);
  const reducedMotion = useReducedMotionPreference();
  const setTheme = usePreferencesStore((state) => state.setThemeMode);
  const accent = usePreferencesStore((state) => state.accent);
  const setAccent = usePreferencesStore((state) => state.setAccent);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  }, [theme, accent, reducedMotion]);

  useEffect(() => {
    const root = document.documentElement;
    const setPointerModality = () => {
      root.dataset.inputModality = "pointer";
    };
    const setKeyboardModality = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      const isTextEntry = target instanceof HTMLElement
        && target.matches("input, textarea, [contenteditable='true']");

      if (KEYBOARD_FOCUS_KEYS.has(event.key) || !isTextEntry) {
        root.dataset.inputModality = "keyboard";
      }
    };

    window.addEventListener("pointerdown", setPointerModality, true);
    window.addEventListener("keydown", setKeyboardModality, true);
    return () => {
      window.removeEventListener("pointerdown", setPointerModality, true);
      window.removeEventListener("keydown", setKeyboardModality, true);
    };
  }, []);

  const contextValue = useMemo(
    () => ({ theme, setTheme, toggleTheme, accent, setAccent }),
    [theme, setTheme, toggleTheme, accent, setAccent],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <MotionConfig reducedMotion={reducedMotion ? "always" : "never"} transition={reducedMotion ? { duration: 0 } : undefined}>
        <Toaster timeout={5000} limit={4}>
          <TooltipProvider
            delay={TOOLTIP_OPEN_DELAY_MS}
            closeDelay={TOOLTIP_CLOSE_DELAY_MS}
            timeout={TOOLTIP_GROUP_TIMEOUT_MS}
          >
            <ConfirmDialogHost />
            {children}
          </TooltipProvider>
        </Toaster>
      </MotionConfig>
    </ThemeContext.Provider>
  );
}
