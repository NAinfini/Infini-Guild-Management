import {
  Alert,
  Avatar,
  Checkbox,
  Divider,
  Group,
  Skeleton,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { PortalCard } from "../../shared/PortalCard";
import { Split } from "@gfazioli/mantine-split-pane";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { useTranslation } from "react-i18next";

type AnalyticsMode = "player" | "rankings" | "teams";
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
  mode: AnalyticsMode;
  onModeChange: (value: AnalyticsMode) => void;
  selectedMetrics: AnalyticsMetricKey[];
  onSelectedMetricsChange: (value: AnalyticsMetricKey[]) => void;
  selectedWarIds: string[];
  onSelectedWarIdsChange: (value: string[]) => void;
  warOptions: Array<{ value: string; label: string }>;
  datePreset: AnalyticsDatePreset;
  onDatePresetChange: (value: AnalyticsDatePreset) => void;
  onCopySnapshot: () => Promise<void> | void;
  onCopyCsv: () => Promise<void> | void;
  isExternalView: boolean;
  tableRows: Array<Record<string, unknown>>;
  focusedUser: string;
  onFocusedUserChange: (value: string) => void;
  selectableUserIds: string[];
  userIdToUsername: Map<string, string>;
  onlyParticipated: boolean;
  onOnlyParticipatedChange: (value: boolean) => void;
  selectedUsers: string[];
  onSelectedUsersChange: (value: string[]) => void;
  hashToPaletteColor: (value: string, palette: string[]) => string;
  chartPalette: string[];
  aggregation: AnalyticsAggregation;
  onAggregationChange: (value: AnalyticsAggregation) => void;
  topN: number;
  onTopNChange: (value: number) => void;
  minParticipation: number;
  onMinParticipationChange: (value: number) => void;
  selectedTeams: string[];
  onSelectedTeamsChange: (value: string[]) => void;
  teamOptions: string[];
  teamAggregation: "total" | "average";
  onTeamAggregationChange: (value: "total" | "average") => void;
  selectionSoftCap: number;
  analyticsQueryLoading: boolean;
  analyticsQueryError: boolean;
  analyticsDetailsLoading: boolean;
  analyticsDetailsError: boolean;
  loadErrorMessage: string;
  metricLabel: string;
  echarts: unknown;
  chartThemeName: string;
  chartOption: unknown;
  normEnabled: boolean;
  onNormEnabledChange: (value: boolean) => void;
  modifierWeights: { kda: number; towers: number; credits: number; distance: number; basehp: number };
  onModifierWeightsChange: (weights: { kda: number; towers: number; credits: number; distance: number; basehp: number }) => void;
  referenceDuration: number;
};

const ANALYTICS_METRIC_OPTIONS: Array<{ value: AnalyticsMetricKey; labelKey: string; icon: string }> = [
  { value: "damage", labelKey: "analytics.metric.damage", icon: "⚔️" },
  { value: "healing", labelKey: "analytics.metric.healing", icon: "💚" },
  { value: "building_damage", labelKey: "analytics.metric.buildingDamage", icon: "🏰" },
  { value: "credits", labelKey: "analytics.metric.credits", icon: "💰" },
  { value: "kills", labelKey: "analytics.metric.kills", icon: "💀" },
  { value: "deaths", labelKey: "analytics.metric.deaths", icon: "☠️" },
  { value: "assists", labelKey: "analytics.metric.assists", icon: "🤝" },
  { value: "damage_taken", labelKey: "analytics.metric.damageTaken", icon: "🛡️" },
  { value: "kda", labelKey: "analytics.metric.kda", icon: "📊" },
];

export function GuildWarAnalyticsTab({
  mode,
  onModeChange,
  selectedMetrics,
  onSelectedMetricsChange,
  selectedWarIds,
  onSelectedWarIdsChange,
  warOptions,
  datePreset,
  onDatePresetChange,
  focusedUser: _focusedUser,
  onFocusedUserChange: _onFocusedUserChange,
  selectableUserIds,
  userIdToUsername,
  onlyParticipated,
  onOnlyParticipatedChange,
  selectedUsers,
  onSelectedUsersChange,
  hashToPaletteColor: _hashToPaletteColor,
  chartPalette: _chartPalette,
  aggregation,
  onAggregationChange,
  topN,
  onTopNChange,
  minParticipation,
  onMinParticipationChange,
  selectedTeams,
  onSelectedTeamsChange,
  teamOptions,
  teamAggregation,
  onTeamAggregationChange,
  selectionSoftCap,
  analyticsQueryLoading,
  analyticsQueryError,
  analyticsDetailsLoading,
  analyticsDetailsError,
  loadErrorMessage,
  metricLabel: _metricLabel,
  echarts,
  chartThemeName,
  chartOption,
  normEnabled,
  onNormEnabledChange,
  modifierWeights,
  onModifierWeightsChange,
  referenceDuration,
}: GuildWarAnalyticsTabProps) {
  const { t } = useTranslation("guild-war");
  const metricOptions = ANALYTICS_METRIC_OPTIONS.map((opt) => ({ ...opt, label: t(opt.labelKey) }));

  return (
    <Stack gap={12} className="guild-war-analytics-layout">
      <PortalCard interactive={false} className="guild-war-analytics-control-panel guild-war-analytics-control-panel--top">
        <div style={{ padding: "1.2rem" }}>
        <div className="guild-war-analytics-toolbar">
          <div className="guild-war-analytics-toolbar__row">
            <div className="guild-war-analytics-toolbar__item">
              <div className="guild-war-analytics-toolbar__label">{t("analytics.toolbar.mode")}</div>
              <SegmentedControl
                value={mode}
                onChange={(value) => onModeChange(value as AnalyticsMode)}
                data={[
                  { label: t("analytics.toolbar.mode.player"), value: "player" },
                  { label: t("analytics.toolbar.mode.rankings"), value: "rankings" },
                  { label: t("analytics.toolbar.mode.teams"), value: "teams" },
                ]}
              />
            </div>

            <div className="guild-war-analytics-toolbar__item">
              <div className="guild-war-analytics-toolbar__label">{t("analytics.toolbar.datePreset")}</div>
              <SegmentedControl
                value={datePreset}
                onChange={(value) => onDatePresetChange(value as AnalyticsDatePreset)}
                data={[
                  { label: t("analytics.toolbar.datePreset.last5"), value: "5" },
                  { label: t("analytics.toolbar.datePreset.last10"), value: "10" },
                  { label: t("analytics.toolbar.datePreset.last20"), value: "20" },
                  { label: t("analytics.toolbar.datePreset.all"), value: "all" },
                ]}
              />
            </div>

            <div className="guild-war-analytics-toolbar__item guild-war-analytics-toolbar__item--grow">
              <div className="guild-war-analytics-toolbar__label">{t("analytics.toolbar.warSet")}</div>
              <MultiSelect
                clearable
                style={{ minWidth: 280 }}
                placeholder={t("analytics.toolbar.selectWars")}
                aria-label="Select wars for analytics"
                value={selectedWarIds}
                onChange={onSelectedWarIdsChange}
                data={warOptions}
              />
            </div>
          </div>
        </div>
        </div>
      </PortalCard>

      {analyticsQueryLoading || analyticsDetailsLoading ? <Stack gap={8}><Skeleton height={180} radius={8} />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {analyticsQueryError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}
      {analyticsDetailsError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}

      {!analyticsQueryLoading && !analyticsQueryError && !analyticsDetailsLoading && !analyticsDetailsError && warOptions.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">{t("analytics.noWarsSelected")}</Text>
      ) : null}

      {!analyticsQueryLoading && !analyticsQueryError && !analyticsDetailsLoading && !analyticsDetailsError && warOptions.length > 0 ? (
        <Split style={{ minHeight: 486 }}>
          <Split.Pane initialWidth="20%" minWidth={200} maxWidth="40%">
          <PortalCard interactive={false} className="guild-war-analytics-control-panel guild-war-analytics-control-panel--left">
            <div style={{ padding: "1.2rem" }}>
            <Stack gap={10}>
              <Text fw={600}>{t("analytics.metrics.title")}</Text>
                <MultiSelect
                  clearable
                  searchable
                  placeholder={t("analytics.metrics.placeholder")}
                  aria-label="Select analytics metrics"
                  value={selectedMetrics}
                  onChange={(values) => onSelectedMetricsChange(values.slice(0, 5) as AnalyticsMetricKey[])}
                  data={metricOptions}
                  maxValues={5}
                  styles={{ pill: { display: "none" } }}
                  renderOption={({ option, checked }) => (
                    <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                      <Group gap={8}>
                        <span style={{ fontSize: 16 }}>{(option as typeof metricOptions[0]).icon}</span>
                        <span style={{ color: checked ? "var(--color-primary, #3b82f6)" : undefined, fontWeight: checked ? 600 : 400 }}>{option.label}</span>
                      </Group>
                      {checked ? <span style={{ color: "var(--color-primary, #3b82f6)" }}>✓</span> : null}
                    </Group>
                  )}
                />

                {mode === "rankings" ? (
                  <>
                    <Select
                      value={aggregation}
                      aria-label="Select rankings aggregation"
                      onChange={(value) => value && onAggregationChange(value as AnalyticsAggregation)}
                      data={[
                        { value: "total", label: t("analytics.aggregation.total") },
                        { value: "average", label: t("analytics.aggregation.average") },
                        { value: "best", label: t("analytics.aggregation.best") },
                        { value: "median", label: t("analytics.aggregation.median") },
                      ]}
                    />
                    <NumberInput
                      min={1}
                      max={20}
                      value={topN}
                      onChange={(value) => onTopNChange(typeof value === "number" ? value : 10)}
                      aria-label="Select rankings top N"
                      label={t("analytics.topN")}
                    />
                    <NumberInput
                      min={1}
                      max={200}
                      value={minParticipation}
                      onChange={(value) => onMinParticipationChange(typeof value === "number" ? value : 1)}
                      aria-label="Select minimum wars participation"
                      label={t("analytics.minParticipation")}
                    />
                  </>
                ) : null}

                {mode === "teams" ? (
                  <SegmentedControl
                    value={teamAggregation}
                    onChange={(value) => onTeamAggregationChange(value as "total" | "average")}
                    data={[
                      { value: "total", label: t("analytics.aggregation.total") },
                      { value: "average", label: t("analytics.aggregation.average") },
                    ]}
                  />
                ) : null}
              </Stack>
              </div>
            </PortalCard>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane grow>
          <PortalCard interactive={false} className="guild-war-analytics-chart-card guild-war-analytics-chart-card--center">
            <div style={{ padding: "1.2rem" }}>
            <Stack gap={8}>
              <Text fw={600}>{t("analytics.chart")}</Text>
              <ReactEChartsCore
                key={`${selectedUsers.join(',')}-${selectedMetrics.join(',')}`}
                echarts={echarts}
                theme={chartThemeName}
                option={chartOption}
                style={{ width: "100%", height: 420 }}
              />
            </Stack>
            </div>
          </PortalCard>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane initialWidth="20%" minWidth={200} maxWidth="40%">
          <PortalCard interactive={false} className="guild-war-analytics-control-panel guild-war-analytics-control-panel--right">
            <div style={{ padding: "1.2rem" }}>
            <Stack gap={10}>
              <Text fw={600}>{t("analytics.selection")}</Text>

              {mode === "player" ? (
                <>
                  <MultiSelect
                    clearable
                    searchable
                    placeholder={t("analytics.selectMembers")}
                    aria-label="Select player analytics members"
                    value={selectedUsers}
                    onChange={(values) => onSelectedUsersChange(values.slice(0, 5))}
                    data={selectableUserIds.map((userId) => ({ value: userId, label: userIdToUsername.get(userId) ?? userId }))}
                    maxValues={5}
                    styles={{ pill: { display: "none" } }}
                    renderOption={({ option, checked }) => (
                      <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                        <Group gap={8}>
                          <Avatar size={20} radius="xl">{(userIdToUsername.get(option.value) ?? option.value).slice(0, 2).toUpperCase()}</Avatar>
                          <span style={{ color: checked ? "var(--color-primary, #3b82f6)" : undefined, fontWeight: checked ? 600 : 400 }}>{option.label}</span>
                        </Group>
                        {checked ? <span style={{ color: "var(--color-primary, #3b82f6)" }}>✓</span> : null}
                      </Group>
                    )}
                  />
                  {selectedUsers.length >= selectionSoftCap ? (
                    <Text size="xs" c="dimmed">{t("analytics.selectionSoftCap", { count: selectionSoftCap })}</Text>
                  ) : null}
                  <Checkbox
                    checked={onlyParticipated}
                    onChange={(event) => onOnlyParticipatedChange(event.currentTarget.checked)}
                    label={t("analytics.onlyParticipated")}
                  />
                </>
              ) : null}

              {mode === "teams" ? (
                <MultiSelect
                  clearable
                  searchable
                  placeholder={t("analytics.selectTeams")}
                  aria-label="Select team analytics teams"
                  value={selectedTeams}
                  onChange={(values) => onSelectedTeamsChange(values)}
                  data={teamOptions.map((team) => ({ value: team, label: team }))}
                  styles={{ pill: { display: "none" } }}
                  renderOption={({ option, checked }) => (
                    <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                      <span style={{ color: checked ? "var(--color-primary, #3b82f6)" : undefined, fontWeight: checked ? 600 : 400 }}>{option.label}</span>
                      {checked ? <span style={{ color: "var(--color-primary, #3b82f6)" }}>✓</span> : null}
                    </Group>
                  )}
                />
              ) : null}

              {mode === "rankings" ? (
                <Text c="dimmed" size="sm">
                  {t("analytics.rankingsHint")}
                </Text>
              ) : null}

              <Divider />
              <Switch
                checked={normEnabled}
                onChange={(e) => onNormEnabledChange(e.currentTarget.checked)}
                label={t("analytics.normalization.enable")}
                size="sm"
              />
              {normEnabled ? (
                <Stack gap={8}>
                  <Text c="dimmed" size="xs">
                    {t("analytics.normalization.refDuration", { minutes: referenceDuration })}
                  </Text>
                  <Text fw={500} size="sm" mt={4}>{t("analytics.normalization.equation")}</Text>
                  <Text c="dimmed" size="xs" ff="monospace">
                    {t("analytics.normalization.equationDesc")}
                  </Text>
                  {(["kda", "towers", "credits", "distance", "basehp"] as const).map((key) => (
                    <Group key={key} gap={8} wrap="nowrap" align="center">
                      <Text size="xs" fw={500} style={{ width: 64, flexShrink: 0 }}>
                        {t(`analytics.normalization.weight.${key}`)}
                      </Text>
                      <Slider
                        style={{ flex: 1, minWidth: 60 }}
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(modifierWeights[key] * 100)}
                        onChange={(val) =>
                          onModifierWeightsChange({ ...modifierWeights, [key]: val / 100 })
                        }
                        size="sm"
                        label={(val) => `${val}%`}
                      />
                      <Text size="xs" fw={600} c="dimmed" style={{ width: 38, textAlign: "right", flexShrink: 0 }}>
                        {(modifierWeights[key] * 100).toFixed(0)}%
                      </Text>
                    </Group>
                  ))}
                  <Text size="xs" c="dimmed">
                    {t("analytics.normalization.weightsTotal", {
                      total: ((modifierWeights.kda + modifierWeights.towers + modifierWeights.credits + modifierWeights.distance + modifierWeights.basehp) * 100).toFixed(0) + "%",
                    })}
                  </Text>
                </Stack>
              ) : null}
            </Stack>
            </div>
          </PortalCard>
          </Split.Pane>
        </Split>
      ) : null}
    </Stack>
  );
}

