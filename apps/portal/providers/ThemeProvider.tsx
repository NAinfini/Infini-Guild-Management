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
  v8CssVariablesResolver,
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
      /*
       * 品牌填色按钮的四个色值全部自己钉死，不走 Mantine 的色阶推导。
       *
       * 不钉的话，填色来自 --mantine-color-portal-brand-filled，而 Mantine 取的是
       * primaryShade（浅色 6 档、深色 8 档，见 @mantine/core 的
       * MantineCssVariables/get-css-color-variables.mjs），hover 态取 7 档。上面
       * colors["portal-brand"] 是语义映射不是亮度阶梯，6 档正好是
       * --brand-fill-hover、7 档是 --brand-text——于是按钮**静止状态**就已经踩在
       * hover 档的填色上，而 --brand-on-fill 这支墨只按 --brand-fill 校准过。
       * 实测 04342C 压在 23907D 上只有 3.50，不过 AA；theme-tokens.test.ts:704
       * 那条反向断言早就把「900 墨压在 600 填色上不过 AA」这个事实钉住了，只是没人
       * 拦住 Mantine 在静止态就凑出这一对。后果是 14px 的 leftSection 图标（描边
       * 折算下来才 1.17px）在静止时几乎看不见，一 hover 换成纯黑才显形。
       *
       * 钉死之后两个状态各自用设计系统已经校验过的那一对：
       *   静止：--brand-on-fill 压 --brand-fill（theme-tokens.test.ts:699 断言过 AA）
       *   hover：--brand-on-fill-hover 压 --brand-fill-hover（同文件 :714 断言过 AA）
       * 要改这四个值，先去看那两条断言。
       */
      vars: (_theme, props) => {
        const usesBrand = props.color === undefined || props.color === "portal-brand";
        const usesFilledVariant = props.variant === undefined || props.variant === "filled";
        return {
          root: usesBrand && usesFilledVariant
            ? {
              "--button-bg": "var(--brand-fill)",
              "--button-hover": "var(--brand-fill-hover)",
              "--button-color": "var(--brand-on-fill)",
              "--button-hover-color": "var(--brand-on-fill-hover)",
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
      {/*
        * cssVariablesResolver 必须显式钉在 v8 这一版，不是为了怀旧，是因为
        * Mantine 9 的新公式在这套主题上前提不成立。
        *
        * 9 把 --mantine-color-{c}-light 从「主色调透明度」改成了取色阶端点：
        * 亮色模式取第 1 档，暗色模式取 darken(第 9 档, 50%)
        * （@mantine/core 的 esm/core/MantineProvider/MantineCssVariables/
        * get-css-color-variables.mjs）。这假设十档是一条从浅到深的亮度阶梯。
        *
        * 而本主题的 portal-brand 十档是语义映射，不是亮度阶梯（见上面 colors）：
        * 第 0/1 档是 --brand-tint，第 9 档是 --brand-on-fill——**填色之上的前景色**。
        * 套用 9 的公式，暗色模式下每个 variant="light" 的底色会变成
        * darken(--brand-on-fill, 50%)。在浏览器里实测过这组值（十六进制一律
        * 省去井号写，否则会被 inline-colour 那条裸 hex 守卫算成硬编码颜色）：
        *   --brand-on-fill = 04342C，算出来是 021A16 的不透明块，
        *   而页面底色是 1C1C22——底色比页面还黑，等于反过来了；
        *   v8 那条是 color-mix(in srgb, 23907D, transparent 85%)，
        *   一层透明色调，才是这套主题要的东西。
        * 语法合法，语义是错的。全站有 94 处 variant="light"，外加
        * GalleryPage.css 和 WikiPage.css 两处直接吃 --mantine-color-*-light
        * 当背景。styles.css 只覆写了 -light-color（文字色），底色没覆写。
        *
        * v8CssVariablesResolver 是 Mantine 8 默认解析器的原样保留，用的是
        * alpha(主色, 10%/15%)——只依赖「主色」这一个前提，对语义映射同样成立。
        *
        * 要撤掉这行，得先把 colors["portal-brand"] 改成真正的亮度阶梯，
        * 否则撤掉的不是旧观感，是正确性。
        */}
      <MantineProvider theme={mantineTheme} forceColorScheme={theme} cssVariablesResolver={v8CssVariablesResolver}>
        <Notifications position="top-right" />
        <ModalsProvider>
          {children}
        </ModalsProvider>
      </MantineProvider>
    </ThemeContext.Provider>
  );
}
