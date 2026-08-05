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
import { DEFAULT_GAME_RULES, GUILD_WAR_KDA_KEY, GUILD_WAR_RESULT_DEFINITIONS } from "@guild/shared";
import type {
  AnalyticsAggregation,
  AnalyticsDatePreset,
  AnalyticsMetricKey,
  AnalyticsMode,
} from "@portal/types/guild-war";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import type { GuildWarAnalyticsController } from "../../../hooks/guild-war/useGuildWarAnalytics";
import { ANALYTICS_SELECTION_HARD_CAP } from "../../../services/GuildWarService";
import { GuildWarAnalyticsChartPanel } from "./GuildWarAnalyticsChartPanel";
import { GuildWarAnalyticsListBox, UserListBoxItem } from "./GuildWarAnalyticsListBox";
import { getTeamObjectiveLabelKey } from "@portal/utils/guild-war-analytics";
import { getGuildWarMemberStatLabel, getGuildWarResultLabel } from "@portal/utils/game-rules";

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

const METRIC_ICONS: ComponentType<{ size?: number }>[] = [
  SwordsIcon,
  HeartIcon,
  HammerIcon,
  CrownIcon,
  TargetIcon,
  FlameIcon,
  UserCheckIcon,
  ShieldIcon,
];

type ConsoleFieldId = "source" | "subject" | "metric";

/**
 * A collapsed selector that shows what is currently chosen and opens on demand.
 *
 * Three permanently open list boxes stacked the console ~1700px tall and put
 * four nested scrollbars on screen at once. Collapsed, the whole query reads as
 * a handful of rows, and only the one being edited owns an inner scroll area.
 */
function ConsoleField({
  label,
  summary,
  open,
  onToggle,
  children,
}: {
  label: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="gwa-sidebar__section gwa-field">
      <UnstyledButton className="gwa-field__head" onClick={onToggle} aria-expanded={open}>
        <span className="gwa-field__label">{label}</span>
        <span className="gwa-field__summary">{summary}</span>
        {open ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
      </UnstyledButton>
      <Collapse expanded={open}>
        <div className="gwa-field__body">{children}</div>
      </Collapse>
    </div>
  );
}

export function GuildWarAnalyticsTab({
  analytics,
  chartThemeName,
  chartThemeConfig,
  loadErrorMessage,
  canManageWeights,
}: GuildWarAnalyticsTabProps) {
  const { t } = useTranslation("guild-war");
  const gameRules = DEFAULT_GAME_RULES;
  const warRules = gameRules.guild_war;
  const [normExpanded, setNormExpanded] = useState(false);
  // The table is the artefact people copy out to chat, so it stays open by
  // default; the toggle is for reclaiming height, not for finding it.
  const [tableExpanded, setTableExpanded] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(false);
  // Accordion: at most one selector is open, so the console keeps a fixed,
  // short height no matter how many wars or members exist.
  const [openField, setOpenField] = useState<ConsoleFieldId | null>(null);
  const toggleField = (id: ConsoleFieldId) =>
    setOpenField((current) => (current === id ? null : id));

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const warStatOptions = warRules.team_stats.map((definition) => ({
    value: definition.key,
    label: getTeamObjectiveLabelKey(definition.key),
  }));
  const metricOptions = [
    ...warRules.member_stats.map((definition, index) => ({
      value: definition.key,
      label: getGuildWarMemberStatLabel(definition.key),
      Icon: METRIC_ICONS[index % METRIC_ICONS.length] ?? TargetIcon,
    })),
    {
      value: GUILD_WAR_KDA_KEY,
      label: getGuildWarMemberStatLabel(GUILD_WAR_KDA_KEY),
      Icon: TrophyIcon,
    },
  ];

  const warStatLabel = warStatOptions.find(
    (option) => option.value === analytics.analyticsWarStat,
  )?.label;

  // Describe the query the chart is actually answering: which subject, which
  // metric, over how many wars. Empty fragments drop out rather than rendering
  // a dangling separator.
  const chartSubject =
    analytics.analyticsMode === "player" || analytics.analyticsMode === "radar"
      ? t("analytics.chart.subject.members", {
          count: analytics.analyticsSelectedUsers.length,
        })
      : analytics.analyticsMode === "teams"
        ? t("analytics.chart.subject.teams", {
            count: analytics.analyticsSelectedTeams.length,
          })
        : analytics.analyticsMode === "rankings"
          ? t("analytics.chart.subject.rankings", { count: analytics.analyticsTopN })
          : t("analytics.chart.subject.wars");
  const chartMetric =
    analytics.analyticsMode === "wars"
      ? (warStatLabel ?? "")
      : metricOptions
          .filter((option) => analytics.analyticsSelectedMetrics.includes(option.value))
          .map((option) => option.label)
          .join(" / ");
  const chartHeading = {
    kicker: t(`analytics.toolbar.mode.${analytics.analyticsMode}`),
    title: [
      chartSubject,
      chartMetric,
      t("analytics.chart.scope", { count: analytics.analyticsWarIds.length }),
    ]
      .filter((part) => part.length > 0)
      .join(" · "),
    note:
      analytics.analyticsNormEnabled && analytics.analyticsMode !== "wars"
        ? t("analytics.chart.normNote", { minutes: analytics.referenceDuration })
        : undefined,
  };

  const isLoading =
    analytics.analyticsQuery.isLoading || analytics.analyticsDetailsQuery.isLoading;
  const isFetching =
    analytics.analyticsQuery.isFetching || analytics.analyticsDetailsQuery.isFetching;
  const isError =
    analytics.analyticsQuery.isError || analytics.analyticsDetailsQuery.isError;
  const analyticsEmptyReason =
    analytics.analyticsWarIds.length === 0
      ? "war"
      : (analytics.analyticsMode === "player" || analytics.analyticsMode === "radar")
          && analytics.analyticsSelectedUsers.length === 0
        ? "member"
        : analytics.analyticsMode !== "wars"
            && analytics.analyticsSelectedMetrics.length === 0
          ? "metric"
          : null;
  const suggestedWarId = analytics.analyticsWarOptions[0]?.value;
  const suggestedUserId = analytics.analyticsSelectableUserIds[0];
  const suggestedMetric = metricOptions[0]?.value;
  const emptyState = analyticsEmptyReason
    ? {
        title: t("analytics.empty.title"),
        description: t(`analytics.empty.${analyticsEmptyReason}.description`),
        actionLabel:
          analyticsEmptyReason === "war" && suggestedWarId
            ? t("analytics.empty.war.action")
            : analyticsEmptyReason === "member" && suggestedUserId
              ? t("analytics.empty.member.action")
              : analyticsEmptyReason === "metric" && suggestedMetric
                ? t("analytics.empty.metric.action")
                : undefined,
        onAction:
          analyticsEmptyReason === "war" && suggestedWarId
            ? () => analytics.setAnalyticsSelectedWarIds([suggestedWarId])
            : analyticsEmptyReason === "member" && suggestedUserId
              ? () => analytics.applyAnalyticsSelection([suggestedUserId])
              : analyticsEmptyReason === "metric" && suggestedMetric
                ? () => analytics.setAnalyticsSelectedMetrics([suggestedMetric])
                : undefined,
      }
    : undefined;

  return (
    <Stack gap={12} className="gwa-layout">
      {/* Primary toolbar: mode + date preset */}
      <div className="gwa-toolbar">
        <div className="gwa-toolbar__item">
          <div className="gwa-toolbar__label">{t("analytics.toolbar.mode")}</div>
          <div className="gwa-toolbar__control-scroll">
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
        </div>

        <div className="gwa-toolbar__item">
          <div className="gwa-toolbar__label">{t("analytics.toolbar.datePreset")}</div>
          <div className="gwa-toolbar__control-scroll">
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

      {isError ? <Alert color="red">{loadErrorMessage}</Alert> : null}

      {/* Wars mode: win/loss record summary */}
      {!isLoading && !isError && analytics.analyticsMode === "wars" ? (
        <Group gap={16} className="gwa-war-summary">
          {GUILD_WAR_RESULT_DEFINITIONS.map((result) => (
            <Text key={result.id} size="sm">
              <Text span fw={600}>{getGuildWarResultLabel(result.id)}</Text>
              {" "}{analytics.analyticsWarSummary.counts.get(result.id) ?? 0}
            </Text>
          ))}
          {analytics.analyticsWarSummary.winRate !== null ? (
            <Text size="sm" fw={600} c="var(--domain-war)">
              {t("analytics.wars.winRate", { rate: analytics.analyticsWarSummary.winRate })}
            </Text>
          ) : null}
        </Group>
      ) : null}

      {/* Main content: left sidebar + chart + right sidebar */}
      {!isLoading && !isError ? (
        <>
          <div
            className={`gwa-content${isFetching ? " gwa-content--fetching" : ""}${chartExpanded ? " gwa-content--expanded" : ""}`}
          >
            {/* Controls keep a stable source → subject → metric → processing order. */}
            {!chartExpanded ? (
              <div className="gwa-console">
                <div className="gwa-console__head">
                  <Text size="xs" fw={700}>{t("analytics.console.title")}</Text>
                </div>

                {/* Source */}
                <ConsoleField
                  label={t("analytics.toolbar.warSet")}
                  summary={t("analytics.chart.scope", {
                    count: analytics.analyticsWarIds.length,
                  })}
                  open={openField === "source"}
                  onToggle={() => toggleField("source")}
                >
                  <GuildWarAnalyticsListBox
                    items={analytics.analyticsWarOptions}
                    selected={analytics.analyticsSelectedWarIds}
                    onChange={analytics.setAnalyticsSelectedWarIds}
                    searchable
                    searchPlaceholder={t("analytics.toolbar.selectWars")}
                    ariaLabel={t("analytics.aria.selectWars")}
                  />
                </ConsoleField>

                {/* Subject — the only slot that changes with the mode */}
                {analytics.analyticsMode === "player" || analytics.analyticsMode === "radar" ? (
                  <ConsoleField
                    label={t("analytics.console.section.members")}
                    summary={chartSubject}
                    open={openField === "subject"}
                    onToggle={() => toggleField("subject")}
                  >
                    <GuildWarAnalyticsListBox
                      items={analytics.analyticsSelectableUserIds.map((userId) => ({
                        value: userId,
                        label: analytics.analyticsUserIdToUsername.get(userId) ?? userId,
                      }))}
                      selected={analytics.analyticsSelectedUsers}
                      onChange={analytics.applyAnalyticsSelection}
                      maxSelect={ANALYTICS_SELECTION_HARD_CAP}
                      searchable
                      searchPlaceholder={t("analytics.selectMembers")}
                      ariaLabel={t("analytics.aria.selectMembers")}
                      renderItem={(item, checked) => <UserListBoxItem item={item} checked={checked} />}
                    />
                    {analytics.analyticsSelectedUsers.length >= analytics.selectionSoftCap ? (
                      <Text size="xs" c="dimmed">
                        {t("analytics.selectionSoftCap", {
                          count: analytics.selectionSoftCap,
                        })}
                      </Text>
                    ) : null}
                  </ConsoleField>
                ) : null}

                {analytics.analyticsMode === "teams" ? (
                  <ConsoleField
                    label={t("analytics.console.section.teams")}
                    summary={chartSubject}
                    open={openField === "subject"}
                    onToggle={() => toggleField("subject")}
                  >
                    <GuildWarAnalyticsListBox
                      items={analytics.analyticsTeamOptions.map((team) => ({
                        value: team,
                        label: team,
                      }))}
                      selected={analytics.analyticsSelectedTeams}
                      onChange={(values) => analytics.setAnalyticsSelectedTeams(values)}
                      searchable
                      searchPlaceholder={t("analytics.selectTeams")}
                      ariaLabel={t("analytics.aria.selectTeams")}
                    />
                  </ConsoleField>
                ) : null}

                {analytics.analyticsMode === "rankings" ? (
                  <ConsoleField
                    label={t("analytics.console.section.rankings")}
                    summary={chartSubject}
                    open={openField === "subject"}
                    onToggle={() => toggleField("subject")}
                  >
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
                    <Group gap={8} grow wrap="nowrap">
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
                      />
                    </Group>
                  </ConsoleField>
                ) : null}

                {/* Metric */}
                {analytics.analyticsMode === "wars" ? (
                  <ConsoleField
                    label={t("analytics.warStat.title")}
                    summary={chartMetric}
                    open={openField === "metric"}
                    onToggle={() => toggleField("metric")}
                  >
                    <Select
                      value={analytics.analyticsWarStat}
                      aria-label={t("analytics.warStat.title")}
                      onChange={(value) => value && analytics.setAnalyticsWarStat(value)}
                      data={warStatOptions}
                    />
                  </ConsoleField>
                ) : (
                  <ConsoleField
                    label={t("analytics.console.section.metric")}
                    summary={chartMetric}
                    open={openField === "metric"}
                    onToggle={() => toggleField("metric")}
                  >
                    <GuildWarAnalyticsListBox
                      items={metricOptions}
                      selected={analytics.analyticsSelectedMetrics}
                      onChange={(values) =>
                        analytics.setAnalyticsSelectedMetrics(
                          values.slice(0, 5) as AnalyticsMetricKey[],
                        )
                      }
                      maxSelect={5}
                      ariaLabel={t("analytics.aria.selectMetrics")}
                    />
                  </ConsoleField>
                )}

                {/* Processing */}
                {analytics.analyticsMode === "player" ? (
                  <div className="gwa-sidebar__section">
                    <div className="gwa-toolbar__label">{t("analytics.console.processing")}</div>
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

                {analytics.analyticsMode === "teams" ? (
                  <div className="gwa-sidebar__section">
                    <div className="gwa-toolbar__label">{t("analytics.console.processing")}</div>
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

                {/*
                  * Normalization rewrites every number on screen, so it gets its
                  * own accented block at a fixed spot instead of hiding as one
                  * more collapsed row — and the chart header repeats the state.
                  * Not applicable to the war-level own/enemy raw comparison.
                  */}
                {analytics.analyticsMode !== "wars" ? (
                  <div
                    className={`gwa-sidebar__section gwa-norm${
                      analytics.analyticsNormEnabled ? " gwa-norm--active" : ""
                    }`}
                  >
                    <div className="gwa-norm-toggle">
                      <UnstyledButton
                        onClick={() => setNormExpanded(!normExpanded)}
                        className="gwa-norm-toggle__expand"
                        aria-expanded={normExpanded && analytics.analyticsNormEnabled}
                      >
                        <AdjustmentsIcon size={14} />
                        <Text size="xs" fw={500}>{t("analytics.normalization")}</Text>
                      </UnstyledButton>
                      <Switch
                        checked={analytics.analyticsNormEnabled}
                        onChange={(event) => analytics.setAnalyticsNormEnabled(event.currentTarget.checked)}
                        size="xs"
                        aria-label={t("analytics.normalization.enable")}
                        styles={{ track: { cursor: "pointer" } }}
                      />
                    </div>
                    <Collapse expanded={normExpanded && analytics.analyticsNormEnabled}>
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
                          {warRules.team_stats.filter((definition) => definition.dashboard !== "hidden").map(
                            (definition) => {
                              const key = definition.key;
                              return (
                              <Group key={key} gap={8} wrap="nowrap" align="center">
                                <Text size="xs" fw={500} style={{ width: 64, flexShrink: 0 }}>
                                  {getTeamObjectiveLabelKey(key)}
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
                              );
                            },
                          )}
                        </div>
                        <Text size="xs" c="dimmed" mt={6}>
                          {t("analytics.normalization.weightsTotal", {
                            total: `${(
                              warRules.team_stats.reduce(
                                (sum, definition) => sum + (analytics.modifierWeights[definition.key] ?? 0),
                                0,
                              ) * 100
                            ).toFixed(0)}%`,
                          })}
                        </Text>
                      </div>
                    </Collapse>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ── Workspace: chart above, data table permanently below it ── */}
            <div className="gwa-workspace">
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
                heading={chartHeading}
                t={t}
                emptyState={emptyState}
              />

            {/* Data table — kept open: it is the artefact people copy out */}
            <div className="gwa-table-section">
              {/* Only the expand affordance is interactive; sibling controls are not nested in it. */}
              <div className="gwa-table-toggle">
                <UnstyledButton
                  onClick={() => setTableExpanded(!tableExpanded)}
                  className="gwa-table-toggle__expand"
                  aria-expanded={tableExpanded}
                >
                  <Group gap={6}>
                    {tableExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                    <Text size="xs" fw={500}>
                      {t("analytics.table.title", { count: analytics.analyticsTableRows.length })}
                    </Text>
                  </Group>
                </UnstyledButton>
                <Group gap={6}>
                  <Switch
                    checked={analytics.analyticsHeatmapEnabled}
                    onChange={(e) => analytics.setAnalyticsHeatmapEnabled(e.currentTarget.checked)}
                    size="xs"
                    label={t("analytics.heatmap")}
                    styles={{ label: { fontSize: 11, cursor: "pointer" } }}
                  />
                  <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                    <HoverCard.Target>
                      <UnstyledButton
                        onClick={() => analytics.copyAnalyticsCsv()}
                        className="gwa-table-action"
                        aria-label={t("analytics.aria.copyCsv")}
                      >
                        <CopyIcon size={13} />
                        <Text size="xs">CSV</Text>
                      </UnstyledButton>
                    </HoverCard.Target>
                    <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                      <Group gap={10} wrap="nowrap" align="flex-start">
                        <ThemeIcon variant="light" color="gray" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
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
              </div>
              <Collapse expanded={tableExpanded}>
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
                                const range = heatmapRange.max - heatmapRange.min;
                                const ratio = range > 0
                                  ? (val - heatmapRange.min) / range
                                  : 0.5;
                                cellStyle = {
                                  background: `color-mix(in srgb, var(--domain-war) ${Math.round(ratio * 35)}%, transparent)`,
                                };
                              }
                              return (
                                <Table.Td key={col.key} style={cellStyle}>
                                  {val === null || val === undefined ? "-" : String(val)}
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
            </div>
          </div>
        </>
      ) : null}
    </Stack>
  );
}
