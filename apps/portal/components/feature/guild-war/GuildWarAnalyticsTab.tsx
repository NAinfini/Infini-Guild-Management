import {
  Alert,
  Collapse,
  Group,
  HoverCard,
  NumberInput,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Table,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  SwordsIcon,
  HeartIcon,
  HammerIcon,
  CrownIcon,
  TargetIcon,
  FlameIcon,
  UserCheckIcon,
  ShieldIcon,
  TrophyIcon,
  AdjustmentsIcon,
  CopyIcon,
} from "@portal/components/icons";
import { activeGame } from "@guild/shared/games";
import { BarChart, LineChart, RadarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  RadarComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type {
  AnalyticsAggregation,
  AnalyticsDatePreset,
  AnalyticsMetricKey,
  AnalyticsMode,
} from "@portal/types/guild-war";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import type { GuildWarAnalyticsController } from "../../../hooks/guild-war/useGuildWarAnalytics";
import { GuildWarAnalyticsChartPanel } from "./GuildWarAnalyticsChartPanel";
import { GuildWarAnalyticsListBox, UserListBoxItem } from "./GuildWarAnalyticsListBox";

echarts.use([
  BarChart,
  LineChart,
  RadarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  RadarComponent,
  CanvasRenderer,
]);

type GuildWarAnalyticsTabProps = {
  analytics: GuildWarAnalyticsController;
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
  loadErrorMessage: string;
  canManageWeights: boolean;
};

const WAR_STAT_OPTIONS = activeGame.war.teamObjectives.map((objective) => ({
  value: objective.key,
  labelKey: objective.label.replace(/^guild-war:/, ""),
}));

const ANALYTICS_METRIC_OPTIONS: Array<{
  value: AnalyticsMetricKey;
  labelKey: string;
  Icon: ComponentType<{ size?: number }>;
}> = [
  { value: "damage", labelKey: "analytics.metric.damage", Icon: SwordsIcon },
  { value: "healing", labelKey: "analytics.metric.healing", Icon: HeartIcon },
  { value: "building_damage", labelKey: "analytics.metric.buildingDamage", Icon: HammerIcon },
  { value: "credits", labelKey: "analytics.metric.credits", Icon: CrownIcon },
  { value: "kills", labelKey: "analytics.metric.kills", Icon: TargetIcon },
  { value: "deaths", labelKey: "analytics.metric.deaths", Icon: FlameIcon },
  { value: "assists", labelKey: "analytics.metric.assists", Icon: UserCheckIcon },
  { value: "damage_taken", labelKey: "analytics.metric.damageTaken", Icon: ShieldIcon },
  { value: "kda", labelKey: "analytics.metric.kda", Icon: TrophyIcon },
];

export function GuildWarAnalyticsTab({
  analytics,
  chartThemeName,
  chartThemeConfig,
  loadErrorMessage,
  canManageWeights,
}: GuildWarAnalyticsTabProps) {
  const { t } = useTranslation("guild-war");
  const [normExpanded, setNormExpanded] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const metricOptions = ANALYTICS_METRIC_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
    Icon: opt.Icon,
  }));

  const isLoading =
    analytics.analyticsQuery.isLoading || analytics.analyticsDetailsQuery.isLoading;
  const isFetching =
    analytics.analyticsQuery.isFetching || analytics.analyticsDetailsQuery.isFetching;
  const isError =
    analytics.analyticsQuery.isError || analytics.analyticsDetailsQuery.isError;

  return (
    <Stack gap={12} className="gwa-layout">
      {/* Primary toolbar: mode + date preset */}
      <div className="gwa-toolbar">
        <div className="gwa-toolbar__item">
          <div className="gwa-toolbar__label">{t("analytics.toolbar.mode")}</div>
          <SegmentedControl
            value={analytics.analyticsMode}
            onChange={(value) => analytics.setAnalyticsMode(value as AnalyticsMode)}
            data={[
              { label: t("analytics.toolbar.mode.player"), value: "player" },
              { label: t("analytics.toolbar.mode.rankings"), value: "rankings" },
              { label: t("analytics.toolbar.mode.teams"), value: "teams" },
              { label: t("analytics.toolbar.mode.radar"), value: "radar" },
              { label: t("analytics.toolbar.mode.wars"), value: "wars" },
            ]}
          />
        </div>

        <div className="gwa-toolbar__item">
          <div className="gwa-toolbar__label">{t("analytics.toolbar.datePreset")}</div>
          <SegmentedControl
            value={analytics.analyticsDatePreset}
            onChange={(value) =>
              analytics.handleAnalyticsDatePresetChange(value as AnalyticsDatePreset)
            }
            data={[
              { label: t("analytics.toolbar.datePreset.last5"), value: "5" },
              { label: t("analytics.toolbar.datePreset.last10"), value: "10" },
              { label: t("analytics.toolbar.datePreset.last20"), value: "20" },
              { label: t("analytics.toolbar.datePreset.all"), value: "all" },
            ]}
          />
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading ? (
        <Stack gap={8}>
          <Skeleton height={180} radius={8} />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={18} />
          ))}
        </Stack>
      ) : null}

      {isError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}

      {/* Wars mode: win/loss record summary */}
      {!isLoading && !isError && analytics.analyticsMode === "wars" ? (
        <Group gap={16} className="gwa-war-summary">
          {activeGame.war.resultOptions.map((result) => (
            <Text key={result} size="sm">
              <Text span fw={600}>{t(`conclude.result.${result}`)}</Text>
              {" "}{analytics.analyticsWarSummary.counts.get(result) ?? 0}
            </Text>
          ))}
          {analytics.analyticsWarSummary.winRate !== null ? (
            <Text size="sm" fw={600} c="var(--color-primary, #D4A843)">
              {t("analytics.wars.winRate", { rate: analytics.analyticsWarSummary.winRate })}
            </Text>
          ) : null}
        </Group>
      ) : null}

      {/* Main content: left sidebar + chart + right sidebar */}
      {!isLoading && !isError ? (
        <>
          <div
            className="gwa-content"
            style={isFetching ? { opacity: 0.6, pointerEvents: "none", transition: "opacity 0.15s ease" } : { transition: "opacity 0.15s ease" }}
          >
            {/* ── Left sidebar: data selectors ── */}
            {!chartExpanded ? (
              <div className="gwa-sidebar gwa-sidebar--left">
                {/* War selection */}
                <div className="gwa-sidebar__section">
                  <div className="gwa-toolbar__label">{t("analytics.toolbar.warSet")}</div>
                  <GuildWarAnalyticsListBox
                    items={analytics.analyticsWarOptions}
                    selected={analytics.analyticsSelectedWarIds}
                    onChange={analytics.setAnalyticsSelectedWarIds}
                    searchable
                    searchPlaceholder={t("analytics.toolbar.selectWars")}
                  />
                </div>

                {/* Player/Radar member selector */}
                {analytics.analyticsMode === "player" || analytics.analyticsMode === "radar" ? (
                  <div className="gwa-sidebar__section">
                    <div className="gwa-toolbar__label">{t("analytics.selectMembers")}</div>
                    <GuildWarAnalyticsListBox
                      items={analytics.analyticsSelectableUserIds.map((userId) => ({
                        value: userId,
                        label: analytics.analyticsUserIdToUsername.get(userId) ?? userId,
                      }))}
                      selected={analytics.analyticsSelectedUsers}
                      onChange={(values) => analytics.applyAnalyticsSelection(values.slice(0, 5))}
                      maxSelect={5}
                      searchable
                      searchPlaceholder={t("analytics.selectMembers")}
                      renderItem={(item, checked) => <UserListBoxItem item={item} checked={checked} />}
                    />
                    {analytics.analyticsSelectedUsers.length >= analytics.selectionSoftCap ? (
                      <Text size="xs" c="dimmed">
                        {t("analytics.selectionSoftCap", {
                          count: analytics.selectionSoftCap,
                        })}
                      </Text>
                    ) : null}
                  </div>
                ) : null}

                {/* Teams selector */}
                {analytics.analyticsMode === "teams" ? (
                  <div className="gwa-sidebar__section">
                    <div className="gwa-toolbar__label">{t("analytics.selectTeams")}</div>
                    <GuildWarAnalyticsListBox
                      items={analytics.analyticsTeamOptions.map((team) => ({
                        value: team,
                        label: team,
                      }))}
                      selected={analytics.analyticsSelectedTeams}
                      onChange={(values) => analytics.setAnalyticsSelectedTeams(values)}
                      searchable
                      searchPlaceholder={t("analytics.selectTeams")}
                    />
                  </div>
                ) : null}

                {/* Rankings controls */}
                {analytics.analyticsMode === "rankings" ? (
                  <>
                    <div className="gwa-sidebar__section">
                      <div className="gwa-toolbar__label">{t("analytics.aggregation.total")}</div>
                      <Select
                        value={analytics.analyticsAggregation}
                        aria-label={t("analytics.aria.selectAggregation")}
                        onChange={(value) =>
                          value &&
                          analytics.setAnalyticsAggregation(value as AnalyticsAggregation)
                        }
                        data={[
                          { value: "total", label: t("analytics.aggregation.total") },
                          { value: "average", label: t("analytics.aggregation.average") },
                          { value: "best", label: t("analytics.aggregation.best") },
                          { value: "median", label: t("analytics.aggregation.median") },
                        ]}
                      />
                    </div>
                    <div className="gwa-sidebar__section gwa-sidebar__section--row">
                      <NumberInput
                        hideControls
                        min={1}
                        max={20}
                        value={analytics.analyticsTopN}
                        onChange={(value) =>
                          analytics.setAnalyticsTopN(typeof value === "number" ? value : 10)
                        }
                        aria-label={t("analytics.aria.topN")}
                        label={t("analytics.topN")}
                        style={{ flex: 1 }}
                      />
                      <NumberInput
                        hideControls
                        min={0}
                        max={200}
                        value={analytics.analyticsMinParticipation}
                        onChange={(value) =>
                          analytics.setAnalyticsMinParticipation(
                            typeof value === "number" ? value : 1,
                          )
                        }
                        aria-label={t("analytics.aria.minParticipation")}
                        label={t("analytics.minParticipation")}
                        style={{ flex: 1 }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* ── Center: Chart ── */}
            <GuildWarAnalyticsChartPanel
              ReactEChartsCore={ReactEChartsCore}
              echarts={echarts}
              themeName={chartThemeName}
              chartOption={analytics.analyticsChartOption}
              radarOption={analytics.analyticsRadarOption}
              mode={analytics.analyticsMode}
              selectedUsers={analytics.analyticsSelectedUsers}
              selectedMetrics={analytics.analyticsSelectedMetrics}
              expanded={chartExpanded}
              onToggleExpanded={() => setChartExpanded(!chartExpanded)}
              t={t}
            />

            {/* ── Right sidebar: metrics + options + data table ── */}
            {!chartExpanded ? (
              <div className="gwa-sidebar gwa-sidebar--right">
                {/* Metric selector (member metrics) / war objective selector */}
                {analytics.analyticsMode === "wars" ? (
                  <div className="gwa-sidebar__section">
                    <div className="gwa-toolbar__label">{t("analytics.warStat.title")}</div>
                    <Select
                      value={analytics.analyticsWarStat}
                      aria-label={t("analytics.warStat.title")}
                      onChange={(value) => value && analytics.setAnalyticsWarStat(value)}
                      data={WAR_STAT_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
                    />
                  </div>
                ) : (
                  <div className="gwa-sidebar__section">
                    <div className="gwa-toolbar__label">{t("analytics.metrics.title")}</div>
                    <GuildWarAnalyticsListBox
                      items={metricOptions}
                      selected={analytics.analyticsSelectedMetrics}
                      onChange={(values) =>
                        analytics.setAnalyticsSelectedMetrics(
                          values.slice(0, 5) as AnalyticsMetricKey[],
                        )
                      }
                      maxSelect={5}
                    />
                  </div>
                )}

                {/* Player options */}
                {analytics.analyticsMode === "player" ? (
                  <div className="gwa-sidebar__section">
                    <Switch
                      checked={analytics.analyticsOnlyParticipated}
                      onChange={(event) =>
                        analytics.setAnalyticsOnlyParticipated(event.currentTarget.checked)
                      }
                      label={t("analytics.onlyParticipated")}
                      size="xs"
                    />
                    <Switch
                      checked={analytics.analyticsShowDeviation}
                      onChange={(event) =>
                        analytics.setAnalyticsShowDeviation(event.currentTarget.checked)
                      }
                      label={t("analytics.showDeviation")}
                      size="xs"
                    />
                  </div>
                ) : null}

                {/* Teams aggregation */}
                {analytics.analyticsMode === "teams" ? (
                  <div className="gwa-sidebar__section">
                    <SegmentedControl
                      value={analytics.analyticsTeamAggregation}
                      onChange={(value) =>
                        analytics.setAnalyticsTeamAggregation(value as "total" | "average")
                      }
                      data={[
                        { value: "total", label: t("analytics.aggregation.total") },
                        { value: "average", label: t("analytics.aggregation.average") },
                      ]}
                    />
                    <Switch
                      checked={analytics.analyticsShowContribution}
                      onChange={(event) =>
                        analytics.setAnalyticsShowContribution(event.currentTarget.checked)
                      }
                      label={t("analytics.showContribution")}
                      size="xs"
                    />
                  </div>
                ) : null}

                {/* Normalization — not applicable to war-level own/enemy raw comparison */}
                {analytics.analyticsMode !== "wars" ? (
                  <div className="gwa-sidebar__section">
                    <UnstyledButton
                      onClick={() => setNormExpanded(!normExpanded)}
                      className="gwa-norm-toggle"
                    >
                      <AdjustmentsIcon size={14} />
                      <Text size="xs" fw={500}>{t("analytics.normalization")}</Text>
                      <Switch
                        checked={analytics.analyticsNormEnabled}
                        onChange={(e) => {
                          e.stopPropagation();
                          analytics.setAnalyticsNormEnabled(e.currentTarget.checked);
                        }}
                        size="xs"
                        styles={{ track: { cursor: "pointer" } }}
                      />
                    </UnstyledButton>
                    <Collapse in={normExpanded && analytics.analyticsNormEnabled}>
                      <div className="gwa-norm-panel">
                        <Text size="xs" c="dimmed" mb={8}>
                          {t("analytics.normalization.refDuration", {
                            minutes: analytics.referenceDuration,
                          })}
                        </Text>
                        <Text size="xs" c="dimmed" ff="monospace" mb={8}>
                          {t("analytics.normalization.equationDesc")}
                        </Text>
                        <div className="gwa-norm-weights">
                          {(["kda", "towers", "credits", "distance", "basehp"] as const).map(
                            (key) => (
                              <Group key={key} gap={8} wrap="nowrap" align="center">
                                <Text size="xs" fw={500} style={{ width: 64, flexShrink: 0 }}>
                                  {t(`analytics.normalization.weight.${key}`)}
                                </Text>
                                {/* Weights are a shared baseline: only moderators may tune them */}
                                {canManageWeights ? (
                                  <Slider
                                    style={{ flex: 1, minWidth: 60 }}
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={Math.round((analytics.modifierWeights[key] ?? 0) * 100)}
                                    onChange={(val) =>
                                      analytics.setModifierWeights({
                                        ...analytics.modifierWeights,
                                        [key]: val / 100,
                                      })
                                    }
                                    size="sm"
                                    label={(val) => `${val}%`}
                                  />
                                ) : (
                                  <div style={{ flex: 1 }} />
                                )}
                                <Text
                                  size="xs"
                                  fw={600}
                                  c="dimmed"
                                  style={{ width: 38, textAlign: "right", flexShrink: 0 }}
                                >
                                  {((analytics.modifierWeights[key] ?? 0) * 100).toFixed(0)}%
                                </Text>
                              </Group>
                            ),
                          )}
                        </div>
                        <Text size="xs" c="dimmed" mt={6}>
                          {t("analytics.normalization.weightsTotal", {
                            total:
                              (
                                ((analytics.modifierWeights.kda ?? 0) +
                                  (analytics.modifierWeights.towers ?? 0) +
                                  (analytics.modifierWeights.credits ?? 0) +
                                  (analytics.modifierWeights.distance ?? 0) +
                                  (analytics.modifierWeights.basehp ?? 0)) *
                                100
                              ).toFixed(0) + "%",
                          })}
                        </Text>
                      </div>
                    </Collapse>
                  </div>
                ) : null}

              </div>
            ) : null}
          </div>

          {/* Data table — full width below chart */}
          <div className="gwa-table-section">
            <UnstyledButton
              onClick={() => setTableExpanded(!tableExpanded)}
              className="gwa-table-toggle"
            >
              <Group gap={6}>
                {tableExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                <Text size="xs" fw={500}>
                  {t("analytics.table.title", { count: analytics.analyticsTableRows.length })}
                </Text>
              </Group>
              <Group gap={6}>
                <Switch
                  checked={analytics.analyticsHeatmapEnabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    analytics.setAnalyticsHeatmapEnabled(e.currentTarget.checked);
                  }}
                  size="xs"
                  label={t("analytics.heatmap")}
                  styles={{ label: { fontSize: 11, cursor: "pointer" } }}
                />
                <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                  <HoverCard.Target>
                    <UnstyledButton
                      onClick={(e) => { e.stopPropagation(); analytics.copyAnalyticsCsv(); }}
                      className="gwa-table-action"
                      aria-label={t("analytics.aria.copyCsv")}
                    >
                      <CopyIcon size={13} />
                      <Text size="xs">CSV</Text>
                    </UnstyledButton>
                  </HoverCard.Target>
                  <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                    <Group gap={10} wrap="nowrap" align="flex-start">
                      <ThemeIcon variant="light" color="blue" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                        <CopyIcon size={16} />
                      </ThemeIcon>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={700} lh={1.3} mb={4}>{t("hovercard.copyCsv.title")}</Text>
                        <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.copyCsv.desc")}</Text>
                      </div>
                    </Group>
                  </HoverCard.Dropdown>
                </HoverCard>
              </Group>
            </UnstyledButton>
            <Collapse in={tableExpanded}>
              <div className="gwa-table-wrap">
                <Table striped={!analytics.analyticsHeatmapEnabled} highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      {analytics.analyticsTableColumns.map((col) => (
                        <Table.Th key={col.key}>{col.title}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(analytics.analyticsTableRows as Array<Record<string, unknown>>)
                      .slice(0, 20)
                      .map((row, rowIdx) => (
                        <Table.Tr key={String(row.key ?? rowIdx)}>
                          {analytics.analyticsTableColumns.map((col) => {
                            const colKey = col.dataIndex ?? col.key;
                            const val = row[colKey];
                            const heatmapRange = analytics.analyticsHeatmapEnabled
                              ? analytics.analyticsTableHeatmapRanges.get(colKey)
                              : undefined;
                            let cellStyle: React.CSSProperties | undefined;
                            if (heatmapRange && typeof val === "number") {
                              const ratio = (val - heatmapRange.min) / (heatmapRange.max - heatmapRange.min);
                              cellStyle = {
                                background: `color-mix(in srgb, var(--color-primary) ${Math.round(ratio * 35)}%, transparent)`,
                              };
                            }
                            return (
                              <Table.Td key={col.key} style={cellStyle}>
                                {val === null || val === undefined ? "—" : String(val)}
                              </Table.Td>
                            );
                          })}
                        </Table.Tr>
                      ))}
                  </Table.Tbody>
                </Table>
              </div>
            </Collapse>
          </div>
        </>
      ) : null}
    </Stack>
  );
}
