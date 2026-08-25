import { Alert } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Slider } from "@portal/components/ui/slider";
import { Switch } from "@portal/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import {
  AdjustmentsIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  CrownIcon,
  FlameIcon,
  HammerIcon,
  HeartIcon,
  ShieldIcon,
  SwordsIcon,
  TargetIcon,
  TrophyIcon,
  UserCheckIcon,
} from "@portal/components/icons";
import {
  DEFAULT_GAME_RULES,
  GUILD_WAR_KDA_KEY,
  GUILD_WAR_RESULT_DEFINITIONS,
  type SiteAnalyticsSettings,
} from "@guild/shared";
import { BarChart, LineChart, RadarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  AnalyticsAggregation,
  AnalyticsDatePreset,
  AnalyticsMetricKey,
  AnalyticsMode,
} from "@portal/types/guild-war";
import type { GuildWarAnalyticsController } from "@portal/hooks/guild-war/useGuildWarAnalytics";
import type { EChartsThemeConfig } from "@portal/theme/echarts";
import { ANALYTICS_SELECTION_HARD_CAP } from "@portal/services/GuildWarService";
import { getGuildWarMemberStatLabel, getGuildWarResultLabel } from "@portal/utils/game-rules";
import { getTeamObjectiveLabelKey } from "@portal/utils/guild-war-analytics";
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
type AnalyticsWeightKey = keyof SiteAnalyticsSettings["modifier_weights"];

const ANALYTICS_WEIGHT_KEYS = new Set<AnalyticsWeightKey>([
  "kills",
  "towers",
  "base_hp",
  "credits",
  "distance",
]);

function isAnalyticsWeightKey(key: string): key is AnalyticsWeightKey {
  return ANALYTICS_WEIGHT_KEYS.has(key as AnalyticsWeightKey);
}

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
  children: ReactNode;
}) {
  return (
    <div className="gwa-sidebar__section gwa-field">
      <Button
        type="button"
        variant="ghost"
        className="gwa-field__head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="gwa-field__label">{label}</span>
        <span className="gwa-field__summary">{summary}</span>
        {open ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
      </Button>
      {open ? <div className="gwa-field__body">{children}</div> : null}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onValueChange: (value: T) => void;
}) {
  return (
    <div className="gwa-choice-group" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? "secondary" : "ghost"}
          className="gwa-choice-group__option"
          aria-pressed={option.value === value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
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
  const warRules = DEFAULT_GAME_RULES.guild_war;
  const [normExpanded, setNormExpanded] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [openField, setOpenField] = useState<ConsoleFieldId | null>(null);
  const toggleField = (id: ConsoleFieldId) =>
    setOpenField((current) => (current === id ? null : id));

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const modeOptions: Array<{ value: AnalyticsMode; label: string }> = [
    { value: "player", label: t("analytics.toolbar.mode.player") },
    { value: "rankings", label: t("analytics.toolbar.mode.rankings") },
    { value: "teams", label: t("analytics.toolbar.mode.teams") },
    { value: "radar", label: t("analytics.toolbar.mode.radar") },
    { value: "wars", label: t("analytics.toolbar.mode.wars") },
  ];
  const datePresetOptions: Array<{ value: AnalyticsDatePreset; label: string }> = [
    { value: "5", label: t("analytics.toolbar.datePreset.last5") },
    { value: "10", label: t("analytics.toolbar.datePreset.last10") },
    { value: "20", label: t("analytics.toolbar.datePreset.last20") },
    { value: "all", label: t("analytics.toolbar.datePreset.all") },
  ];
  const aggregationOptions: Array<{ value: AnalyticsAggregation; label: string }> = [
    { value: "total", label: t("analytics.aggregation.total") },
    { value: "average", label: t("analytics.aggregation.average") },
    { value: "best", label: t("analytics.aggregation.best") },
    { value: "median", label: t("analytics.aggregation.median") },
  ];
  const teamAggregationOptions: Array<{ value: "total" | "average"; label: string }> = [
    { value: "total", label: t("analytics.aggregation.total") },
    { value: "average", label: t("analytics.aggregation.average") },
  ];
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
    <div className="gwa-layout">
      <div className="gwa-toolbar">
        <div className="gwa-toolbar__item">
          <div className="gwa-toolbar__label">{t("analytics.toolbar.mode")}</div>
          <div className="gwa-toolbar__control-scroll">
            <ChoiceGroup
              label={t("analytics.toolbar.mode")}
              value={analytics.analyticsMode}
              options={modeOptions}
              onValueChange={analytics.setAnalyticsMode}
            />
          </div>
        </div>

        <div className="gwa-toolbar__item">
          <div className="gwa-toolbar__label">{t("analytics.toolbar.datePreset")}</div>
          <div className="gwa-toolbar__control-scroll">
            <ChoiceGroup
              label={t("analytics.toolbar.datePreset")}
              value={analytics.analyticsDatePreset}
              options={datePresetOptions}
              onValueChange={analytics.handleAnalyticsDatePresetChange}
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="gwa-loading" aria-busy="true">
          <Skeleton className="gwa-loading__chart" />
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="gwa-loading__line" />
          ))}
        </div>
      ) : null}

      {isError ? <Alert variant="destructive">{loadErrorMessage}</Alert> : null}

      {!isLoading && !isError && analytics.analyticsMode === "wars" ? (
        <div className="gwa-war-summary" aria-live="polite">
          {GUILD_WAR_RESULT_DEFINITIONS.map((result) => (
            <span key={result.id} className="gwa-war-summary__result" data-result={result.id}>
              <strong>{getGuildWarResultLabel(result.id)}</strong>{" "}
              {analytics.analyticsWarSummary.counts.get(result.id) ?? 0}
            </span>
          ))}
          {analytics.analyticsWarSummary.winRate !== null ? (
            <strong className="gwa-war-summary__rate">
              {t("analytics.wars.winRate", { rate: analytics.analyticsWarSummary.winRate })}
            </strong>
          ) : null}
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <div
          className={`gwa-content${isFetching ? " gwa-content--fetching" : ""}${chartExpanded ? " gwa-content--expanded" : ""}`}
          aria-busy={isFetching || undefined}
        >
          {!chartExpanded ? (
            <aside className="gwa-console" aria-label={t("analytics.console.title")}>
              <div className="gwa-console__head">{t("analytics.console.title")}</div>

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
                    <p className="gwa-field__hint">
                      {t("analytics.selectionSoftCap", {
                        count: analytics.selectionSoftCap,
                      })}
                    </p>
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
                    onChange={analytics.setAnalyticsSelectedTeams}
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
                    items={aggregationOptions}
                    onValueChange={(value) => {
                      if (value) analytics.setAnalyticsAggregation(value as AnalyticsAggregation);
                    }}
                  >
                    <SelectTrigger
                      className="gwa-select"
                      aria-label={t("analytics.aria.selectAggregation")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {aggregationOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="gwa-number-fields">
                    <Label className="gwa-number-field">
                      <span>{t("analytics.topN")}</span>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={analytics.analyticsTopN}
                        onChange={(event) => {
                          const next = event.currentTarget.valueAsNumber;
                          analytics.setAnalyticsTopN(Number.isFinite(next) ? next : 10);
                        }}
                        aria-label={t("analytics.aria.topN")}
                      />
                    </Label>
                    <Label className="gwa-number-field">
                      <span>{t("analytics.minParticipation")}</span>
                      <Input
                        type="number"
                        min={0}
                        max={200}
                        value={analytics.analyticsMinParticipation}
                        onChange={(event) => {
                          const next = event.currentTarget.valueAsNumber;
                          analytics.setAnalyticsMinParticipation(Number.isFinite(next) ? next : 1);
                        }}
                        aria-label={t("analytics.aria.minParticipation")}
                      />
                    </Label>
                  </div>
                </ConsoleField>
              ) : null}

              {analytics.analyticsMode === "wars" ? (
                <ConsoleField
                  label={t("analytics.warStat.title")}
                  summary={chartMetric}
                  open={openField === "metric"}
                  onToggle={() => toggleField("metric")}
                >
                  <Select
                    value={analytics.analyticsWarStat}
                    items={warStatOptions}
                    onValueChange={(value) => {
                      if (value) analytics.setAnalyticsWarStat(value);
                    }}
                  >
                    <SelectTrigger className="gwa-select" aria-label={t("analytics.warStat.title")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {warStatOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      analytics.setAnalyticsSelectedMetrics(values.slice(0, 5) as AnalyticsMetricKey[])
                    }
                    maxSelect={5}
                    ariaLabel={t("analytics.aria.selectMetrics")}
                  />
                </ConsoleField>
              )}

              {analytics.analyticsMode === "player" ? (
                <div className="gwa-sidebar__section">
                  <div className="gwa-toolbar__label">{t("analytics.console.processing")}</div>
                  <Label className="gwa-switch-field">
                    <Switch
                      checked={analytics.analyticsOnlyParticipated}
                      onCheckedChange={analytics.setAnalyticsOnlyParticipated}
                      size="sm"
                    />
                    <span>{t("analytics.onlyParticipated")}</span>
                  </Label>
                  <Label className="gwa-switch-field">
                    <Switch
                      checked={analytics.analyticsShowDeviation}
                      onCheckedChange={analytics.setAnalyticsShowDeviation}
                      size="sm"
                    />
                    <span>{t("analytics.showDeviation")}</span>
                  </Label>
                </div>
              ) : null}

              {analytics.analyticsMode === "teams" ? (
                <div className="gwa-sidebar__section">
                  <div className="gwa-toolbar__label">{t("analytics.console.processing")}</div>
                  <ChoiceGroup
                    label={t("analytics.console.processing")}
                    value={analytics.analyticsTeamAggregation}
                    options={teamAggregationOptions}
                    onValueChange={analytics.setAnalyticsTeamAggregation}
                  />
                  <Label className="gwa-switch-field">
                    <Switch
                      checked={analytics.analyticsShowContribution}
                      onCheckedChange={analytics.setAnalyticsShowContribution}
                      size="sm"
                    />
                    <span>{t("analytics.showContribution")}</span>
                  </Label>
                </div>
              ) : null}

              {analytics.analyticsMode !== "wars" ? (
                <div
                  className={`gwa-sidebar__section gwa-norm${
                    analytics.analyticsNormEnabled ? " gwa-norm--active" : ""
                  }`}
                >
                  <div className="gwa-norm-toggle">
                    <Button
                      type="button"
                      variant="ghost"
                      className="gwa-norm-toggle__expand"
                      onClick={() => setNormExpanded((current) => !current)}
                      aria-expanded={normExpanded && analytics.analyticsNormEnabled}
                    >
                      <AdjustmentsIcon size={14} />
                      <span>{t("analytics.normalization")}</span>
                    </Button>
                    <Switch
                      checked={analytics.analyticsNormEnabled}
                      onCheckedChange={analytics.setAnalyticsNormEnabled}
                      size="sm"
                      aria-label={t("analytics.normalization.enable")}
                    />
                  </div>
                  {normExpanded && analytics.analyticsNormEnabled ? (
                    <div className="gwa-norm-panel">
                      <p className="gwa-norm-panel__copy">
                        {t("analytics.normalization.refDuration", {
                          minutes: analytics.referenceDuration,
                        })}
                      </p>
                      <p className="gwa-norm-panel__equation">
                        {t("analytics.normalization.equationDesc")}
                      </p>
                      <div className="gwa-norm-weights">
                        {warRules.team_stats
                          .filter((definition) => definition.dashboard !== "hidden")
                          .map((definition) => {
                            const key = definition.key;
                            if (!isAnalyticsWeightKey(key)) return null;
                            const weight = Math.round(analytics.modifierWeights[key] * 100);
                            return (
                              <div key={key} className="gwa-norm-weight">
                                <span className="gwa-norm-weight__label">
                                  {getTeamObjectiveLabelKey(key)}
                                </span>
                                {canManageWeights ? (
                                  <Slider
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={weight}
                                    onValueChange={(value) =>
                                      analytics.setModifierWeights({
                                        ...analytics.modifierWeights,
                                        [key]: value / 100,
                                      })
                                    }
                                    aria-label={getTeamObjectiveLabelKey(key)}
                                  />
                                ) : (
                                  <span className="gwa-norm-weight__spacer" aria-hidden="true" />
                                )}
                                <output className="gwa-norm-weight__value">{weight}%</output>
                              </div>
                            );
                          })}
                      </div>
                      <p className="gwa-norm-panel__copy">
                        {t("analytics.normalization.weightsTotal", {
                          total: `${(
                            Object.values(analytics.modifierWeights).reduce(
                              (sum, weight) => sum + weight,
                              0,
                            ) * 100
                          ).toFixed(0)}%`,
                        })}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </aside>
          ) : null}

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
              onToggleExpanded={() => setChartExpanded((current) => !current)}
              heading={chartHeading}
              t={t}
              emptyState={emptyState}
            />

            <section className="gwa-table-section">
              <div className="gwa-table-toggle">
                <Button
                  type="button"
                  variant="ghost"
                  className="gwa-table-toggle__expand"
                  onClick={() => setTableExpanded((current) => !current)}
                  aria-expanded={tableExpanded}
                >
                  {tableExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                  <span>{t("analytics.table.title", { count: analytics.analyticsTableRows.length })}</span>
                </Button>
                <div className="gwa-table-toggle__actions">
                  <Label className="gwa-switch-field gwa-switch-field--compact">
                    <Switch
                      checked={analytics.analyticsHeatmapEnabled}
                      onCheckedChange={analytics.setAnalyticsHeatmapEnabled}
                      size="sm"
                    />
                    <span>{t("analytics.heatmap")}</span>
                  </Label>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="gwa-table-action"
                          onClick={analytics.copyAnalyticsCsv}
                          aria-label={t("analytics.aria.copyCsv")}
                        />
                      }
                    >
                      <CopyIcon size={13} />
                      <span>CSV</span>
                    </TooltipTrigger>
                    <TooltipContent className="gwa-table-action__tooltip">
                      <CopyIcon className="gwa-table-action__tooltip-icon" size={16} />
                      <span>
                        <strong>{t("hovercard.copyCsv.title")}</strong>
                        <span>{t("hovercard.copyCsv.desc")}</span>
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {tableExpanded ? (
                <div className="gwa-table-wrap">
                  <table
                    className={`gwa-table${analytics.analyticsHeatmapEnabled ? "" : " gwa-table--striped"}`}
                    aria-label={t("analytics.table.title", { count: analytics.analyticsTableRows.length })}
                  >
                    <thead>
                      <tr>
                        {analytics.analyticsTableColumns.map((column) => (
                          <th key={column.key} scope="col">
                            {column.title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(analytics.analyticsTableRows as Array<Record<string, unknown>>).map(
                        (row, rowIndex) => (
                          <tr key={String(row.key ?? rowIndex)}>
                            {analytics.analyticsTableColumns.map((column) => {
                              const columnKey = column.dataIndex ?? column.key;
                              const value = row[columnKey];
                              const heatmapRange = analytics.analyticsHeatmapEnabled
                                ? analytics.analyticsTableHeatmapRanges.get(columnKey)
                                : undefined;
                              let cellStyle: CSSProperties | undefined;
                              if (heatmapRange && typeof value === "number") {
                                const range = heatmapRange.max - heatmapRange.min;
                                const ratio = range > 0 ? (value - heatmapRange.min) / range : 0.5;
                                cellStyle = {
                                  background: `color-mix(in srgb, var(--domain-war) ${Math.round(ratio * 35)}%, transparent)`,
                                };
                              }
                              return (
                                <td key={column.key} style={cellStyle}>
                                  {value === null || value === undefined ? "-" : String(value)}
                                </td>
                              );
                            })}
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
