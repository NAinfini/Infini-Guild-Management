import { createTheme, type MantineColorsTuple, type MantineThemeOverride } from "@mantine/core";

import { contrastRatio, deriveActiveColor, pickReadableTextColor } from "@infini-dev-kit/utils/color";
import { getThemeSpec, type ThemeSpec } from "@infini-dev-kit/theme-core";
import { getThemeOverrides } from "@infini-dev-kit/adapter-mantine";
import { buildMantineComponents } from "./mantine-components";
import { resolveControlGlow } from "@infini-dev-kit/theme-core";
import type { ComposeMantineThemeOptions, MantineThemeConfig } from "./mantine-types";

export type {
  MantineColorSchemePreference,
  MantineThemeToken,
  ScopedCssVariables,
  MantineThemeConfig,
  ComposeMantineThemeOptions,
} from "./mantine-types";
export { buildScopedThemeClass, buildScopedCssVariables } from "@infini-dev-kit/adapter-mantine";
export { applyLocaleTypography, type LocaleCode } from "@infini-dev-kit/adapter-mantine";

export function composeMantineTheme(options: ComposeMantineThemeOptions): MantineThemeConfig {
  const theme = getThemeSpec(options.themeId);
  const surface = theme.foundation.surface;
  const baseBackground = theme.foundation.background;
  const safeInfo = ensureContrastColor(theme.palette.accent, surface, 3);
  const safeSuccess = ensureContrastColor(theme.palette.success, surface, 3);
  const safeWarning = ensureContrastColor(theme.palette.warning, surface, 3);
  const safeDanger = ensureContrastColor(theme.palette.danger, surface, 3.2);
  const safeBorder = ensureContrastColor(theme.foundation.borderColor, surface, 1.8);
  const safeTextBase = ensureContrastColor(theme.palette.text, baseBackground, 4.5);
  const componentTokens = buildComponentTokens(theme);
  const colorScheme = options.forcedColorScheme ?? theme.colorScheme;
  const token = {
    colorPrimary: theme.palette.primary,
    colorInfo: safeInfo,
    colorSuccess: safeSuccess,
    colorWarning: safeWarning,
    colorDanger: safeDanger,
    colorTextBase: safeTextBase,
    colorBgBase: theme.foundation.background,
    colorBgContainer: theme.foundation.surface,
    colorBorder: safeBorder,
    borderRadius: theme.foundation.radius,
    lineWidth: theme.foundation.borderWidth,
    fontFamily: theme.typography.en.body,
    fontFamilyZh: theme.typography.zh?.body ?? theme.typography.en.body,
    fontFamilyJa: theme.typography.ja?.body ?? theme.typography.en.body,
    fontHeading: theme.typography.en.heading,
    fontHeadingZh: theme.typography.zh?.heading ?? theme.typography.en.heading,
    fontHeadingJa: theme.typography.ja?.heading ?? theme.typography.en.heading,
    fontMono: theme.typography.en.mono,
  };

  return {
    colorScheme,
    token,
    components: componentTokens,
    theme: buildMantineTheme(theme, token, componentTokens),
  };
}

function toTuple(color: string): MantineColorsTuple {
  return [
    color,
    color,
    color,
    color,
    color,
    color,
    color,
    color,
    color,
    color,
  ];
}

function buildDarkTuple(theme: ThemeSpec): MantineColorsTuple {
  const readableBody = ensureContrastColor(theme.palette.text, theme.foundation.background, 4.5);
  const readableMuted = ensureContrastColor(theme.palette.textMuted, theme.foundation.background, 3);

  return [
    readableBody,
    readableMuted,
    "#A2A7B8",
    "#80859A",
    "#5E6477",
    "#474C5E",
    "#373B4A",
    "#2A2D3A",
    "#1C1E29",
    theme.foundation.background,
  ];
}

function buildGrayTuple(theme: ThemeSpec): MantineColorsTuple {
  if (theme.colorScheme === "dark") {
    return [
      "#F1F3F5",
      "#D9DCE5",
      "#B8BFCA",
      "#96A0AE",
      "#778294",
      "#5C6678",
      "#434B5D",
      "#313747",
      "#1F2433",
      "#121621",
    ];
  }

  return [
    "#F8F9FA",
    "#F1F3F5",
    "#E9ECEF",
    "#DEE2E6",
    "#CED4DA",
    "#ADB5BD",
    "#868E96",
    "#495057",
    "#343A40",
    "#212529",
  ];
}

function buildMantineTheme(
  theme: ThemeSpec,
  token: MantineThemeConfig["token"],
  componentTokens: MantineThemeConfig["components"],
): MantineThemeOverride {
  return createTheme({
    autoContrast: true,
    luminanceThreshold: 0.32,
    primaryColor: "infini-primary",
    primaryShade: theme.colorScheme === "dark" ? 4 : 6,
    colors: {
      "infini-primary": toTuple(token.colorPrimary),
      "infini-accent": toTuple(token.colorInfo),
      "infini-success": toTuple(token.colorSuccess),
      "infini-warning": toTuple(token.colorWarning),
      "infini-danger": toTuple(token.colorDanger),
      gray: buildGrayTuple(theme),
      dark: buildDarkTuple(theme),
    },
    black: "#000000",
    white: "#ffffff",
    fontFamily: token.fontFamily,
    fontFamilyMonospace: theme.typography.en.mono,
    defaultRadius: token.borderRadius,
    radius: {
      xs: `${Math.max(2, Math.round(token.borderRadius * 0.5))}px`,
      sm: `${Math.max(2, Math.round(token.borderRadius * 0.75))}px`,
      md: `${token.borderRadius}px`,
      lg: `${Math.max(4, Math.round(token.borderRadius * 1.15))}px`,
      xl: `${Math.max(8, Math.round(token.borderRadius * 1.35))}px`,
    },
    headings: {
      fontFamily: theme.typography.en.heading,
      fontWeight: String(theme.typography.weights.bold),
    },
    defaultGradient: {
      from: theme.palette.primary,
      to: theme.palette.secondary,
      deg: 135,
    },
    other: {
      infini: {
        id: theme.id,
        token,
        componentTokens,
        palette: theme.palette,
        depth: theme.depth,
        overlays: theme.overlays,
        motion: theme.motion,
      },
    },
    components: buildMantineComponents(theme),
  });
}

function buildComponentTokens(theme: ThemeSpec): Record<string, Record<string, string | number>> {
  const surface = theme.foundation.surface;
  const safeBorder = ensureContrastColor(theme.foundation.borderColor, surface, 1.8);
  const safeSuccess = ensureContrastColor(theme.palette.success, surface, 3);
  const safeInfo = ensureContrastColor(theme.palette.accent, surface, 3);
  const safeWarning = ensureContrastColor(theme.palette.warning, surface, 3);
  const textCandidates = [theme.palette.text, "#111111", "#FFFFFF"];
  const safePrimaryText = pickBestTextColor(
    surface,
    [theme.palette.primary, theme.palette.accent, ...textCandidates],
    4.5,
  );
  const safePrimaryTextOnAccent = pickBestTextColor(
    theme.foundation.surfaceAccent,
    [theme.palette.primary, theme.palette.accent, ...textCandidates],
    4.5,
  );
  const safeSecondaryText = pickBestTextColor(
    surface,
    [theme.palette.secondary, theme.palette.primary, ...textCandidates],
    4.5,
  );
  const safeAccentText = pickBestTextColor(
    surface,
    [theme.palette.accent, theme.palette.primary, ...textCandidates],
    4.5,
  );
  const safeMutedText = ensureContrastColor(theme.palette.textMuted, theme.foundation.background, 4.5);
  const safeBodyText = ensureContrastColor(theme.palette.text, theme.foundation.background, 4.5);

  const buttonText = resolveButtonTextColor(theme);
  const buttonRadius = resolveButtonRadius(theme);
  const inputRadius = resolveInputRadius(theme);
  const selectRadius = resolveSelectRadius(theme);
  const controlGlowPrimary = resolveControlGlow(theme, "primary");
  const controlGlowSuccess = resolveControlGlow(theme, "success");
  const controlGlowWarning = resolveControlGlow(theme, "warning");
  const controlGlowError = resolveControlGlow(theme, "error");
  const controlGlowInfo = resolveControlGlow(theme, "info");

  return {
    Button: {
      colorPrimary: theme.palette.primary,
      colorTextLightSolid: buttonText,
      fontFamily: theme.typography.en.heading,
      borderRadius: buttonRadius,
      fontWeight: Math.min(700, theme.typography.weights.bold),
      lineWidth: theme.foundation.borderWidth,
      defaultBorderColor: safeBorder,
      boxShadow: theme.depth.buttonShadow,
      defaultShadow: theme.depth.buttonShadow,
      primaryShadow: theme.depth.buttonShadow,
      dangerShadow: theme.depth.buttonShadowPressed,
    },
    Input: {
      colorBorder: safeBorder,
      borderRadius: inputRadius,
      activeBorderColor: theme.palette.primary,
      activeShadow: controlGlowPrimary,
      successActiveShadow: controlGlowSuccess,
      warningActiveShadow: controlGlowWarning,
      errorActiveShadow: controlGlowError,
      infoActiveShadow: controlGlowInfo,
      hoverBg: theme.foundation.surface,
      activeBg: theme.foundation.surface,
      addonBg: theme.foundation.surfaceAccent,
    },
    Mentions: {
      borderRadius: inputRadius,
      activeBorderColor: theme.palette.primary,
      activeShadow: controlGlowPrimary,
      successActiveShadow: controlGlowSuccess,
      warningActiveShadow: controlGlowWarning,
      errorActiveShadow: controlGlowError,
      infoActiveShadow: controlGlowInfo,
    },
    InputNumber: {
      borderRadius: inputRadius,
      activeBorderColor: theme.palette.primary,
      activeShadow: controlGlowPrimary,
      successActiveShadow: controlGlowSuccess,
      warningActiveShadow: controlGlowWarning,
      errorActiveShadow: controlGlowError,
      infoActiveShadow: controlGlowInfo,
      handleBg: theme.foundation.surfaceAccent,
    },
    DatePicker: {
      borderRadius: inputRadius,
      activeBorderColor: theme.palette.primary,
      activeShadow: controlGlowPrimary,
      successActiveShadow: controlGlowSuccess,
      warningActiveShadow: controlGlowWarning,
      errorActiveShadow: controlGlowError,
      infoActiveShadow: controlGlowInfo,
      cellHoverWithRangeBg: theme.foundation.surfaceAccent,
      controlItemBgActive: theme.foundation.surfaceAccent,
    },
    Select: {
      borderRadius: selectRadius,
      selectorBg: theme.foundation.surface,
      optionSelectedBg: theme.foundation.surfaceAccent,
      optionActiveBg: theme.foundation.surfaceAccent,
      activeBorderColor: theme.palette.primary,
      activeShadow: controlGlowPrimary,
      successActiveShadow: controlGlowSuccess,
      warningActiveShadow: controlGlowWarning,
      errorActiveShadow: controlGlowError,
      infoActiveShadow: controlGlowInfo,
      dropdownShadow: theme.depth.dropdownShadow,
    },
    Cascader: {
      borderRadius: selectRadius,
      optionSelectedBg: theme.foundation.surfaceAccent,
      optionSelectedFontWeight: Math.min(700, theme.typography.weights.bold),
      dropdownHeight: 240,
      dropdownMenuBg: theme.foundation.surface,
      dropdownEdgeChildVerticalPadding: 2,
      controlItemBgActive: theme.foundation.surfaceAccent,
      controlItemBgHover: theme.foundation.surfaceAccent,
      activeShadow: controlGlowPrimary,
      successActiveShadow: controlGlowSuccess,
      warningActiveShadow: controlGlowWarning,
      errorActiveShadow: controlGlowError,
      infoActiveShadow: controlGlowInfo,
      dropdownLineHeight: 1.4,
      dropdownFontSize: 13,
      dropdownShadow: theme.depth.dropdownShadow,
    },
    TreeSelect: {
      borderRadius: selectRadius,
      nodeSelectedBg: theme.foundation.surfaceAccent,
      nodeHoverBg: theme.foundation.surfaceAccent,
      titleHeight: 28,
      dropdownBg: theme.foundation.surface,
      dropdownStyle: theme.depth.dropdownShadow,
      activeShadow: controlGlowPrimary,
      successActiveShadow: controlGlowSuccess,
      warningActiveShadow: controlGlowWarning,
      errorActiveShadow: controlGlowError,
      infoActiveShadow: controlGlowInfo,
    },
    ColorPicker: {
      borderRadius: Math.max(2, Math.round(theme.foundation.radius * 0.6)),
    },
    Transfer: {
      headerBg: theme.foundation.surfaceAccent,
      listBg: theme.foundation.surface,
      borderRadius: Math.max(2, Math.round(theme.foundation.radius * 0.7)),
      lineWidth: theme.foundation.borderWidth,
      controlItemBgHover: theme.foundation.surfaceAccent,
    },
    Card: {
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      headerBg: theme.foundation.surfaceAccent,
      colorBorderSecondary: safeBorder,
      lineWidth: theme.foundation.borderWidth,
      boxShadowTertiary: theme.depth.cardShadow,
    },
    Collapse: {
      headerBg: theme.foundation.surfaceAccent,
      contentBg: theme.foundation.surface,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      lineWidth: theme.foundation.borderWidth,
    },
    Timeline: {
      dotBg: theme.foundation.surface,
      tailColor: safeBorder,
      itemPaddingBottom: 18,
    },
    Descriptions: {
      labelBg: theme.foundation.surfaceAccent,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      lineWidth: theme.foundation.borderWidth,
    },
    Tree: {
      nodeSelectedBg: theme.foundation.surfaceAccent,
      nodeHoverBg: theme.foundation.surfaceAccent,
      borderRadius: Math.max(2, theme.foundation.radius),
    },
    Table: {
      headerBg: theme.foundation.surfaceAccent,
      headerColor: safeBodyText,
      rowHoverBg: theme.foundation.surface,
      borderColor: safeBorder,
      lineWidth: theme.foundation.borderWidth,
      borderRadius: Math.max(2, theme.foundation.radius),
    },
    Modal: {
      contentBg: theme.foundation.surface,
      headerBg: theme.foundation.surface,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      boxShadow: theme.depth.dropdownShadow,
    },
    Tooltip: {
      borderRadius: Math.max(2, Math.round(theme.foundation.radius * 0.55)),
      colorBgSpotlight: theme.foundation.surfaceAccent,
      colorTextLightSolid: pickReadableTextColor(theme.foundation.surfaceAccent),
    },
    Popover: {
      colorBgElevated: theme.foundation.surface,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      boxShadow: theme.depth.dropdownShadow,
    },
    Popconfirm: {
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      boxShadow: theme.depth.dropdownShadow,
    },
    Notification: {
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      colorBgElevated: theme.foundation.surface,
      boxShadow: theme.depth.dropdownShadow,
    },
    Drawer: {
      colorBgElevated: theme.foundation.surface,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      boxShadow: theme.depth.dropdownShadow,
    },
    Menu: {
      itemBg: theme.foundation.surface,
      itemSelectedBg: theme.foundation.surfaceAccent,
      itemSelectedColor: safePrimaryTextOnAccent,
      itemHoverBg: theme.foundation.surfaceAccent,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      itemBorderRadius: Math.max(2, Math.round(theme.foundation.radius * 0.65)),
      lineWidth: theme.foundation.borderWidth,
    },
    Divider: {
      colorSplit: safeBorder,
      lineWidth: theme.foundation.borderWidth,
    },
    Badge: {
      indicatorZIndex: 10,
    },
    Avatar: {
      borderRadius: Math.max(2, Math.round(theme.foundation.radius * 0.75)),
      colorBgBase: theme.foundation.surfaceAccent,
    },
    Slider: {
      trackBg: theme.palette.primary,
      handleColor: theme.palette.primary,
      railBg: theme.foundation.surfaceAccent,
      handleActiveColor: theme.palette.secondary,
    },
    Switch: {
      colorPrimary: theme.palette.success,
      handleBg: theme.foundation.surface,
      handleShadow: theme.depth.switchShadow,
      trackMinWidth: getThemeOverrides(theme).switch.trackMinWidth,
      trackHeight: getThemeOverrides(theme).switch.trackHeight,
      trackPadding: getThemeOverrides(theme).switch.trackPadding,
      borderRadius: Math.max(10, Math.round(theme.foundation.radius * 0.8)),
    },
    Checkbox: {
      colorPrimary: theme.palette.primary,
      borderRadiusSM: resolveCheckboxRadius(theme),
      lineWidth: Math.max(1, Math.min(2, theme.foundation.borderWidth)),
      colorBorder: safeBorder,
    },
    Radio: {
      colorPrimary: theme.palette.primary,
      dotSize: 8,
      lineWidth: theme.foundation.borderWidth,
    },
    Tag: {
      borderRadiusSM: Math.max(2, Math.round(theme.foundation.radius * 0.5)),
      lineWidth: theme.foundation.borderWidth,
      ...resolveTagColorMix(theme),
    },
    Tabs: {
      cardBg: theme.foundation.surface,
      inkBarColor: theme.palette.primary,
      itemSelectedColor: safePrimaryTextOnAccent,
      itemHoverColor: safeSecondaryText,
    },
    Segmented: {
      itemSelectedBg: theme.palette.primary,
      itemSelectedColor: buttonText,
      trackBg: theme.foundation.surface,
      borderRadius: Math.max(4, Math.round(theme.foundation.radius * 0.7)),
    },
    Typography: {
      fontFamily: theme.typography.en.heading,
      colorText: safeBodyText,
      colorTextSecondary: safeMutedText,
      colorLink: safePrimaryText,
      colorLinkHover: safeAccentText,
      fontWeightStrong: theme.typography.weights.bold,
    },
    Spin: {
      colorPrimary: theme.palette.primary,
    },
    Skeleton: {
      borderRadiusSM: Math.max(2, Math.round(theme.foundation.radius * 0.5)),
      gradientFromColor: theme.foundation.surfaceAccent,
      gradientToColor: theme.foundation.surface,
    },
    Progress: {
      colorSuccess: safeSuccess,
      defaultColor: theme.palette.primary,
      remainingColor: theme.foundation.surfaceAccent,
    },
    Alert: {
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      colorSuccessBorder: safeSuccess,
      colorInfoBorder: safeInfo,
      colorWarningBorder: safeWarning,
      colorErrorBorder: theme.palette.danger,
    },
    Breadcrumb: {
      itemColor: safeMutedText,
      lastItemColor: safeBodyText,
      linkColor: safePrimaryText,
      separatorColor: safeBorder,
    },
    Steps: {
      colorPrimary: theme.palette.primary,
      iconSize: 28,
      lineWidth: theme.foundation.borderWidth,
    },
    Rate: {
      starColor: theme.palette.secondary,
      starSize: 18,
    },
    Form: {
      labelColor: safeBodyText,
      colorError: theme.palette.danger,
      labelRequiredMarkColor: theme.palette.danger,
      verticalLabelPadding: "0 0 4px",
    },
    FloatButton: {
      colorBgElevated: theme.foundation.surface,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
      boxShadow: theme.depth.dropdownShadow,
    },
    Watermark: {
      colorFill: safeMutedText,
    },
    Image: {
      colorBgMask: theme.overlays.modalBackdrop,
      previewOperationColor: theme.palette.text,
    },
    Empty: {
      colorText: safeMutedText,
      colorTextDisabled: safeMutedText,
    },
    Result: {
      colorSuccess: safeSuccess,
      colorError: theme.palette.danger,
      colorInfo: safeInfo,
      colorWarning: safeWarning,
    },
    Statistic: {
      fontFamily: theme.typography.en.heading,
      colorTextHeading: safeBodyText,
      colorTextDescription: safeMutedText,
    },
    QRCode: {
      colorBorder: safeBorder,
      borderRadiusLG: Math.max(2, theme.foundation.radius),
    },
  };
}

function resolveButtonTextColor(theme: ThemeSpec): string {
  return pickBestTextColor(
    theme.palette.primary,
    [
      theme.palette.text,
      theme.foundation.background,
      theme.foundation.surface,
      "#111111",
      "#FFFFFF",
      pickReadableTextColor(theme.palette.primary),
    ],
    4.5,
  );
}

function resolveButtonRadius(theme: ThemeSpec): number {
  switch (theme.id) {
    case "default":
      return Math.max(2, Math.round(theme.foundation.radius * 0.75));
    case "chibi":
      return Math.max(12, Math.round(theme.foundation.radius * 0.8));
    case "cyberpunk":
      return Math.max(2, theme.foundation.radius);
    case "neu-brutalism":
      return 0;
    case "black-gold":
      return Math.max(4, Math.round(theme.foundation.radius * 0.75));
    case "red-gold":
      return Math.max(6, Math.round(theme.foundation.radius * 0.8));
    default:
      return Math.max(2, Math.round(theme.foundation.radius * 0.75));
  }
}

function resolveInputRadius(theme: ThemeSpec): number {
  switch (theme.id) {
    case "default":
      return Math.max(2, Math.round(theme.foundation.radius * 0.75));
    case "chibi":
      return Math.max(14, Math.round(theme.foundation.radius * 0.72));
    case "cyberpunk":
      return Math.max(2, theme.foundation.radius);
    case "neu-brutalism":
      return 0;
    case "black-gold":
      return Math.max(6, Math.round(theme.foundation.radius * 0.75));
    case "red-gold":
      return Math.max(7, Math.round(theme.foundation.radius * 0.7));
    default:
      return Math.max(2, Math.round(theme.foundation.radius * 0.75));
  }
}

function resolveSelectRadius(theme: ThemeSpec): number {
  return getThemeOverrides(theme).selectRadius(theme.foundation.radius);
}

function resolveCheckboxRadius(theme: ThemeSpec): number {
  return getThemeOverrides(theme).checkboxRadius(theme.foundation.radius);
}

function ensureContrastColor(color: string, background: string, minContrast: number): string {
  let next = color;
  let attempts = 0;

  while (contrastRatio(background, next) < minContrast && attempts < 6) {
    next = deriveActiveColor(next);
    attempts += 1;
  }

  return next;
}

function pickBestTextColor(background: string, candidates: string[], minContrast = 4.5): string {
  const uniqueCandidates = [...new Set(candidates)];
  let bestColor = uniqueCandidates[0] ?? pickReadableTextColor(background);
  let bestContrast = contrastRatio(background, bestColor);

  for (const candidate of uniqueCandidates) {
    const candidateContrast = contrastRatio(background, candidate);
    if (candidateContrast >= minContrast) {
      return candidate;
    }
    if (candidateContrast > bestContrast) {
      bestColor = candidate;
      bestContrast = candidateContrast;
    }
  }

  return bestColor;
}

function resolveTagColorMix(theme: ThemeSpec): Record<string, string> {
  const mode = getThemeOverrides(theme).tagColorMix;
  const p = theme.palette;

  switch (mode) {
    case "pastel":
      return {
        colorSuccess: `color-mix(in srgb, ${p.success} 90%, ${p.text} 10%)`,
        colorSuccessBg: `color-mix(in srgb, ${p.success} 62%, #ffffff 38%)`,
        colorSuccessBorder: `color-mix(in srgb, ${p.success} 80%, #ffffff 20%)`,
        colorWarning: `color-mix(in srgb, ${p.warning} 82%, ${p.text} 18%)`,
        colorWarningBg: `color-mix(in srgb, ${p.warning} 68%, #ffffff 32%)`,
        colorWarningBorder: `color-mix(in srgb, ${p.warning} 84%, #ffffff 16%)`,
        colorError: `color-mix(in srgb, ${p.danger} 88%, ${p.text} 12%)`,
        colorErrorBg: `color-mix(in srgb, ${p.danger} 58%, #ffffff 42%)`,
        colorErrorBorder: `color-mix(in srgb, ${p.danger} 80%, #ffffff 20%)`,
      };
    case "bold":
      return {
        colorSuccess: p.success,
        colorSuccessBg: `color-mix(in srgb, ${p.success} 72%, #ffffff 28%)`,
        colorSuccessBorder: p.success,
        colorWarning: `color-mix(in srgb, ${p.warning} 88%, #000000 12%)`,
        colorWarningBg: `color-mix(in srgb, ${p.warning} 72%, #ffffff 28%)`,
        colorWarningBorder: `color-mix(in srgb, ${p.warning} 88%, #000000 12%)`,
        colorError: p.danger,
        colorErrorBg: `color-mix(in srgb, ${p.danger} 62%, #ffffff 38%)`,
        colorErrorBorder: p.danger,
      };
    default:
      return {};
  }
}

