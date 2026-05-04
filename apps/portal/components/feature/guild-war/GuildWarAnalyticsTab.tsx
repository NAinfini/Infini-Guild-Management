import {
  Alert,
  Avatar,
  Collapse,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
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
  SearchIcon,
} from "@portal/components/icons";
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
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import { GuildWarService } from "../../../services/GuildWarService";
import { useGuildWarAnalytics } from "../../../hooks/guild-war/useGuildWarAnalytics";

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

type AnalyticsMode = "player" | "rankings" | "teams" | "radar";
type AnalyticsMetricKey =
  | "kills"
  | "deaths"
  | "assists"
  | "damage"
  | "healing"
  | "building_damage"
  | "credits"
  | "damage_taken"
  | "kda";
type AnalyticsAggregation = "total" | "average" | "best" | "median";
type AnalyticsDatePreset = "5" | "10" | "20" | "all";

type GuildWarAnalyticsTabProps = {
  historyRows: Array<{ id: string; war_name: string; created_at: string }>;
  chartPalette: string[];
  guildWarService: GuildWarService;
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
  loadErrorMessage: string;
};

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

type ListBoxItem = { value: string; label: string; Icon?: ComponentType<{ size?: number }> };

function ListBox({
  items,
  selected,
  onChange,
  maxSelect,
  searchable,
  searchPlaceholder,
  renderItem,
}: {
  items: ListBoxItem[];
  selected: string[];
  onChange: (values: string[]) => void;
  maxSelect?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  renderItem?: (item: ListBoxItem, checked: boolean) => React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return items;
    const lower = search.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(lower));
  }, [items, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      if (maxSelect && selected.length >= maxSelect) return;
      onChange([...selected, value]);
    }
  };

  return (
    <div className="gwa-listbox">
      {searchable ? (
        <TextInput
          size="xs"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          leftSection={<SearchIcon size={12} />}
          className="gwa-listbox__search"
        />
      ) : null}
      <div className="gwa-listbox__items">
        {filtered.map((item) => {
          const checked = selected.includes(item.value);
          return (
            <UnstyledButton
              key={item.value}
              onClick={() => toggle(item.value)}
              className={`gwa-listbox__item ${checked ? "gwa-listbox__item--selected" : ""}`}
            >
              {renderItem ? (
                renderItem(item, checked)
              ) : (
                <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                  <Group gap={8}>
                    {item.Icon ? <item.Icon size={14} /> : null}
                    <span className="gwa-listbox__item-label">{item.label}</span>
                  </Group>
                  {checked ? <CheckIcon size={12} /> : null}
                </Group>
              )}
            </UnstyledButton>
          );
        })}
      </div>
    </div>
  );
}

export function GuildWarAnalyticsTab({
  historyRows,
  chartPalette,
  guildWarService,
  chartThemeName,
  chartThemeConfig,
  loadErrorMessage,
}: GuildWarAnalyticsTabProps) {
  const { t } = useTranslation("guild-war");
  const analytics = useGuildWarAnalytics({ historyRows, chartPalette, guildWarService });
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
                  <ListBox
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
                    <ListBox
                      items={analytics.analyticsSelectableUserIds.map((userId) => ({
                        value: userId,
                        label: analytics.analyticsUserIdToUsername.get(userId) ?? userId,
                      }))}
                      selected={analytics.analyticsSelectedUsers}
                      onChange={(values) => analytics.applyAnalyticsSelection(values.slice(0, 5))}
                      maxSelect={5}
                      searchable
                      searchPlaceholder={t("analytics.selectMembers")}
                      renderItem={(item, checked) => (
                        <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                          <Group gap={8}>
                            <Avatar size={20} radius="xl">
                              {item.label.slice(0, 2).toUpperCase()}
                            </Avatar>
                            <span className="gwa-listbox__item-label">{item.label}</span>
                          </Group>
                          {checked ? <CheckIcon size={12} /> : null}
                        </Group>
                      )}
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
                    <ListBox
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
                        min={1}
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
            <div className="gwa-main">
              <div className="gwa-chart">
                <UnstyledButton
                  onClick={() => setChartExpanded(!chartExpanded)}
                  className="gwa-chart__expand"
                  aria-label={chartExpanded ? t("analytics.aria.collapseChart") : t("analytics.aria.expandChart")}
                >
                  {chartExpanded ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                      <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  )}
                </UnstyledButton>
                {analytics.analyticsMode === "radar" && analytics.analyticsRadarOption ? (
                  <ReactEChartsCore
                    key={`radar-${analytics.analyticsSelectedUsers.join(",")}-${analytics.analyticsSelectedMetrics.join(",")}`}
                    echarts={echarts}
                    theme={chartThemeName}
                    option={analytics.analyticsRadarOption}
                    style={{ width: "100%", height: chartExpanded ? 560 : 420 }}
                  />
                ) : (
                  <ReactEChartsCore
                    key={`${analytics.analyticsSelectedUsers.join(",")}-${analytics.analyticsSelectedMetrics.join(",")}`}
                    echarts={echarts}
                    theme={chartThemeName}
                    option={analytics.analyticsChartOption}
                    style={{ width: "100%", height: chartExpanded ? 560 : 420 }}
                  />
                )}
              </div>
            </div>

            {/* ── Right sidebar: metrics + options + data table ── */}
            {!chartExpanded ? (
              <div className="gwa-sidebar gwa-sidebar--right">
                {/* Metric selector */}
                <div className="gwa-sidebar__section">
                  <div className="gwa-toolbar__label">{t("analytics.metrics.title")}</div>
                  <ListBox
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

                {/* Normalization */}
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
                              <Slider
                                style={{ flex: 1, minWidth: 60 }}
                                min={0}
                                max={100}
                                step={1}
                                value={Math.round(analytics.modifierWeights[key] * 100)}
                                onChange={(val) =>
                                  analytics.setModifierWeights({
                                    ...analytics.modifierWeights,
                                    [key]: val / 100,
                                  })
                                }
                                size="sm"
                                label={(val) => `${val}%`}
                              />
                              <Text
                                size="xs"
                                fw={600}
                                c="dimmed"
                                style={{ width: 38, textAlign: "right", flexShrink: 0 }}
                              >
                                {(analytics.modifierWeights[key] * 100).toFixed(0)}%
                              </Text>
                            </Group>
                          ),
                        )}
                      </div>
                      <Text size="xs" c="dimmed" mt={6}>
                        {t("analytics.normalization.weightsTotal", {
                          total:
                            (
                              (analytics.modifierWeights.kda +
                                analytics.modifierWeights.towers +
                                analytics.modifierWeights.credits +
                                analytics.modifierWeights.distance +
                                analytics.modifierWeights.basehp) *
                              100
                            ).toFixed(0) + "%",
                        })}
                      </Text>
                    </div>
                  </Collapse>
                </div>

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
                <UnstyledButton
                  onClick={(e) => { e.stopPropagation(); analytics.copyAnalyticsCsv(); }}
                  className="gwa-table-action"
                  aria-label={t("analytics.aria.copyCsv")}
                >
                  <CopyIcon size={13} />
                  <Text size="xs">CSV</Text>
                </UnstyledButton>
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
