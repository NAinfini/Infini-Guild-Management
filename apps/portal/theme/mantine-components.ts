import type { MantineThemeOverride } from "@mantine/core";

import { contrastRatio, pickReadableTextColor } from "@infini-dev-kit/utils/color";
import type { ThemeSpec } from "@infini-dev-kit/theme-core";
import { getThemeOverrides } from "@infini-dev-kit/adapter-mantine";

export function buildMantineComponents(
  theme: ThemeSpec,
): MantineThemeOverride["components"] {
  const buttonRadius = resolveButtonRadius(theme);
  const inputRadius = resolveInputRadius(theme);
  const selectRadius = resolveSelectRadius(theme);
  const buttonText = resolveButtonTextColor(theme);
  const baseText = ensureReadableColor(theme.foundation.background, theme.palette.text, 4.5);
  const buttonSurfaceText = ensureReadableColor(theme.foundation.surface, theme.palette.text, 4.5);
  const surfaceText = ensureReadableColor(theme.foundation.surface, theme.palette.text, 4.5);
  const surfaceMutedText = ensureReadableColor(theme.foundation.surface, theme.palette.textMuted, 3);
  const accentText = ensureReadableColor(theme.foundation.surfaceAccent, theme.palette.text, 4.5);
  const inputText = ensureReadableColor(theme.foundation.surface, theme.palette.text, 4.5);
  const inputPlaceholder = ensureReadableColor(theme.foundation.surface, theme.palette.textMuted, 3);
  const inputDisabledText = ensureReadableColor(theme.foundation.surfaceAccent, theme.palette.textMuted, 3);
  const dropdownText = ensureReadableColor(theme.foundation.surface, theme.palette.text, 4.5);
  const optionActiveText = ensureReadableColor(theme.foundation.surfaceAccent, theme.palette.text, 4.5);
  const badgeRadius = Math.max(2, Math.round(theme.foundation.radius * 0.45));
  const tooltipRadius = Math.max(2, Math.round(theme.foundation.radius * 0.55));
  const motionTransition = "transform var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease), box-shadow var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease)";

  const components: MantineThemeOverride["components"] = {
    Input: {
      defaultProps: {
        radius: inputRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.inputInsetShadow,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
          "&:disabled, &[data-disabled]": {
            background: theme.foundation.surfaceAccent,
            color: inputDisabledText,
            opacity: 1,
          },
        },
      },
    },
    Button: {
      defaultProps: {
        radius: buttonRadius,
      },
      styles: {
        root: {
          fontFamily: theme.typography.en.heading,
          fontWeight: Math.min(700, theme.typography.weights.bold),
          borderWidth: theme.foundation.borderWidth,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.buttonShadow,
          color: buttonSurfaceText,
          transition: motionTransition,
        },
      },
    },
    Card: {
      defaultProps: {
        radius: Math.max(2, theme.foundation.radius),
        withBorder: true,
      },
      styles: {
        root: {
          boxShadow: theme.depth.cardShadow,
          borderWidth: theme.foundation.borderWidth,
          borderColor: theme.foundation.borderColor,
          background: theme.foundation.surface,
          color: surfaceText,
        },
      },
    },
    TextInput: {
      defaultProps: {
        radius: inputRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.inputInsetShadow,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
      },
    },
    PasswordInput: {
      defaultProps: {
        radius: inputRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.inputInsetShadow,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
      },
    },
    NumberInput: {
      defaultProps: {
        radius: inputRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.inputInsetShadow,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
        section: {
          color: inputPlaceholder,
        },
      },
    },
    Textarea: {
      defaultProps: {
        radius: inputRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.inputInsetShadow,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
      },
    },
    Select: {
      defaultProps: {
        radius: selectRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
        dropdown: {
          background: theme.foundation.surface,
          color: dropdownText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.dropdownShadow,
        },
        option: {
          color: dropdownText,
          "&[data-combobox-active], &[data-combobox-selected]": {
            background: theme.foundation.surfaceAccent,
            color: optionActiveText,
          },
        },
      },
    },
    MultiSelect: {
      defaultProps: {
        radius: selectRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
        dropdown: {
          background: theme.foundation.surface,
          color: dropdownText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.dropdownShadow,
        },
        option: {
          color: dropdownText,
          "&[data-combobox-active], &[data-combobox-selected]": {
            background: theme.foundation.surfaceAccent,
            color: optionActiveText,
          },
        },
      },
    },
    Autocomplete: {
      defaultProps: {
        radius: selectRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
        dropdown: {
          background: theme.foundation.surface,
          color: dropdownText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.dropdownShadow,
        },
        option: {
          color: dropdownText,
          "&[data-combobox-active], &[data-combobox-selected]": {
            background: theme.foundation.surfaceAccent,
            color: optionActiveText,
          },
        },
      },
    },
    DatePickerInput: {
      defaultProps: {
        radius: selectRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
        dropdown: {
          background: theme.foundation.surface,
          color: dropdownText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.dropdownShadow,
        },
        weekday: {
          color: surfaceMutedText,
        },
        day: {
          color: dropdownText,
        },
        calendarHeaderLevel: {
          color: dropdownText,
        },
        calendarHeaderControl: {
          color: dropdownText,
        },
      },
    },
    TimeInput: {
      defaultProps: {
        radius: inputRadius,
      },
      styles: {
        input: {
          background: theme.foundation.surface,
          color: inputText,
          borderColor: theme.foundation.borderColor,
          boxShadow: theme.depth.inputInsetShadow,
          "&::placeholder": {
            color: inputPlaceholder,
            opacity: 1,
          },
        },
        section: {
          color: inputPlaceholder,
        },
      },
    },
    SegmentedControl: {
      styles: {
        root: {
          borderRadius: Math.max(4, Math.round(theme.foundation.radius * 0.7)),
          background: theme.foundation.surface,
          border: `${theme.foundation.borderWidth}px ${theme.foundation.borderStyle} ${theme.foundation.borderColor}`,
          color: surfaceText,
        },
        label: {
          color: surfaceText,
        },
        indicator: {
          background: theme.palette.primary,
          color: buttonText,
        },
      },
    },
    Modal: {
      defaultProps: {
        radius: Math.max(2, theme.foundation.radius),
        closeButtonProps: { "aria-label": "Close" },
      },
      styles: {
        content: {
          background: theme.foundation.surface,
          boxShadow: theme.depth.dropdownShadow,
          color: surfaceText,
        },
        header: {
          background: theme.foundation.surface,
          color: surfaceText,
        },
      },
    },
    Drawer: {
      defaultProps: {
        closeButtonProps: { "aria-label": "Close" },
      },
      styles: {
        content: {
          background: theme.foundation.surface,
          color: surfaceText,
        },
        header: {
          background: theme.foundation.surface,
          color: surfaceText,
        },
      },
    },
    Badge: {
      defaultProps: {
        radius: badgeRadius,
        autoContrast: true,
      },
      styles: {
        root: {
          borderWidth: Math.min(theme.foundation.borderWidth, 2),
          borderStyle: theme.foundation.borderStyle,
          borderColor: theme.foundation.borderColor,
        },
      },
    },
    Tabs: {
      styles: {
        tab: {
          fontFamily: theme.typography.en.heading,
          fontWeight: Math.min(700, theme.typography.weights.bold),
          color: theme.palette.textMuted,
        },
        panel: {
          color: surfaceText,
        },
        tabLabel: {
          color: "inherit",
        },
        list: {
          borderColor: theme.foundation.borderColor,
        },
      },
    },
    Text: {
      styles: {
        root: {
          color: baseText,
        },
      },
    },
    Title: {
      styles: {
        root: {
          color: baseText,
          fontFamily: theme.typography.en.heading,
          fontWeight: Math.min(700, theme.typography.weights.bold),
        },
      },
    },
    Tooltip: {
      defaultProps: {
        radius: tooltipRadius,
      },
      styles: {
        tooltip: {
          background: theme.foundation.surfaceAccent,
          color: pickReadableTextColor(theme.foundation.surfaceAccent),
        },
      },
    },
    Notification: {
      defaultProps: {
        radius: Math.max(2, theme.foundation.radius),
        closeButtonProps: { "aria-label": "Close" },
      },
      styles: {
        root: {
          borderWidth: theme.foundation.borderWidth,
          borderStyle: theme.foundation.borderStyle,
          borderColor: theme.foundation.borderColor,
          background: theme.foundation.surface,
          boxShadow: theme.depth.dropdownShadow,
        },
      },
    },
    Popover: {
      styles: {
        dropdown: {
          background: theme.foundation.surface,
          boxShadow: theme.depth.dropdownShadow,
          borderColor: theme.foundation.borderColor,
          color: surfaceText,
        },
      },
    },
    Menu: {
      styles: {
        dropdown: {
          background: theme.foundation.surface,
          boxShadow: theme.depth.dropdownShadow,
          color: surfaceText,
        },
        item: {
          background: theme.foundation.surface,
          color: surfaceText,
          "&[data-hovered], &[data-selected]": {
            background: theme.foundation.surfaceAccent,
            color: accentText,
          },
        },
      },
    },
    Switch: {
      styles: {
        track: {
          "--switch-bg": theme.palette.danger,
          "--switch-bd": "transparent",
          "--switch-color": theme.palette.success,
          outline: "none",
          cursor: "pointer",
        },
        thumb: {
          background: theme.foundation.surface,
          boxShadow: theme.depth.switchShadow,
          borderColor: "transparent",
        },
      },
    },
    Checkbox: {
      defaultProps: {
        radius: Math.max(2, Math.round(theme.foundation.radius * 0.45)),
      },
      styles: {
        input: {
          borderColor: theme.foundation.borderColor,
          borderWidth: Math.max(1, Math.min(2, theme.foundation.borderWidth)),
        },
      },
    },
    Slider: {
      styles: {
        track: {
          background: theme.foundation.surfaceAccent,
        },
        bar: {
          background: theme.palette.primary,
        },
        thumb: {
          borderColor: theme.palette.primary,
          background: theme.foundation.surface,
        },
      },
    },
    Avatar: {
      defaultProps: {
        radius: Math.max(2, Math.round(theme.foundation.radius * 0.75)),
      },
      styles: {
        root: {
          background: theme.foundation.surfaceAccent,
          color: accentText,
        },
      },
    },
    Skeleton: {
      styles: {
        root: {
          background: theme.foundation.surfaceAccent,
        },
      },
    },
    Progress: {
      styles: {
        root: {
          background: theme.foundation.surfaceAccent,
        },
        section: {
          background: theme.palette.primary,
        },
      },
    },
    Alert: {
      defaultProps: {
        radius: Math.max(2, theme.foundation.radius),
      },
      styles: {
        root: {
          color: surfaceText,
        },
        label: {
          color: surfaceText,
        },
        message: {
          color: surfaceMutedText,
        },
      },
    },
    Accordion: {
      styles: {
        item: {
          borderColor: theme.foundation.borderColor,
        },
        control: {
          background: theme.foundation.surface,
          color: surfaceText,
        },
        label: {
          color: surfaceText,
        },
        chevron: {
          color: surfaceMutedText,
        },
        panel: {
          background: theme.foundation.surface,
          color: surfaceText,
        },
      },
    },
    Table: {
      styles: {
        table: {
          color: surfaceText,
        },
        th: {
          color: surfaceText,
          background: theme.foundation.surfaceAccent,
          borderColor: theme.foundation.borderColor,
        },
        td: {
          color: surfaceText,
          borderColor: theme.foundation.borderColor,
        },
        tr: {
          borderColor: theme.foundation.borderColor,
        },
      },
    },
    Timeline: {
      styles: {
        itemTitle: {
          color: surfaceText,
        },
        itemBody: {
          color: surfaceMutedText,
        },
      },
    },
    Divider: {
      styles: {
        root: {
          borderColor: theme.foundation.borderColor,
          borderWidth: theme.foundation.borderWidth,
        },
      },
    },
  };

  return stripUnsupportedNestedSelectors(components);
}

function stripUnsupportedNestedSelectors<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsupportedNestedSelectors(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    // In this setup Mantine `styles` are applied as inline styles; nested selectors become invalid React style keys.
    if (key.startsWith("&")) {
      continue;
    }
    next[key] = stripUnsupportedNestedSelectors(nested);
  }

  return next as T;
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

function ensureReadableColor(background: string, preferred: string, minContrast = 4.5): string {
  const preferredContrast = contrastRatio(background, preferred);
  if (preferredContrast >= minContrast) {
    return preferred;
  }

  const fallback = pickReadableTextColor(background);
  return contrastRatio(background, fallback) >= preferredContrast ? fallback : preferred;
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

