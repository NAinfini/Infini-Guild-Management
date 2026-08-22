interface EChartsAxisStyle {
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

/*
 * 图表取的是分类色序 --series-*，首位是跟随主色的 --series-accent。
 * 序列本身按「相邻色相拉到最开」排过，而主色可能正好落在其中一族上
 * （teal 主色 + --series-1 就是同一个青瓷），所以按值去重：两条线用同一个
 * 颜色比少一个颜色更糟。
 */
const SERIES_TOKENS = [
  "--series-accent",
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
] as const;

function buildAxisTemplate(axisLineColor: string, splitLineColor: string, textColor: string): EChartsAxisStyle {
  return {
    axisLine: { lineStyle: { color: axisLineColor } },
    axisTick: { lineStyle: { color: axisLineColor } },
    axisLabel: { color: textColor },
    splitLine: { lineStyle: { color: splitLineColor } },
  };
}

/**
 * ECharts 只吃具体颜色字符串，认不了 var()，所以主题必须在构建时把 token 解析成值。
 *
 * 这里读的是 <html> 上的计算值，也就是 [data-theme] × [data-accent] 之后的最终结果：
 * 图表因此和站内其余部分共用同一套颜色，换主题或换主色时跟着变。调用方负责在这两个
 * 值变化时重建（见 GuildWarPage 的 useMemo 依赖）。
 *
 * mode 只用来告诉 ECharts 自己的内建组件走深色还是浅色分支——颜色全部来自 token。
 */
export function buildEChartsTheme(
  mode: "light" | "dark",
  root: HTMLElement = document.documentElement,
): EChartsThemeConfig {
  const styles = getComputedStyle(root);
  const token = (name: string): string => styles.getPropertyValue(name).trim();

  const textColor = token("--text-primary");
  const mutedColor = token("--text-muted");
  const axisLineColor = token("--border-subtle");
  /* 网格线要比轴线更退后一档：轴线是结构，网格线只是读数的辅助。 */
  const splitLineColor = `color-mix(in srgb, ${axisLineColor} 55%, transparent)`;
  const fontFamily = token("--font-body");

  const axisTemplate = buildAxisTemplate(axisLineColor, splitLineColor, mutedColor);

  return {
    darkMode: mode === "dark",
    color: [...new Set(SERIES_TOKENS.map((name) => token(name)).filter(Boolean))],
    backgroundColor: "transparent",
    textStyle: { color: textColor, fontFamily },
    title: { textStyle: { color: textColor, fontFamily } },
    legend: { textStyle: { color: mutedColor } },
    tooltip: {
      backgroundColor: token("--surface-overlay"),
      borderColor: axisLineColor,
      textStyle: { color: textColor },
    },
    categoryAxis: axisTemplate,
    valueAxis: axisTemplate,
    radar: {
      axisLine: { lineStyle: { color: axisLineColor } },
      splitLine: { lineStyle: { color: splitLineColor } },
      /* 雷达图的环形分区：原本是三档写死的白色叠加，浅色模式下压在白卡片上等于没画。
         改成从正文色里兑，两个模式都能看见同一组环。 */
      splitArea: {
        areaStyle: {
          color: [
            `color-mix(in srgb, ${textColor} 5%, transparent)`,
            `color-mix(in srgb, ${textColor} 2%, transparent)`,
          ],
        },
      },
      axisName: { color: mutedColor },
    },
  };
}
