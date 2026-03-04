import {
  Alert,
  Avatar,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { useState, useRef, useCallback, useEffect } from "react";
import type { CSSProperties, MouseEvent } from "react";

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
};

const ANALYTICS_METRIC_OPTIONS: Array<{ value: AnalyticsMetricKey; label: string; icon: string }> = [
  { value: "damage", label: "Damage", icon: "⚔️" },
  { value: "healing", label: "Healing", icon: "💚" },
  { value: "building_damage", label: "Building Damage", icon: "🏰" },
  { value: "credits", label: "Credits", icon: "💰" },
  { value: "kills", label: "Kills", icon: "💀" },
  { value: "deaths", label: "Deaths", icon: "☠️" },
  { value: "assists", label: "Assists", icon: "🤝" },
  { value: "damage_taken", label: "Damage Taken", icon: "🛡️" },
  { value: "kda", label: "KDA", icon: "📊" },
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
  focusedUser,
  onFocusedUserChange,
  selectableUserIds,
  onlyParticipated,
  onOnlyParticipatedChange,
  selectedUsers,
  onSelectedUsersChange,
  compareUserIds,
  onLegendInteraction,
  hashToPaletteColor,
  chartPalette,
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
  metricLabel,
  echarts,
  chartThemeName,
  chartOption,
}: GuildWarAnalyticsTabProps) {
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
      <InfiniCard className="guild-war-analytics-control-panel guild-war-analytics-control-panel--top">
        <div style={{ padding: "1.2rem" }}>
        <div className="guild-war-analytics-toolbar">
          <div className="guild-war-analytics-toolbar__row">
            <div className="guild-war-analytics-toolbar__item">
              <div className="guild-war-analytics-toolbar__label">Mode</div>
              <SegmentedControl
                value={mode}
                onChange={(value) => onModeChange(value as AnalyticsMode)}
                data={[
                  { label: "Player", value: "player" },
                  { label: "Rankings", value: "rankings" },
                  { label: "Teams", value: "teams" },
                ]}
              />
            </div>

            <div className="guild-war-analytics-toolbar__item">
              <div className="guild-war-analytics-toolbar__label">Date Preset</div>
              <SegmentedControl
                value={datePreset}
                onChange={(value) => onDatePresetChange(value as AnalyticsDatePreset)}
                data={[
                  { label: "Last 5", value: "5" },
                  { label: "Last 10", value: "10" },
                  { label: "Last 20", value: "20" },
                  { label: "All", value: "all" },
                ]}
              />
            </div>

            <div className="guild-war-analytics-toolbar__item guild-war-analytics-toolbar__item--grow">
              <div className="guild-war-analytics-toolbar__label">War Set</div>
              <MultiSelect
                clearable
                style={{ minWidth: 280 }}
                placeholder="Select wars"
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
        <Alert color="yellow">{`Compare mode soft cap is ${selectionSoftCap}; currently ${selectedUsers.length}.`}</Alert>
      ) : null}

      {analyticsQueryLoading || analyticsDetailsLoading ? <Loader size="sm" /> : null}
      {analyticsQueryError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}
      {analyticsDetailsError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}

      {!analyticsQueryLoading && !analyticsQueryError && !analyticsDetailsLoading && !analyticsDetailsError ? (
        <div className="guild-war-analytics-main-grid" style={{ gridTemplateColumns: `${leftWidth}% 12px calc(100% - ${leftWidth}% - ${rightWidth}% - 24px) 12px ${rightWidth}%` }}>
          <InfiniCard className="guild-war-analytics-control-panel guild-war-analytics-control-panel--left">
            <div style={{ padding: "1.2rem" }}>
            <Stack gap={10}>
              <Text fw={600}>Metrics (up to 5)</Text>
              <MultiSelect
                clearable
                searchable
                placeholder="Select metrics (up to 5)"
                aria-label="Select analytics metrics"
                value={selectedMetrics}
                onChange={(values) => onSelectedMetricsChange(values.slice(0, 5) as AnalyticsMetricKey[])}
                data={ANALYTICS_METRIC_OPTIONS}
                maxValues={5}
                styles={{ pill: { display: "none" } }}
                renderOption={({ option, checked }) => (
                  <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                    <Group gap={8}>
                      <span style={{ fontSize: 16 }}>{(option as typeof ANALYTICS_METRIC_OPTIONS[0]).icon}</span>
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
                      { value: "total", label: "Total" },
                      { value: "average", label: "Average" },
                      { value: "best", label: "Best" },
                      { value: "median", label: "Median" },
                    ]}
                  />
                  <NumberInput
                    min={1}
                    max={20}
                    value={topN}
                    onChange={(value) => onTopNChange(typeof value === "number" ? value : 10)}
                    aria-label="Select rankings top N"
                    label="Top N"
                  />
                  <NumberInput
                    min={1}
                    max={200}
                    value={minParticipation}
                    onChange={(value) => onMinParticipationChange(typeof value === "number" ? value : 1)}
                    aria-label="Select minimum wars participation"
                    label="Min Participation"
                  />
                </>
              ) : null}

              {mode === "teams" ? (
                <SegmentedControl
                  value={teamAggregation}
                  onChange={(value) => onTeamAggregationChange(value as "total" | "average")}
                  data={[
                    { value: "total", label: "Total" },
                    { value: "average", label: "Average" },
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

          <InfiniCard className="guild-war-analytics-chart-card guild-war-analytics-chart-card--center">
            <div style={{ padding: "1.2rem" }}>
            <Stack gap={8}>
              <Text fw={600}>Chart</Text>
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

          <InfiniCard className="guild-war-analytics-control-panel guild-war-analytics-control-panel--right">
            <div style={{ padding: "1.2rem" }}>
            <Stack gap={10}>
              <Text fw={600}>Selection & Actions</Text>

              {mode === "player" ? (
                <>
                  <MultiSelect
                    clearable
                    searchable
                    placeholder="Select members (up to 5)"
                    aria-label="Select player analytics members"
                    value={selectedUsers}
                    onChange={(values) => onSelectedUsersChange(values.slice(0, 5))}
                    data={selectableUserIds.map((userId) => ({ value: userId, label: userId }))}
                    maxValues={5}
                    styles={{ pill: { display: "none" } }}
                    renderOption={({ option, checked }) => (
                      <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
                        <Group gap={8}>
                          <Avatar size={20} radius="xl" color="blue">{option.label.slice(0, 2).toUpperCase()}</Avatar>
                          <span style={{ color: checked ? "var(--infini-color-primary, #3b82f6)" : undefined, fontWeight: checked ? 600 : 400 }}>{option.label}</span>
                        </Group>
                        {checked ? <span style={{ color: "var(--infini-color-primary, #3b82f6)" }}>✓</span> : null}
                      </Group>
                    )}
                  />
                  <Checkbox
                    checked={onlyParticipated}
                    onChange={(event) => onOnlyParticipatedChange(event.currentTarget.checked)}
                    label="Only wars where player participated"
                  />
                </>
              ) : null}

              {mode === "teams" ? (
                <MultiSelect
                  clearable
                  value={selectedTeams}
                  placeholder="Select teams"
                  aria-label="Select teams for analytics"
                  onChange={onSelectedTeamsChange}
                  data={teamOptions.map((name) => ({ value: name, label: name }))}
                />
              ) : null}

              {mode === "rankings" ? (
                <Text c="dimmed" size="sm">
                  Rankings use current filter scope and participation thresholds.
                </Text>
              ) : null}
            </Stack>
            </div>
          </InfiniCard>
        </div>
      ) : null}
    </Stack>
  );
}
