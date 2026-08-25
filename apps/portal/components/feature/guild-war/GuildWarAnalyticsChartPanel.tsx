import { Button } from "@portal/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { ArrowBackUpIcon, ArrowForwardUpIcon } from "@portal/components/icons";
import { EmptyState } from "@portal/components/shared/EmptyState";

type AnalyticsChartEmptyState = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** The heading mirrors the active query and exposes normalization in `note`. */
type AnalyticsChartHeading = {
  kicker: string;
  title: string;
  note?: string;
};

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
  heading: AnalyticsChartHeading;
  t: (key: string) => string;
  emptyState?: AnalyticsChartEmptyState;
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
  heading,
  t,
  emptyState,
}: GuildWarAnalyticsChartPanelProps) {
  const option = mode === "radar" && radarOption ? radarOption : chartOption;
  const keyPrefix = mode === "radar" ? "radar" : "chart";
  const height = expanded ? 560 : 420;

  return (
    <div className="gwa-main">
      <section className="gwa-chart">
        <div className="gwa-chart__header">
          <div className="gwa-chart__heading">
            <span className="text-xs font-semibold text-muted-foreground">{heading.kicker}</span>
            <strong>{heading.title}</strong>
            {heading.note ? (
              <span className="gwa-chart__note text-xs font-semibold">
                {heading.note}
              </span>
            ) : null}
          </div>
          {!emptyState ? (
            <Tooltip>
              <TooltipTrigger render={<Button
                type="button"
                onClick={onToggleExpanded}
                className="gwa-chart__expand"
                variant="ghost"
                size="icon-lg"
                aria-label={expanded ? t("analytics.aria.collapseChart") : t("analytics.aria.expandChart")}
              />}>
                {expanded ? <ArrowBackUpIcon size={16} /> : <ArrowForwardUpIcon size={16} />}
              </TooltipTrigger>
              <TooltipContent>
                {expanded ? t("hovercard.collapseChart.title") : t("hovercard.expandChart.title")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {emptyState ? (
          <div className="gwa-chart__empty" style={{ minHeight: height }}>
            <EmptyState
              title={emptyState.title}
              description={emptyState.description}
              actions={
                emptyState.actionLabel && emptyState.onAction ? (
                  <Button variant="secondary" onClick={emptyState.onAction}>
                    {emptyState.actionLabel}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ReactEChartsCore
            key={`${keyPrefix}-${selectedUsers.join(",")}-${selectedMetrics.join(",")}`}
            echarts={echarts}
            theme={themeName}
            option={option}
            /*
             * Every mode and every toggle builds a completely different option —
             * different series count, axes and value formatter. echarts-for-react
             * defaults to notMerge=false, which merges series by index and keeps
             * whatever the previous option had: the war mode's 敌方/差额 series
             * leaked into the rankings chart, and the teams mode's raw totals
             * survived into contribution mode where the new "{v}%" formatter
             * rendered 522000 damage as "522000%". Each option must replace the
             * previous one outright.
             */
            notMerge
            style={{ width: "100%", height }}
          />
        )}
      </section>
    </div>
  );
}
