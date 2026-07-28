import {
  Alert,
  Badge,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { CrownOutlined, ShieldOutlined, SwordsOutlined, TargetOutlined } from "@portal/utils/icons";
import { resolveResultTagColor } from "@portal/utils/guild-war";
import { InfiniTable, useReactTable } from "@portal/components/shared/InfiniTable";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useTranslation } from "react-i18next";
import { useEffect, type ReactNode } from "react";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { CompareBar } from "../../shared/CompareBar";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import type {
  AnalyticsMetricKey,
  HistoryDetailData,
  HistoryMemberStat,
  HistoryMvpSummary,
  HistoryViewMode,
} from "@portal/types/guild-war";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

type WarHistoryDetailProps = {
  opened: boolean;
  onClose: () => void;
  historyDetail: HistoryDetailData | null;
  historyDetailTitle: string;
  historyDetailLoading: boolean;
  historyDetailError: boolean;
  loadErrorMessage: string;
  historyMvp: HistoryMvpSummary | null;
  historyViewMode: HistoryViewMode;
  historyChartMetric: AnalyticsMetricKey;
  detailTable: ReturnType<typeof useReactTable<HistoryMemberStat>>;
  canManage: boolean;
  hasUnsavedMemberChanges: boolean;
  saveMemberStatsPending: boolean;
  deleteHistoryPending: boolean;
  exportPending: boolean;
  exportCsvLabel: string;
  exportJsonLabel: string;
  historyRows: Array<unknown>;
  onSaveMemberStats: () => void;
  onDeleteHistory: () => void;
  onExport: (format: "csv" | "json") => void;
  onHistoryViewModeChange: (value: HistoryViewMode) => void;
  onHistoryChartMetricChange: (value: AnalyticsMetricKey) => void;
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
  chartPalette: string[];
  hashToPaletteColor: (value: string, palette: string[]) => string;
  getMetricLabel: (metric: AnalyticsMetricKey) => string;
  metricValueOrNullFromWarMember: (row: HistoryMemberStat, metric: AnalyticsMetricKey) => number | null;
};

export function WarHistoryDetail({
  opened,
  onClose,
  historyDetail,
  historyDetailTitle,
  historyDetailLoading,
  historyDetailError,
  loadErrorMessage,
  historyMvp,
  historyViewMode,
  historyChartMetric,
  detailTable,
  canManage,
  hasUnsavedMemberChanges,
  saveMemberStatsPending,
  deleteHistoryPending,
  exportPending,
  exportCsvLabel,
  exportJsonLabel,
  historyRows,
  onSaveMemberStats,
  onDeleteHistory,
  onExport,
  onHistoryViewModeChange,
  onHistoryChartMetricChange,
  chartThemeName,
  chartThemeConfig,
  chartPalette,
  hashToPaletteColor,
  getMetricLabel,
  metricValueOrNullFromWarMember,
}: WarHistoryDetailProps) {
  const { t } = useTranslation("guild-war");

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const resultColor = historyDetail ? resolveResultTagColor(historyDetail.result) : "gray";
  const modalTitle = historyDetail
    ? `${historyDetail.war_name}${historyDetail.enemy_name ? ` ${t("history.versus")} ${historyDetail.enemy_name}` : ""}`
    : opened ? historyDetailTitle : undefined;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={modalTitle}
      size="min(1400px, calc(100vw - 2rem))"
    >
      <Stack gap={16}>
        {historyDetailLoading ? <Stack gap={8}><Skeleton height={20} width="40%" />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={16} />)}</Stack> : null}
        {historyDetailError ? <Alert color="red">{loadErrorMessage}</Alert> : null}
        {!historyDetailLoading && !historyDetailError && historyDetail ? (
          <Stack gap={20}>
            {/* Hero header */}
            <div className="whd-hero">
              <div className="whd-hero__main">
                <Badge size="lg" color={resultColor} className="whd-hero__badge">
                  {(historyDetail.result ?? t("history.unknownResult")).toUpperCase()}
                </Badge>
                <div className="whd-hero__info">
                  <Text fw={700} size="lg" className="whd-hero__title">{historyDetail.war_name}</Text>
                  {historyDetail.enemy_name ? (
                    <Text size="sm" c="dimmed">{t("history.versus")} {historyDetail.enemy_name}</Text>
                  ) : null}
                </div>
              </div>
              <div className="whd-hero__meta">
                <span>{t("history.membersCount", { count: historyDetail.member_stats.length })}</span>
                <span className="whd-hero__meta-sep" />
                <span>{t("history.teamsCount", { count: historyDetail.teams.length })}</span>
                {historyDetail.notes ? (
                  <>
                    <span className="whd-hero__meta-sep" />
                    <Tooltip label={historyDetail.notes} multiline maw={300}>
                      <span className="whd-hero__meta-note">{historyDetail.notes}</span>
                    </Tooltip>
                  </>
                ) : null}
              </div>
            </div>

            {/* Compare section */}
            <div className="whd-compare">
              <div className="war-history-compare-header">
                <span className="war-history-compare-team war-history-compare-team--us">{t("history.compare.us")}</span>
                <SwordsOutlined size={14} />
                <span className="war-history-compare-team war-history-compare-team--enemy">
                  {historyDetail.enemy_name ?? t("history.compare.enemy")}
                </span>
              </div>
              <div className="war-history-compare-section">
                <CompareBar classPrefix="war-history-compare-" icon={<TargetOutlined size={13} />} label={t("history.kills")} own={historyDetail.own_stats?.kills ?? 0} enemy={historyDetail.enemy_stats?.kills ?? 0} />
                <CompareBar classPrefix="war-history-compare-" icon={<ShieldOutlined size={13} />} label={t("history.towers")} own={historyDetail.own_stats?.towers ?? 0} enemy={historyDetail.enemy_stats?.towers ?? 0} />
                <CompareBar classPrefix="war-history-compare-" icon={<ShieldOutlined size={13} />} label={t("history.baseHp")} own={historyDetail.own_stats?.base_hp ?? 0} enemy={historyDetail.enemy_stats?.base_hp ?? 0} />
                <CompareBar classPrefix="war-history-compare-" icon={<TargetOutlined size={13} />} label={t("history.distance")} own={historyDetail.own_stats?.distance ?? 0} enemy={historyDetail.enemy_stats?.distance ?? 0} />
                <CompareBar classPrefix="war-history-compare-" icon={<CrownOutlined size={13} />} label={t("history.credits")} own={historyDetail.own_stats?.credits ?? 0} enemy={historyDetail.enemy_stats?.credits ?? 0} />
              </div>
            </div>

            {/* MVP + Team snapshot side by side */}
            <div className="whd-split">
              {historyMvp ? (
                <div className="whd-mvp">
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={8}>{t("history.mvpHighlights")}</Text>
                  <div className="whd-mvp__grid">
                    <MvpEntry icon={<TargetOutlined size={13} />} label={t("analytics.metric.damage")} value={historyMvp.damage} />
                    <MvpEntry icon={<ShieldOutlined size={13} />} label={t("analytics.metric.healing")} value={historyMvp.healing} />
                    <MvpEntry icon={<CrownOutlined size={13} />} label={t("analytics.metric.buildingDamage")} value={historyMvp.building} />
                    <MvpEntry icon={<ShieldOutlined size={13} />} label={t("analytics.metric.damageTaken")} value={historyMvp.damageTaken} />
                  </div>
                </div>
              ) : null}

              {historyDetail.teams.length > 0 ? (
                <div className="whd-teams">
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={8}>{t("history.teamSnapshot")}</Text>
                  <Stack gap={6}>
                    {historyDetail.teams.map((team) => (
                      <div key={team.id} className="whd-team-row">
                        <Text size="sm" fw={600}>{team.team_name}</Text>
                        {team.notes ? <Text size="xs" c="dimmed">{team.notes}</Text> : null}
                        <Text size="xs" c="dimmed">
                          {team.members
                            .map((m) => `${m.username ?? m.user_id}${m.role_tag ? ` [${m.role_tag}]` : ""}`)
                            .join(", ") || "-"}
                        </Text>
                      </div>
                    ))}
                  </Stack>
                </div>
              ) : null}
            </div>

            {/* Stats table or chart */}
            <Group justify="space-between" align="center">
              <SegmentedControl
                value={historyViewMode}
                onChange={(value) => onHistoryViewModeChange(value as HistoryViewMode)}
                data={[
                  { value: "table", label: t("history.view.table") },
                  { value: "chart", label: t("history.view.chart") },
                ]}
              />
              {historyViewMode === "chart" ? (
                <Select
                  value={historyChartMetric}
                  onChange={(value) => {
                    if (value) onHistoryChartMetricChange(value);
                  }}
                  data={detailTable
                    .getAllLeafColumns()
                    .filter((column) => !["user_id", "role_tag", "missing"].includes(column.id))
                    .map((column) => ({ value: column.id, label: String(column.columnDef.header ?? column.id) }))}
                  aria-label={t("history.chartMetric")}
                  style={{ width: 220 }}
                  allowDeselect={false}
                />
              ) : null}
            </Group>
            {historyViewMode === "table" ? (
              <>
                {canManage ? (
                  <Text size="xs" c="dimmed">
                    {t("history.keyboardHint")}
                  </Text>
                ) : null}
                <div className="war-history-detail-table-wrap">
                  <InfiniTable table={detailTable} />
                </div>
              </>
            ) : (
              <div className="whd-chart-wrap">
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={8}>{t("history.chartTitle", { metric: getMetricLabel(historyChartMetric) })}</Text>
                <ReactEChartsCore
                  echarts={echarts}
                  theme={chartThemeName}
                  style={{ width: "100%", height: Math.max(200, historyDetail.member_stats.length * 32 + 60) }}
                  option={{
                    tooltip: { trigger: "axis" },
                    grid: { left: 100, right: 20, top: 10, bottom: 30 },
                    xAxis: { type: "value" },
                    yAxis: {
                      type: "category",
                      data: historyDetail.member_stats.map((item) => item.username ?? item.user_id),
                      axisLabel: { fontSize: 11 },
                    },
                    series: [
                      {
                        type: "bar",
                        name: getMetricLabel(historyChartMetric),
                        barMaxWidth: 20,
                        data: historyDetail.member_stats.map((item) => ({
                          value: metricValueOrNullFromWarMember(item, historyChartMetric),
                          itemStyle: { color: hashToPaletteColor(item.user_id, chartPalette) },
                        })),
                      },
                    ],
                  }}
                />
              </div>
            )}

            {/* Actions footer */}
            <Group justify="flex-end" gap={8} className="whd-actions">
              {canManage ? (
                <DepthButton
                  type="danger"
                  size="xs"
                  onClick={onDeleteHistory}
                  loading={deleteHistoryPending}
                  disabled={historyDetailLoading}
                >
                  {t("common:action.delete")}
                </DepthButton>
              ) : null}
              {canManage ? (
                <DepthButton
                  type="primary"
                  size="xs"
                  onClick={onSaveMemberStats}
                  loading={saveMemberStatsPending}
                  disabled={!hasUnsavedMemberChanges || historyDetailLoading}
                  className={hasUnsavedMemberChanges ? "war-history-save-button--ready" : undefined}
                >
                  {t("history.saveChanges")}
                </DepthButton>
              ) : null}
              <DepthButton type="secondary" size="xs" onClick={() => onExport("csv")} loading={exportPending} disabled={historyRows.length === 0}>
                {exportCsvLabel}
              </DepthButton>
              <DepthButton type="secondary" size="xs" onClick={() => onExport("json")} loading={exportPending} disabled={historyRows.length === 0}>
                {exportJsonLabel}
              </DepthButton>
            </Group>
          </Stack>
        ) : null}
      </Stack>
    </Modal>
  );
}

function MvpEntry({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="whd-mvp__entry">
      <span className="whd-mvp__icon">{icon}</span>
      <div>
        <Text size="xs" c="dimmed" lh={1.2}>{label}</Text>
        <Text size="sm" fw={600} lh={1.2}>{value}</Text>
      </div>
    </div>
  );
}
