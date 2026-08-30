import { DEFAULT_GAME_RULES } from "@guild/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@portal/components/ui/avatar";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import {
  ChartBarIcon,
  CodeIcon,
  LayoutGridIcon,
  NoteIcon,
  PencilIcon,
  SaveIcon,
  SwordsIcon,
  TableIcon,
  TrashIcon,
  TrophyIcon,
  UsersIcon,
} from "@portal/components/icons";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { resolveMediaUrl } from "@portal/utils/media";
import { useSiteConfigStore } from "@portal/stores/site-config";
import type { DataTableInstance } from "@portal/components/shared/data-table-features";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import type {
  AnalyticsMetricKey,
  HistoryDetailData,
  HistoryMemberStat,
  HistoryMvpSummary,
  HistoryViewMode,
} from "@portal/types/guild-war";
import {
  getGuildWarResultLabel,
  getGuildWarTeamStatLabel,
} from "@portal/utils/game-rules";
import {
  MetricColumn,
  MvpRow,
  WarHistoryMemberCards,
  type ComparisonMetric,
} from "./WarHistoryDetailPrimitives";
import { WarHistoryDetailMobileNavigation } from "./WarHistoryDetailMobileNavigation";
import { WarHistoryDetailState } from "./WarHistoryDetailState";
import { getWarHistoryChartMetricOptions } from "./war-history-detail-helpers";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

type WarHistoryDetailProps = {
  onBackToList: () => void;
  historyDetail: HistoryDetailData | null;
  historyDetailTitle: string;
  historyDetailLoading: boolean;
  historyDetailError: boolean;
  loadErrorMessage: string;
  historyMvp: HistoryMvpSummary | null;
  historyViewMode: HistoryViewMode;
  historyChartMetric: AnalyticsMetricKey;
  detailTable: DataTableInstance<HistoryMemberStat>;
  canManage: boolean;
  hasUnsavedMemberChanges: boolean;
  isEditingMemberStats: boolean;
  onBeginEditMemberStats: () => void;
  onCancelEditMemberStats: () => void;
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
  onBackToList,
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
  isEditingMemberStats,
  onBeginEditMemberStats,
  onCancelEditMemberStats,
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
  const siteName = useSiteConfigStore((state) => state.siteName);
  const gameRules = DEFAULT_GAME_RULES;
  const isMobileMemberLayout = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const detailTitle = historyDetail
    ? `${historyDetail.war_name}${historyDetail.enemy_name ? ` ${t("history.versus")} ${historyDetail.enemy_name}` : ""}`
    : historyDetailTitle;
  const ownLabel = siteName || t("history.compare.us");
  const enemyLabel = historyDetail?.enemy_name ?? t("history.compare.enemy");
  const resultKey = historyDetail?.result ?? null;
  const comparisonMetrics: ComparisonMetric[] = historyDetail
    ? gameRules.guild_war.team_stats.map((definition) => ({
        id: definition.key,
        label: getGuildWarTeamStatLabel(definition.key),
        own: historyDetail.own_stats?.[definition.key] ?? 0,
        enemy: historyDetail.enemy_stats?.[definition.key] ?? 0,
      }))
    : [];
  // The scoreboard headline is explicitly the kills column, not an abstract
  // "score" — the label stays visible so the number never claims to be the
  // thing that decided the war.
  const primaryStat = gameRules.guild_war.team_stats.find((definition) => definition.dashboard === "primary")
    ?? gameRules.guild_war.team_stats[0];
  const headline = comparisonMetrics.find((metric) => metric.id === primaryStat?.key) ?? comparisonMetrics[0] ?? null;
  const chartMetricOptions = getWarHistoryChartMetricOptions(detailTable);

  return (
    <section
      className="war-history-detail-panel"
      aria-label={detailTitle}
      data-testid="war-history-inline-detail"
    >
      <WarHistoryDetailMobileNavigation
        label={t("history.backToList")}
        onBackToList={onBackToList}
      />

      <div className="war-history-detail-panel__body">
        <WarHistoryDetailState
          loading={historyDetailLoading}
          error={historyDetailError}
          errorMessage={loadErrorMessage}
          empty={!historyDetailLoading && !historyDetailError && !historyDetail}
          emptyTitle={t("history.selectRecordHint")}
        />

        {!historyDetailLoading && !historyDetailError && historyDetail ? (
          <div className="whd-content">
            <header
              className={resultKey ? `whd-board whd-board--${resultKey}` : "whd-board"}
              data-testid="war-history-scoreboard"
            >
              <div className="whd-board__side">
                <span className="whd-board__who">{t("history.compare.us")}</span>
                <span className="whd-board__name">{ownLabel}</span>
              </div>

              <div className="whd-board__center">
                <div className="whd-board__score">
                  <span className="whd-board__value tabular-nums">{headline?.own ?? 0}</span>
                  <span className="whd-board__dash" aria-hidden="true">—</span>
                  <span className="whd-board__value whd-board__value--enemy tabular-nums">
                    {headline?.enemy ?? 0}
                  </span>
                </div>
                <div className="whd-board__caption">
                  <span className="whd-board__metric">
                    <SwordsIcon className="whd-board__metric-icon" size={15} aria-hidden="true" />
                    {headline?.label}
                  </span>
                  <Badge
                    className="war-history-result-badge"
                    data-result={resultKey ?? "unknown"}
                    variant="outline"
                  >
                    {historyDetail.result
                      ? getGuildWarResultLabel(historyDetail.result)
                      : t("history.unknownResult")}
                  </Badge>
                </div>
              </div>

              <div className="whd-board__side whd-board__side--enemy">
                <span className="whd-board__who">{t("history.compare.enemy")}</span>
                <span className="whd-board__name">{enemyLabel}</span>
              </div>
            </header>

            <div className="whd-identity">
              <div className="whd-identity__copy">
                <h2 className="whd-identity__title">{historyDetail.war_name}</h2>
                <div className="whd-identity__meta">
                  <span className="whd-identity__meta-item">
                    <UsersIcon className="whd-identity__meta-icon" size={15} aria-hidden="true" />
                    {t("history.membersCount", { count: historyDetail.member_stats.length })}
                  </span>
                  <span className="whd-identity__meta-item">
                    <LayoutGridIcon className="whd-identity__meta-icon" size={15} aria-hidden="true" />
                    {t("history.teamsCount", { count: historyDetail.teams.length })}
                  </span>
                  {historyDetail.notes ? (
                    <span className="whd-identity__meta-item whd-identity__note">
                      <NoteIcon className="whd-identity__meta-icon" size={15} aria-hidden="true" />
                      {historyDetail.notes}
                    </span>
                  ) : null}
                  {hasUnsavedMemberChanges ? (
                    <Badge variant="secondary">
                      {t("history.unsavedChanges")}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="whd-identity__exports">
                <Button
                  variant="outline"
                  onClick={() => onExport("csv")}
                  loading={exportPending}
                  disabled={historyRows.length === 0}
                  aria-label={`${exportCsvLabel}: ${historyDetail.war_name}`}
                >
                  <TableIcon className="whd-export-icon" size={15} aria-hidden="true" data-icon="inline-start" />
                  {exportCsvLabel}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onExport("json")}
                  loading={exportPending}
                  disabled={historyRows.length === 0}
                  aria-label={`${exportJsonLabel}: ${historyDetail.war_name}`}
                >
                  <CodeIcon className="whd-export-icon" size={15} aria-hidden="true" data-icon="inline-start" />
                  {exportJsonLabel}
                </Button>
              </div>
            </div>

            <div className="whd-strip" aria-label={t("history.comparison")}>
              {comparisonMetrics.map((metric) => (
                <MetricColumn key={metric.id} {...metric} enemyLabel={enemyLabel} />
              ))}
            </div>

            <div className="whd-split">
              {historyMvp ? (
                <section className="whd-panel">
                  <SectionHeader title={(
                    <span className="whd-section-title whd-section-title--mvp">
                      <TrophyIcon className="whd-section-title__icon" size={16} aria-hidden="true" />
                      {t("history.mvpHighlights")}
                    </span>
                  )} />
                  <div className="whd-mvp">
                    {historyMvp.map((entry) => (
                      <MvpRow key={entry.key} label={entry.label} value={entry.value} />
                    ))}
                  </div>
                </section>
              ) : null}

              {historyDetail.teams.length > 0 ? (
                <section className="whd-panel">
                  <SectionHeader title={(
                    <span className="whd-section-title whd-section-title--team">
                      <UsersIcon className="whd-section-title__icon" size={16} aria-hidden="true" />
                      {t("history.teamSnapshot")}
                    </span>
                  )} />
                  <div className="whd-team-list">
                    {historyDetail.teams.map((team) => (
                      <div key={team.id} className="whd-team">
                        <div className="whd-team__name">
                          <strong>{team.team_name}</strong>
                          {team.notes ? <span>{team.notes}</span> : null}
                        </div>
                        {team.members.length > 0 ? (
                          <div className="whd-team__chips">
                            {team.members.map((member) => {
                              const label = member.display_name ?? member.user_id;
                              return (
                                <span
                                  key={member.user_id}
                                  className="whd-chip"
                                  data-role={member.role_tag ?? "none"}
                                >
                                  <Avatar
                                    aria-hidden="true"
                                    className="whd-chip__avatar"
                                  >
                                    {member.avatar_media_id ? (
                                      <AvatarImage
                                        src={resolveMediaUrl(member.avatar_media_id)}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    ) : null}
                                    <AvatarFallback>{label.slice(0, 2).toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                  <span>{label}</span>
                                  {member.role_tag ? <em>{member.role_tag}</em> : null}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="whd-team__empty">{t("history.emptyTeam")}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <section className="whd-data">
              <div className="whd-data__toolbar">
                <SectionHeader title={(
                  <span className="whd-section-title whd-section-title--data">
                    <ChartBarIcon className="whd-section-title__icon" size={16} aria-hidden="true" />
                    {t("history.memberData")}
                  </span>
                )} />
                <div className="whd-data__controls">
                  {historyViewMode === "chart" ? (
                    <Select
                      value={historyChartMetric}
                      items={chartMetricOptions}
                      onValueChange={(value) => {
                        if (value) onHistoryChartMetricChange(value as AnalyticsMetricKey);
                      }}
                    >
                      <SelectTrigger className="whd-data__metric" aria-label={t("history.chartMetric")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {chartMetricOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <div className="whd-view-switch" role="group" aria-label={t("history.memberData")}>
                    <Button
                      type="button"
                      size="xs"
                      variant={historyViewMode === "table" ? "secondary" : "ghost"}
                      aria-pressed={historyViewMode === "table"}
                      onClick={() => onHistoryViewModeChange("table")}
                    >
                      <TableIcon className="whd-view-option__icon" size={14} aria-hidden="true" data-icon="inline-start" />
                      {t("history.view.table")}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant={historyViewMode === "chart" ? "secondary" : "ghost"}
                      aria-pressed={historyViewMode === "chart"}
                      onClick={() => onHistoryViewModeChange("chart")}
                    >
                      <ChartBarIcon className="whd-view-option__icon" size={14} aria-hidden="true" data-icon="inline-start" />
                      {t("history.view.chart")}
                    </Button>
                  </div>
                </div>
              </div>

              {historyViewMode === "table" ? (
                <>
                  {/* 键盘导航提示只在真的能打字的时候才有意义。 */}
                  {canManage && isEditingMemberStats ? (
                    <p className="whd-keyboard-hint">
                      {t("history.keyboardHint")}
                    </p>
                  ) : null}
                  {isMobileMemberLayout ? (
                    <WarHistoryMemberCards
                      detailTable={detailTable}
                      label={t("history.memberData")}
                    />
                  ) : (
                    <div className="war-history-detail-table-wrap">
                      <DataTableAdapter table={detailTable} />
                    </div>
                  )}
                </>
              ) : (
                <div className="whd-chart-wrap">
                  <ReactEChartsCore
                    echarts={echarts}
                    theme={chartThemeName}
                    style={{
                      width: "100%",
                      height: Math.min(520, Math.max(240, historyDetail.member_stats.length * 32 + 60)),
                    }}
                    option={{
                      tooltip: { trigger: "axis" },
                      grid: { left: 100, right: 20, top: 10, bottom: 30 },
                      xAxis: { type: "value" },
                      yAxis: {
                        type: "category",
                        data: historyDetail.member_stats.map((item) => item.display_name ?? item.user_id),
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
            </section>

            {canManage ? (
              <footer className="whd-actions">
                <div>
                  <Button
                    variant="destructive"
                    onClick={onDeleteHistory}
                    loading={deleteHistoryPending}
                    /* 编辑期间不给删除入口：手上有未保存的改动时删掉整条记录只会更乱。 */
                    disabled={historyDetailLoading || isEditingMemberStats}
                  >
                    <TrashIcon size={15} data-icon="inline-start" />
                    {t("common:action.delete")}
                  </Button>
                </div>
                <div className="whd-actions__controls">
                  {/* 点「编辑」进入编辑态，点「保存改动」写回并退出；没改动时保存等于直接退出。 */}
                  {!isEditingMemberStats ? (
                    <Button
                      variant="outline"
                      onClick={onBeginEditMemberStats}
                      disabled={historyDetailLoading || historyRows.length === 0}
                    >
                      <PencilIcon size={15} data-icon="inline-start" />
                      {t("history.editMemberData")}
                    </Button>
                  ) : (
                    <>
                      {hasUnsavedMemberChanges ? (
                        <span className="whd-actions__status">{t("history.unsavedChanges")}</span>
                      ) : null}
                      <Button
                        variant="ghost"
                        onClick={onCancelEditMemberStats}
                        disabled={saveMemberStatsPending}
                      >
                        {t("common:action.cancel")}
                      </Button>
                      <Button
                        onClick={onSaveMemberStats}
                        loading={saveMemberStatsPending}
                        disabled={historyDetailLoading}
                      >
                        <SaveIcon size={15} data-icon="inline-start" />
                        {t("history.saveChanges")}
                      </Button>
                    </>
                  )}
                </div>
              </footer>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
