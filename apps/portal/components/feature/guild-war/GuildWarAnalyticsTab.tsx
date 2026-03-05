import {
  Alert,
  Avatar,
  Checkbox,
  Divider,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { useState, useRef, useCallback, useEffect } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

type AnalyticsMode = "player" | "compare" | "rankings" | "teams";
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
  onlyParticipated: boolean;
  onOnlyParticipatedChange: (value: boolean) => void;
  selectedUsers: string[];
  onSelectedUsersChange: (value: string[]) => void;
  compareUserIds: string[];
  onLegendInteraction: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
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
  onlyParticipated,
  onOnlyParticipatedChange,
  selectedUsers,
  onSelectedUsersChange,
  compareUserIds: _compareUserIds,
  onLegendInteraction: _onLegendInteraction,
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
  const [leftWidth, setLeftWidth] = useState(20);
  const [rightWidth, setRightWidth] = useState(20);
  const isDraggingRef = useRef<"left" | "right" | null>(null);

  const handleMouseDown = useCallback((side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = side;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const container = document.querySelector(".guild-war-analytics-main-grid") as HTMLElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;

    if (isDraggingRef.current === "left") {
      setLeftWidth(Math.max(15, Math.min(40, percent)));
    } else {
      setRightWidth(Math.max(15, Math.min(40, 100 - percent)));
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove as any);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove as any);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <Stack gap={12} className="guild-war-analytics-layout">
      <InfiniCard interactive={false} className="guild-war-analytics-control-panel guild-war-analytics-control-panel--top">
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
      </InfiniCard>

      {mode === "compare" && selectedUsers.length > selectionSoftCap ? (
        <Alert color="infini-warning">{t("analytics.compareSoftCap", { cap: selectionSoftCap, count: selectedUsers.length })}</Alert>
      ) : null}

      {analyticsQueryLoading || analyticsDetailsLoading ? <Loader size="sm" /> : null}
      {analyticsQueryError ? <Alert color="infini-warning">{loadErrorMessage}</Alert> : null}
      {analyticsDetailsError ? <Alert color="infini-warning">{loadErrorMessage}</Alert> : null}

      {!analyticsQueryLoading && !analyticsQueryError && !analyticsDetailsLoading && !analyticsDetailsError ? (
        <div className="guild-war-analytics-main-grid" style={{ gridTemplateColumns: `${leftWidth}% 12px calc(100% - ${leftWidth}% - ${rightWidth}% - 24px) 12px ${rightWidth}%` }}>
          <InfiniCard interactive={false} className="guild-war-analytics-control-panel guild-war-analytics-control-panel--left">
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
                      <span style={{ color: checked ? "var(--infini-color-primary, #3b82f6)" : undefined, fontWeight: checked ? 600 : 400 }}>{option.label}</span>
                    </Group>
                    {checked ? <span style={{ color: "var(--infini-color-primary, #3b82f6)" }}>✓</span> : null}
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
          </InfiniCard>

          <div
            onMouseDown={handleMouseDown("left")}
            style={{
              cursor: "col-resize",
              background: "color-mix(in srgb, var(--infini-color-text, #111827) 12%, transparent)",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              borderRadius: "6px",
              border: "1px solid color-mix(in srgb, var(--infini-color-text, #111827) 10%, transparent)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "color-mix(in srgb, var(--infini-color-primary, #3b82f6) 40%, transparent)";
              e.currentTarget.style.borderColor = "var(--infini-color-primary, #3b82f6)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "color-mix(in srgb, var(--infini-color-text, #111827) 12%, transparent)";
              e.currentTarget.style.borderColor = "color-mix(in srgb, var(--infini-color-text, #111827) 10%, transparent)";
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "center" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
            </div>
          </div>

          <InfiniCard interactive={false} className="guild-war-analytics-chart-card guild-war-analytics-chart-card--center">
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
          </InfiniCard>

          <div
            onMouseDown={handleMouseDown("right")}
            style={{
              cursor: "col-resize",
              background: "color-mix(in srgb, var(--infini-color-text, #111827) 12%, transparent)",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              borderRadius: "6px",
              border: "1px solid color-mix(in srgb, var(--infini-color-text, #111827) 10%, transparent)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "color-mix(in srgb, var(--infini-color-primary, #3b82f6) 40%, transparent)";
              e.currentTarget.style.borderColor = "var(--infini-color-primary, #3b82f6)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "color-mix(in srgb, var(--infini-color-text, #111827) 12%, transparent)";
              e.currentTarget.style.borderColor = "color-mix(in srgb, var(--infini-color-text, #111827) 10%, transparent)";
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "center" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
            </div>
          </div>

          <InfiniCard interactive={false} className="guild-war-analytics-control-panel guild-war-analytics-control-panel--right">
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
                    data={selectableUserIds.map((userId) => ({ value: userId, label: userId }))}
                    maxValues={5}
                    styles={{ pill: { display: "none" } }}
                    renderOption={({ option, checked }) => (
                      <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                        <Group gap={8}>
                          <Avatar size={20} radius="xl" color="infini-primary">{option.label.slice(0, 2).toUpperCase()}</Avatar>
                          <span style={{ color: checked ? "var(--infini-color-primary, #3b82f6)" : undefined, fontWeight: checked ? 600 : 400 }}>{option.label}</span>
                        </Group>
                        {checked ? <span style={{ color: "var(--infini-color-primary, #3b82f6)" }}>✓</span> : null}
                      </Group>
                    )}
                  />
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
                  value={selectedTeams}
                  placeholder={t("analytics.selectTeams")}
                  aria-label="Select teams for analytics"
                  onChange={onSelectedTeamsChange}
                  data={teamOptions.map((name) => ({ value: name, label: name }))}
                />
              ) : null}

              {mode === "rankings" ? (
                <Text c="dimmed" size="sm">
                  {t("analytics.rankingsHint")}
                </Text>
              ) : null}

              <Divider my={4} />

              <Text fw={600}>{t("analytics.normalization")}</Text>
              <Switch
                checked={normEnabled}
                onChange={(event) => onNormEnabledChange(event.currentTarget.checked)}
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
          </InfiniCard>
        </div>
      ) : null}
    </Stack>
  );
}

