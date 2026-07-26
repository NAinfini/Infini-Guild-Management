import { Group, HoverCard, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { ArrowBackUpIcon, ArrowForwardUpIcon, ChevronDownIcon, ChevronUpIcon } from "@portal/components/icons";

type GuildWarAnalyticsChartPanelProps = {
  ReactEChartsCore: typeof import("echarts-for-react/esm/core").default;
  echarts: unknown;
  themeName: string;
  chartOption: unknown;
  radarOption: unknown | null;
  mode: string;
  selectedUsers: string[];
  selectedMetrics: string[];
  expanded: boolean;
  onToggleExpanded: () => void;
  t: (key: string) => string;
};

export function GuildWarAnalyticsChartPanel({
  ReactEChartsCore,
  echarts,
  themeName,
  chartOption,
  radarOption,
  mode,
  selectedUsers,
  selectedMetrics,
  expanded,
  onToggleExpanded,
  t,
}: GuildWarAnalyticsChartPanelProps) {
  const option = mode === "radar" && radarOption ? radarOption : chartOption;
  const keyPrefix = mode === "radar" ? "radar" : "chart";
  const height = expanded ? 560 : 420;

  return (
    <div className="gwa-main">
      <div className="gwa-chart">
        <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
          <HoverCard.Target>
            <UnstyledButton
              onClick={onToggleExpanded}
              className="gwa-chart__expand"
              aria-label={expanded ? t("analytics.aria.collapseChart") : t("analytics.aria.expandChart")}
            >
              {expanded ? <ArrowBackUpIcon size={14} /> : <ArrowForwardUpIcon size={14} />}
            </UnstyledButton>
          </HoverCard.Target>
          <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
            <Group gap={10} wrap="nowrap" align="flex-start">
              <ThemeIcon variant="light" color="portal-bronze" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                {expanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
              </ThemeIcon>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={700} lh={1.3} mb={4}>{expanded ? t("hovercard.collapseChart.title") : t("hovercard.expandChart.title")}</Text>
                <Text size="xs" c="dimmed" lh={1.5}>{expanded ? t("hovercard.collapseChart.desc") : t("hovercard.expandChart.desc")}</Text>
              </div>
            </Group>
          </HoverCard.Dropdown>
        </HoverCard>
        <ReactEChartsCore
          key={`${keyPrefix}-${selectedUsers.join(",")}-${selectedMetrics.join(",")}`}
          echarts={echarts}
          theme={themeName}
          option={option}
          style={{ width: "100%", height }}
        />
      </div>
    </div>
  );
}
