import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  createTheme,
  MantineProvider,
  Modal,
  NumberInput,
  Select,
  Skeleton,
  Tabs,
  TextInput,
  Textarea,
} from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";

const portalTheme = createTheme({
  primaryColor: "portal-blue",
  fontFamily: '"Inter", system-ui, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", monospace',
  headings: { fontFamily: '"Inter", system-ui, sans-serif', fontWeight: "700" },

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
    "portal-blue": [
      "#EBF2FF", // 0 – lightest tint
      "#D6E4FF", // 1
      "#ADC8FF", // 2
      "#84ABFF", // 3
      "#5B8EFF", // 4
      "#3B82F6", // 5 – base (--color-primary)
      "#2563EB", // 6
      "#1D4ED8", // 7
      "#1E40AF", // 8
      "#1E3A8A", // 9 – darkest
    ],
    "portal-violet": [
      "#F1ECFF",
      "#E4D9FF",
      "#C9B3FF",
      "#AE8DFF",
      "#9B74FF",
      "#8B5CF6", // 5 – base (--color-secondary)
      "#7C3AED",
      "#6D28D9",
      "#5B21B6",
      "#4C1D95",
    ],
    "portal-cyan": [
      "#ECFEFF",
      "#CFFAFE",
      "#A5F3FC",
      "#67E8F9",
      "#22D3EE",
      "#06B6D4", // 5 – base (--color-accent)
      "#0891B2",
      "#0E7490",
      "#155E75",
      "#164E63",
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
      defaultProps: { radius: "lg", centered: true },
    }),
    Skeleton: Skeleton.extend({
      defaultProps: { radius: "md" },
    }),
    Tabs: Tabs.extend({
      defaultProps: { radius: "md" },
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

  return (
    <ThemeContext.Provider value={contextValue}>
      <MantineProvider theme={portalTheme} forceColorScheme={theme}>
        <Notifications position="top-right" />
        <ModalsProvider>
          {children}
        </ModalsProvider>
      </MantineProvider>
    </ThemeContext.Provider>
  );
}
