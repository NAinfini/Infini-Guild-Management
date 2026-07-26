import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  createTheme,
  MantineProvider,
  Menu,
  Modal,
  Notification,
  NumberInput,
  Select,
  Skeleton,
  Tabs,
  TextInput,
  Textarea,
} from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import i18n from "../i18n";

const portalTheme = createTheme({
  primaryColor: "portal-gold",
  // The brand colours are light-to-mid warm tones: white label text on filled gold
  // lands at 2.9:1. autoContrast lets Mantine pick dark text once the fill's
  // relative luminance passes the threshold — 0.3 puts gold (0.31) on the dark
  // side and leaves copper/red/green on white.
  autoContrast: true,
  luminanceThreshold: 0.3,
  fontFamily: '"Inter", system-ui, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", monospace',
  /*
   * Mantine's defaults run 34/26/22/18/16/14px, which is a print scale — far too
   * loud inside a 64px app chrome. These mirror the --text-* tokens in styles.css
   * so a Title and a hand-rolled heading land on the same step.
   */
  headings: {
    fontFamily: '"Inter", system-ui, sans-serif',
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "20px", lineHeight: "1.25" },
      h2: { fontSize: "18px", lineHeight: "1.3" },
      h3: { fontSize: "16px", lineHeight: "1.35" },
      h4: { fontSize: "16px", lineHeight: "1.35", fontWeight: "600" },
      h5: { fontSize: "14px", lineHeight: "1.4", fontWeight: "600" },
      h6: { fontSize: "12px", lineHeight: "1.4", fontWeight: "600" },
    },
  },

  defaultRadius: "md",
  radius: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
  },

  shadows: {
    xs: "0 1px 2px rgba(0,0,0,0.04)",
    sm: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
    md: "0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)",
    lg: "0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.04)",
    xl: "0 12px 32px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06)",
  },

  colors: {
    "portal-gold": [
      "#FBF6EA",
      "#F5EACC",
      "#EDDA9E",
      "#E5C96F",
      "#DCB94A",
      "#D4A843",
      "#B8922F",
      "#9A7B26",
      "#7D641E",
      "#604D17",
    ],
    "portal-bronze": [
      "#F5F0EB",
      "#EAE0D6",
      "#D5C1AC",
      "#C0A283",
      "#AB8362",
      "#8B7355",
      "#756047",
      "#5F4E3A",
      "#493C2D",
      "#332B20",
    ],
    "portal-copper": [
      "#FDF2EA",
      "#FAE3D0",
      "#F4C7A1",
      "#EEAB72",
      "#D99450",
      "#C17F3E",
      "#A66B33",
      "#8A5729",
      "#6E441F",
      "#533216",
    ],
  },

  spacing: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
  },

  components: {
    Button: Button.extend({
      defaultProps: { radius: "md" },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { radius: "md" },
    }),
    TextInput: TextInput.extend({
      defaultProps: { radius: "md" },
    }),
    Textarea: Textarea.extend({
      defaultProps: { radius: "md" },
    }),
    NumberInput: NumberInput.extend({
      defaultProps: { radius: "md" },
    }),
    Select: Select.extend({
      defaultProps: { radius: "md" },
    }),
    Card: Card.extend({
      defaultProps: { radius: "md", shadow: "sm" },
    }),
    Badge: Badge.extend({
      defaultProps: { radius: "sm" },
    }),
    Modal: Modal.extend({
      defaultProps: { radius: "lg", centered: true, transitionProps: { duration: 0 } },
    }),
    Skeleton: Skeleton.extend({
      defaultProps: { radius: "md" },
    }),
    Tabs: Tabs.extend({
      defaultProps: { radius: "md", variant: "pills" },
    }),
    Menu: Menu.extend({
      defaultProps: { radius: "md", shadow: "lg" },
      classNames: {
        dropdown: "infini-menu-dropdown",
        item: "infini-menu-item",
        divider: "infini-menu-divider",
        label: "infini-menu-label",
      },
      styles: {
        dropdown: { padding: "6px", minWidth: "200px" },
        item: { padding: "10px 14px", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 500, gap: "10px" },
        divider: { margin: "6px 8px" },
        label: { padding: "8px 14px 4px", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const },
      },
    }),
  },
});

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export function PortalThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem("theme-mode");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("theme-mode", t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("theme-mode", next);
      return next;
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
  }, [theme]);

  const contextValue = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  /*
   * The notification close button renders an icon only, so screen readers get a
   * nameless control. The label has to be translated, and i18n finishes loading
   * after this module is evaluated but before the tree mounts (bootstrap.tsx
   * awaits i18nReady), so it is resolved here rather than in `portalTheme`.
   */
  const mantineTheme = useMemo(() => ({
    ...portalTheme,
    components: {
      ...portalTheme.components,
      Notification: Notification.extend({
        defaultProps: { closeButtonProps: { "aria-label": i18n.t("common:action.close") } },
      }),
    },
  }), []);

  return (
    <ThemeContext.Provider value={contextValue}>
      <MantineProvider theme={mantineTheme} forceColorScheme={theme}>
        <Notifications position="top-right" />
        <ModalsProvider>
          {children}
        </ModalsProvider>
      </MantineProvider>
    </ThemeContext.Provider>
  );
}
