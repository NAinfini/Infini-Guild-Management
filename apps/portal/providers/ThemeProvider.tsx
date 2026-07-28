import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
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
import { ConfirmDialogProvider } from "../components/shared/ConfirmDialog";
import i18n from "../i18n";
import { usePreferencesStore } from "../stores/preferences";

const portalTheme = createTheme({
  primaryColor: "portal-accent",
  /*
   * autoContrast 已移除。它按填充色的相对亮度猜文字色，阈值 0.3 是
   * 为金色（0.31）手调的魔数 —— 换主色就得重调。现在填充上的文字色
   * 由 --accent-on-fill 显式给出，每个主色每个模式各算一次。
   */
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

  defaultRadius: "md",
  radius: {
    xs: "var(--radius-xs)",
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
    xl: "var(--radius-xl)",
  },

  shadows: {
    xs: "var(--shadow-xs)",
    sm: "var(--shadow-sm)",
    md: "var(--shadow-md)",
    lg: "var(--shadow-lg)",
    xl: "var(--shadow-lg)",
  },

  spacing: {
    xs: "var(--space-xs)",
    sm: "var(--space-sm)",
    md: "var(--space-md)",
    lg: "var(--space-lg)",
    xl: "var(--space-xl)",
  },

  colors: {
    /*
     * Mantine 的色阶要求正好 10 档。这里每一档都指向 --accent-*，
     * 于是切换 [data-accent] 会同时换掉 Mantine 组件与手写 CSS 的颜色，
     * 不存在「Mantine 那半边还是旧色」的状态。
     * 7 档色板铺到 10 格：装饰档复用，文字档与墨档各占一格。
     */
    "portal-accent": [
      "var(--accent-50)",
      "var(--accent-100)",
      "var(--accent-300)",
      "var(--accent-300)",
      "var(--accent-500)",
      "var(--accent-500)",
      "var(--accent-600)",
      "var(--accent-700)",
      "var(--accent-700)",
      "var(--accent-900)",
    ],
  },

  components: {
    Button: Button.extend({ defaultProps: { radius: "md" } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: "md" } }),
    TextInput: TextInput.extend({ defaultProps: { radius: "md" } }),
    Textarea: Textarea.extend({ defaultProps: { radius: "md" } }),
    NumberInput: NumberInput.extend({ defaultProps: { radius: "md" } }),
    Select: Select.extend({ defaultProps: { radius: "md" } }),
    Card: Card.extend({ defaultProps: { radius: "md", shadow: "sm" } }),
    Badge: Badge.extend({ defaultProps: { radius: "sm" } }),
    Modal: Modal.extend({ defaultProps: { radius: "lg", centered: true, transitionProps: { duration: 0 } } }),
    Skeleton: Skeleton.extend({ defaultProps: { radius: "md" } }),
    Tabs: Tabs.extend({ defaultProps: { radius: "md", variant: "pills" } }),
    Menu: Menu.extend({
      defaultProps: { radius: "md", shadow: "lg" },
      classNames: {
        dropdown: "infini-menu-dropdown",
        item: "infini-menu-item",
        divider: "infini-menu-divider",
        label: "infini-menu-label",
      },
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

  const contextValue = useMemo(
    () => ({ theme, setTheme, toggleTheme, accent, setAccent }),
    [theme, setTheme, toggleTheme, accent, setAccent],
  );

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
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </ModalsProvider>
      </MantineProvider>
    </ThemeContext.Provider>
  );
}
