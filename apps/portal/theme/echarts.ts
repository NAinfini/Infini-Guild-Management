export interface EChartsAxisStyle {
  axisLine: { lineStyle: { color: string } };
  axisTick: { lineStyle: { color: string } };
  axisLabel: { color: string };
  splitLine: { lineStyle: { color: string } };
}

export interface EChartsThemeConfig {
  darkMode?: boolean;
  color: string[];
  backgroundColor: string;
  textStyle: { color: string; fontFamily: string };
  title: { textStyle: { color: string; fontFamily: string } };
  legend: { textStyle: { color: string } };
  tooltip: {
    backgroundColor: string;
    borderColor: string;
    textStyle: { color: string };
  };
  categoryAxis: EChartsAxisStyle;
  valueAxis: EChartsAxisStyle;
  radar: {
    axisLine: { lineStyle: { color: string } };
    splitLine: { lineStyle: { color: string } };
    splitArea: { areaStyle: { color: string[] } };
    axisName: { color: string };
  };
}

const PALETTE = {
  primary: "#3B82F6",
  secondary: "#8B5CF6",
  accent: "#06B6D4",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
} as const;

const COLOR_PALETTE = [
  PALETTE.primary,
  PALETTE.secondary,
  PALETTE.accent,
  PALETTE.success,
  PALETTE.warning,
  PALETTE.danger,
];

const FONT_FAMILY = "Inter, system-ui, -apple-system, sans-serif";

function buildAxisTemplate(axisLineColor: string, splitLineColor: string, textColor: string): EChartsAxisStyle {
  return {
    axisLine: { lineStyle: { color: axisLineColor } },
    axisTick: { lineStyle: { color: axisLineColor } },
    axisLabel: { color: textColor },
    splitLine: { lineStyle: { color: splitLineColor } },
  };
}

export function buildEChartsTheme(mode: "light" | "dark"): EChartsThemeConfig {
  const isDark = mode === "dark";

  const textColor = isDark ? "#E5E7EB" : "#333333";
  const axisLineColor = isDark ? "rgba(59,130,246,0.2)" : "#cccccc";
  const splitLineColor = isDark ? "rgba(59,130,246,0.06)" : "#eeeeee";
  const tooltipBg = isDark ? "#111827" : "#ffffff";
  const tooltipBorder = isDark ? "rgba(59,130,246,0.3)" : "#cccccc";

  const axisTemplate = buildAxisTemplate(axisLineColor, splitLineColor, textColor);

  return {
    darkMode: isDark,
    color: COLOR_PALETTE,
    backgroundColor: "transparent",
    textStyle: { color: textColor, fontFamily: FONT_FAMILY },
    title: { textStyle: { color: textColor, fontFamily: FONT_FAMILY } },
    legend: { textStyle: { color: textColor } },
    tooltip: {
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: textColor },
    },
    categoryAxis: axisTemplate,
    valueAxis: axisTemplate,
    radar: {
      axisLine: { lineStyle: { color: axisLineColor } },
      splitLine: { lineStyle: { color: splitLineColor } },
      splitArea: {
        areaStyle: {
          color: [
            "rgba(255,255,255,0.04)",
            "rgba(255,255,255,0.02)",
            "rgba(255,255,255,0.01)",
          ],
        },
      },
      axisName: { color: textColor },
    },
  };
}
