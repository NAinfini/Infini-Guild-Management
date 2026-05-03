import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { CrownOutlined, ShieldOutlined, SwordsOutlined, TargetOutlined } from "@portal/utils/icons";
import { InfiniTable, useReactTable } from "@portal/components/shared/InfiniTable";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { CompareBar } from "../../shared/CompareBar";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import type {
  AnalyticsMetricKey,
  HistoryDetailData,
  HistoryMemberStat,
  HistoryMvpSummary,
  HistoryViewMode,
} from "./WarHistoryTab";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

function resolveResultTagColor(result: string | null | undefined): string {
  const normalized = (result ?? "").toLowerCase();
  if (normalized.includes("win") || normalized.includes("胜")) return "green";
  if (normalized.includes("loss") || normalized.includes("lose") || normalized.includes("负")) return "red";
  if (normalized.includes("draw") || normalized.includes("平")) return "blue";
  return "gray";
}

type WarHistoryDetailProps = {
  opened: boolean;
  onClose: () => void;
  historyDetail: HistoryDetailData | null;
  historyDetailTitle: string;
  historyDetailLoading: boolean;
  historyDetailError: boolean;
  loadErrorMessage: string;
  historyResultLabel: string;
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
  historyResultLabel,
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

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={historyDetail ? `${historyDetail.war_name}${historyDetail.enemy_name ? ` ${t("history.versus")} ${historyDetail.enemy_name}` : ""}` : historyDetailTitle}
      size="min(1800px, calc(100vw - 2rem))"
    >
      <Stack gap={16}>
        {historyDetailLoading ? <Stack gap={8}><Skeleton height={20} width="40%" />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={16} />)}</Stack> : null}
        {historyDetailError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}
        {!historyDetailLoading && !historyDetailError && historyDetail ? (
          <Stack gap={16}>
            <div className="war-history-detail-header">
              <div>
                <Text fw={700} className="war-history-detail-title">{historyDetail.war_name}</Text>
                {historyDetail.enemy_name ? (
                  <Text size="sm" c="dimmed" style={{ marginTop: 2 }}>{t("history.versus")} {historyDetail.enemy_name}</Text>
                ) : null}
                <Text style={{ display: "block", marginTop: 4 }}>
                  {historyResultLabel}: <strong>{historyDetail.result ?? "-"}</strong>
                </Text>
                <div className="war-history-detail-meta">
                  <Text c="dimmed" size="sm">{t("history.membersCount", { count: historyDetail.member_stats.length })}</Text>
                  <Text c="dimmed" size="sm">{t("history.teamsCount", { count: historyDetail.teams.length })}</Text>
                  <Text c="dimmed" size="sm">{t("history.notesLine", { notes: historyDetail.notes ?? "-" })}</Text>
                </div>
              </div>
              <Badge color={resolveResultTagColor(historyDetail.result)}>{historyDetail.result ?? t("history.unknownResult")}</Badge>
            </div>

            <div className="war-history-compare-header">
              <span className="war-history-compare-team war-history-compare-team--us">{t("history.compare.us")}</span>
              <SwordsOutlined size={14} />
              <span className="war-history-compare-team war-history-compare-team--enemy">
                {historyDetail.enemy_name ?? t("history.compare.enemy")}
              </span>
            </div>

            <div className="war-history-compare-section">
              <CompareBar
                classPrefix="war-history-compare-"
                icon={<TargetOutlined size={13} />}
                label={t("history.kills")}
                own={historyDetail.own_kills ?? 0}
                enemy={historyDetail.enemy_kills ?? 0}
              />
              <CompareBar
                classPrefix="war-history-compare-"
                icon={<ShieldOutlined size={13} />}
                label={t("history.towers")}
                own={historyDetail.own_towers ?? 0}
                enemy={historyDetail.enemy_towers ?? 0}
              />
              <CompareBar
                classPrefix="war-history-compare-"
                icon={<ShieldOutlined size={13} />}
                label={t("history.baseHp")}
                own={historyDetail.own_base_hp ?? 0}
                enemy={historyDetail.enemy_base_hp ?? 0}
              />
              <CompareBar
                classPrefix="war-history-compare-"
                icon={<TargetOutlined size={13} />}
                label={t("history.distance")}
                own={historyDetail.own_distance ?? 0}
                enemy={historyDetail.enemy_distance ?? 0}
              />
              <CompareBar
                classPrefix="war-history-compare-"
                icon={<CrownOutlined size={13} />}
                label={t("history.credits")}
                own={historyDetail.own_credits ?? 0}
                enemy={historyDetail.enemy_credits ?? 0}
              />
            </div>

            {historyMvp ? (
              <PortalCard interactive={false} className="war-history-mvp-card">
                <div style={{ padding: "1.2rem" }}>
                  <Stack gap={4}>
                    <Text fw={600}>{t("history.mvpHighlights")}</Text>
                    <Text>{t("analytics.metric.damage")}: {historyMvp.damage}</Text>
                    <Text>{t("analytics.metric.healing")}: {historyMvp.healing}</Text>
                    <Text>{t("analytics.metric.buildingDamage")}: {historyMvp.building}</Text>
                    <Text>{t("analytics.metric.damageTaken")}: {historyMvp.damageTaken}</Text>
                  </Stack>
                </div>
              </PortalCard>
            ) : null}

            {historyDetail.teams.length > 0 ? (
              <PortalCard interactive={false} className="war-history-teams-card">
                <div style={{ padding: "1.2rem" }}>
                  <Stack gap={8} className="war-history-team-stack">
                    <Text fw={600}>{t("history.teamSnapshot")}</Text>
                    {historyDetail.teams.map((team) => (
                      <PortalCard key={team.id} interactive={false} className="war-history-team-card">
                        <div style={{ padding: "1.2rem" }}>
                          <Stack gap={4}>
                            <Text fw={600}>{team.team_name}</Text>
                            <Text c="dimmed" size="sm">{team.notes ?? t("history.noTeamNotes")}</Text>
                            <Text>
                              {team.members
                                .map((member) => `${member.username ?? member.user_id}${member.role_tag ? ` [${member.role_tag}]` : ""}`)
                                .join(", ") || "-"}
                            </Text>
                          </Stack>
                        </div>
                      </PortalCard>
                    ))}
                  </Stack>
                </div>
              </PortalCard>
            ) : null}

            {historyViewMode === "table" ? (
              <div className="war-history-detail-table-wrap">
                <InfiniTable table={detailTable} />
              </div>
            ) : (
              <PortalCard interactive={false} className="war-history-chart-card">
                <div style={{ padding: "1.2rem" }}>
                  <Stack gap={8}>
                    <Text fw={600}>{t("history.chartTitle", { metric: getMetricLabel(historyChartMetric) })}</Text>
                    <ReactEChartsCore
                      echarts={echarts}
                      theme={chartThemeName}
                      style={{ width: "100%", height: 420 }}
                      option={{
                        tooltip: { trigger: "axis" },
                        xAxis: { type: "value" },
                        yAxis: {
                          type: "category",
                          data: historyDetail.member_stats.map((item) => item.username ?? item.user_id),
                        },
                        series: [
                          {
                            type: "bar",
                            name: getMetricLabel(historyChartMetric),
                            data: historyDetail.member_stats.map((item) => ({
                              value: metricValueOrNullFromWarMember(item, historyChartMetric),
                              itemStyle: { color: hashToPaletteColor(item.user_id, chartPalette) },
                            })),
                          },
                        ],
                      }}
                    />
                  </Stack>
                </div>
              </PortalCard>
            )}

            <Group justify="flex-end" gap={8}>
              {canManage ? (
                <Button
                  color="red"
                  variant="default"
                  size="sm"
                  onClick={onDeleteHistory}
                  loading={deleteHistoryPending}
                  disabled={historyDetailLoading}
                >
                  {t("common:action.delete")}
                </Button>
              ) : null}
              {canManage ? (
                <DepthButton
                  type="primary"
                  onClick={onSaveMemberStats}
                  loading={saveMemberStatsPending}
                  disabled={!hasUnsavedMemberChanges || historyDetailLoading}
                  className={hasUnsavedMemberChanges ? "war-history-save-button--ready" : undefined}
                >
                  {t("history.saveChanges")}
                </DepthButton>
              ) : null}
              <DepthButton type="primary" onClick={() => onExport("csv")} loading={exportPending} disabled={historyRows.length === 0}>
                {exportCsvLabel}
              </DepthButton>
              <DepthButton type="primary" onClick={() => onExport("json")} loading={exportPending} disabled={historyRows.length === 0}>
                {exportJsonLabel}
              </DepthButton>
            </Group>
          </Stack>
        ) : null}
      </Stack>
    </Modal>
  );
}
