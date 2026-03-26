import { composeMantineTheme } from "./theme/mantine-adapter";
import { listThemeIds } from "@infini-dev-kit/theme-core";
import type { ThemeId } from "@infini-dev-kit/theme-core";
import { ContextMenuProvider } from "mantine-contextmenu";
import { StrictMode } from "react";
import type { Root } from "react-dom/client";
import "@gfazioli/mantine-split-pane/styles.css";
import "./i18n";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { AppRouter } from "./router";

type MotionMode = "off" | "minimum" | "reduced" | "full";
type SerializedThemeState = {
  version: 1;
  state: {
    themeId: ThemeId;
    motionMode: MotionMode;
  };
};

const DEV_KIT_THEME_STORAGE_KEY = "infini-dev-kit.theme";
const FALLBACK_THEME_ID: ThemeId = "neu-brutalism";
const FALLBACK_MOTION_MODE: MotionMode = "full";
const VALID_THEME_IDS = new Set<ThemeId>(listThemeIds());
const VALID_MOTION_MODES = new Set<MotionMode>(["off", "minimum", "reduced", "full"]);

function isThemeId(value: string | null): value is ThemeId {
  return !!value && VALID_THEME_IDS.has(value as ThemeId);
}

function isMotionMode(value: string | null): value is MotionMode {
  return !!value && VALID_MOTION_MODES.has(value as MotionMode);
}

function rehydrateThemeState(): void {
  const legacyTheme = localStorage.getItem("theme");
  const legacyMotion = localStorage.getItem("motionMode");
  const searchTheme = new URLSearchParams(window.location.search).get("theme");

  let themeId: ThemeId = isThemeId(legacyTheme) ? legacyTheme : FALLBACK_THEME_ID;
  let motionMode: MotionMode = isMotionMode(legacyMotion) ? legacyMotion : FALLBACK_MOTION_MODE;

  const serializedState = localStorage.getItem(DEV_KIT_THEME_STORAGE_KEY);
  if (serializedState) {
    try {
      const parsed = JSON.parse(serializedState) as Partial<SerializedThemeState>;
      const parsedThemeRaw = parsed.state?.themeId ?? null;
      const parsedMotionRaw = parsed.state?.motionMode ?? null;
      if (isThemeId(parsedThemeRaw)) {
        themeId = parsedThemeRaw;
      }
      if (isMotionMode(parsedMotionRaw)) {
        motionMode = parsedMotionRaw;
      }
    } catch {
      // Rebuild invalid persisted payload with safe defaults.
    }
  }

  if (isThemeId(searchTheme)) {
    themeId = searchTheme;
    localStorage.setItem("theme", themeId);
  }

  // Precompute a token payload and validate theme id before first render.
  composeMantineTheme({ themeId });

  const nextState: SerializedThemeState = {
    version: 1,
    state: {
      themeId,
      motionMode,
    },
  };
  localStorage.setItem(DEV_KIT_THEME_STORAGE_KEY, JSON.stringify(nextState));
}

export function mountApp(root: Root): void {
  rehydrateThemeState();
  root.render(
    <StrictMode>
      <PortalThemeProvider>
        <ContextMenuProvider
          borderRadius="md"
          classNames={{
            root: "infini-context-menu-root",
            item: "infini-context-menu-item",
            divider: "infini-context-menu-divider",
          }}
          styles={{
            divider: {
              background: "color-mix(in srgb, var(--infini-color-text, #e5e7eb) 12%, transparent)",
              border: "none",
              height: 1,
              margin: "4px 8px",
            },
            item: {
              background: "transparent",
              border: "none",
              borderRadius: 9,
              boxShadow: "none",
              color: "var(--infini-color-text, #e5e7eb)",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.01em",
              lineHeight: 1.2,
              minHeight: 36,
              padding: "9px 12px",
            },
            root: {
              background: "color-mix(in srgb, var(--infini-color-surface, #0f172a) 96%, transparent)",
              border: "none",
              borderRadius: 12,
              boxShadow: "0 16px 34px color-mix(in srgb, black 24%, transparent)",
              minWidth: 176,
              padding: 6,
            },
          }}
          shadow="md"
          submenuDelay={160}
        >
          <AppRouter />
        </ContextMenuProvider>
      </PortalThemeProvider>
    </StrictMode>,
  );
}
