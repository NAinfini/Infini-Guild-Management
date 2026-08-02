import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  createTheme,
  Drawer,
  Input,
  MantineProvider,
  Menu,
  Modal,
  MultiSelect,
  Notification,
  NumberInput,
  Pagination,
  Paper,
  PasswordInput,
  Popover,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  Table,
  Tabs,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import i18n from "../i18n";
import { usePreferencesStore } from "../stores/preferences";
import classes from "./ThemeProvider.module.css";

const inputClassNames = {
  wrapper: classes.inputWrapper,
  input: classes.input,
};

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

const portalTheme = createTheme({
  primaryColor: "portal-brand",
  autoContrast: true,
  luminanceThreshold: 0.3,
  fontFamily: "var(--font-body)",
  fontFamilyMonospace: "var(--font-code)",

  headings: {
    fontFamily: "var(--font-body)",
    fontWeight: "var(--fw-strong)",
    sizes: {
      h1: { fontSize: "var(--text-page)", lineHeight: "var(--lh-tight)" },
      h2: { fontSize: "var(--text-section)", lineHeight: "1.3" },
      h3: { fontSize: "var(--text-card)", lineHeight: "1.35" },
      h4: { fontSize: "var(--text-card)", lineHeight: "1.35", fontWeight: "var(--fw-medium)" },
      h5: { fontSize: "var(--text-body)", lineHeight: "1.4", fontWeight: "var(--fw-medium)" },
      h6: { fontSize: "var(--text-meta)", lineHeight: "1.4", fontWeight: "var(--fw-medium)" },
    },
  },

  defaultRadius: "sm",
  radius: {
    xs: "var(--radius-control)",
    sm: "var(--radius-control)",
    md: "var(--radius-control)",
    lg: "var(--radius-surface)",
    xl: "var(--radius-overlay)",
  },

  shadows: {
    xs: "var(--edge-top)",
    sm: "var(--edge-top)",
    md: "var(--shadow-overlay)",
    lg: "var(--shadow-overlay)",
    xl: "var(--shadow-overlay)",
  },

  spacing: {
    xs: "var(--space-xs)",
    sm: "var(--space-sm)",
    md: "var(--space-md)",
    lg: "var(--space-lg)",
    xl: "var(--space-xl)",
  },

  colors: {
    "portal-brand": [
      "var(--brand-tint)",
      "var(--brand-tint)",
      "var(--brand-border)",
      "var(--brand-border)",
      "var(--brand-fill)",
      "var(--brand-fill)",
      "var(--brand-fill-hover)",
      "var(--brand-text)",
      "var(--brand-text)",
      "var(--brand-on-fill)",
    ],
  },

  components: {
    Button: Button.extend({
      defaultProps: {
        radius: "sm",
        classNames: { root: classes.buttonRoot },
      },
      vars: (_theme, props) => {
        const usesBrand = props.color === undefined || props.color === "portal-brand";
        const usesFilledVariant = props.variant === undefined || props.variant === "filled";
        return {
          root: usesBrand && usesFilledVariant
            ? {
              "--button-color": "var(--brand-on-fill)",
              "--portal-button-hover-color": "var(--brand-on-fill-hover)",
            }
            : {},
        };
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        radius: "sm",
        classNames: { root: classes.actionIconRoot },
      },
    }),
    Input: Input.extend({ classNames: inputClassNames }),
    TextInput: TextInput.extend({ defaultProps: { radius: "sm", classNames: inputClassNames } }),
    Textarea: Textarea.extend({ defaultProps: { radius: "sm", classNames: inputClassNames } }),
    NumberInput: NumberInput.extend({ defaultProps: { radius: "sm", classNames: inputClassNames } }),
    Select: Select.extend({ defaultProps: { radius: "sm", classNames: inputClassNames } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { radius: "sm", classNames: inputClassNames } }),
    PasswordInput: PasswordInput.extend({ defaultProps: { radius: "sm", classNames: inputClassNames } }),
    Paper: Paper.extend({
      defaultProps: { radius: "lg", classNames: { root: classes.paperRoot } },
    }),
    Card: Card.extend({
      defaultProps: {
        radius: "lg",
        shadow: undefined,
        withBorder: true,
        padding: "md",
        classNames: { root: classes.cardRoot },
      },
    }),
    Badge: Badge.extend({
      defaultProps: { radius: "xl", classNames: { root: classes.badgeRoot } },
    }),
    Skeleton: Skeleton.extend({
      defaultProps: { radius: "md", animate: false, classNames: { root: classes.skeletonRoot } },
    }),
    Tabs: Tabs.extend({
      defaultProps: {
        radius: 0,
        variant: "default",
        classNames: {
          list: classes.tabsList,
          tab: classes.tabsTab,
        },
      },
    }),
    Menu: Menu.extend({
      defaultProps: {
        radius: "sm",
        shadow: "md",
        classNames: {
          dropdown: classes.overlaySurface,
          item: classes.menuItem,
          label: classes.menuLabel,
          divider: classes.menuDivider,
        },
      },
    }),
    Popover: Popover.extend({
      defaultProps: {
        radius: "xl",
        shadow: "md",
        classNames: { dropdown: classes.overlaySurface },
      },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: {
        radius: "sm",
        classNames: { tooltip: classes.tooltip },
      },
    }),
    Table: Table.extend({
      classNames: {
        table: classes.table,
        th: classes.tableHeaderCell,
        tr: classes.tableRow,
      },
    }),
    Pagination: Pagination.extend({
      defaultProps: {
        radius: "sm",
        classNames: { control: classes.paginationControl },
      },
    }),
    Checkbox: Checkbox.extend({ defaultProps: { radius: "sm" } }),
    Switch: Switch.extend({ defaultProps: { radius: "xl" } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: "sm" } }),
    Alert: Alert.extend({
      defaultProps: { radius: "lg", classNames: { root: classes.alertRoot } },
    }),
  },
});

type Theme = "light" | "dark";
type Accent = "teal" | "indigo" | "violet" | "orange";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
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
  /*
   * 模式与主色都是用户偏好，和 locale 走同一条链路。此前模式由本组件
   * 直接读写 localStorage("theme-mode")，绕开了 preferences store —— 两个
   * 偏好系统各存一半，reset 也只清得掉一半。
   */
  const theme = usePreferencesStore((s) => s.themeMode);
  const setTheme = usePreferencesStore((s) => s.setThemeMode);
  const accent = usePreferencesStore((s) => s.accent);
  const setAccent = usePreferencesStore((s) => s.setAccent);
  const reduceMotion = useReducedMotion();

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  useEffect(() => {
    /*
     * data-theme 是模式的唯一真相来源。Mantine 需要的
     * data-mantine-color-scheme 由下面的 forceColorScheme 派生写入，
     * 不作为独立真相。
     */
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
  }, [theme, accent]);

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

  /*
   * Modal and notification close buttons render icons only, so screen readers
   * otherwise get nameless controls. The labels have to be translated, and i18n
   * finishes loading
   * after this module is evaluated but before the tree mounts (bootstrap.tsx
   * awaits i18nReady), so it is resolved here rather than in `portalTheme`.
   */
  const mantineTheme = useMemo(() => ({
    ...portalTheme,
    components: {
      ...portalTheme.components,
      Modal: Modal.extend({
        defaultProps: {
          radius: "xl",
          centered: true,
          transitionProps: { duration: reduceMotion ? 0 : 180, transition: "fade-up" },
          closeButtonProps: { "aria-label": i18n.t("common:action.close") },
          classNames: {
            overlay: classes.modalOverlay,
            content: classes.modalContent,
            header: classes.modalHeader,
            title: classes.modalTitle,
            close: classes.modalClose,
          },
        },
      }),
      Drawer: Drawer.extend({
        defaultProps: {
          transitionProps: { duration: reduceMotion ? 0 : 180 },
          closeButtonProps: { "aria-label": i18n.t("common:action.close") },
          classNames: {
            overlay: classes.modalOverlay,
            content: classes.drawerContent,
            header: classes.modalHeader,
            title: classes.modalTitle,
            close: classes.modalClose,
          },
        },
      }),
      Notification: Notification.extend({
        defaultProps: {
          radius: "lg",
          closeButtonProps: { "aria-label": i18n.t("common:action.close") },
          classNames: { root: classes.notificationRoot },
        },
      }),
    },
  }), [reduceMotion]);

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
