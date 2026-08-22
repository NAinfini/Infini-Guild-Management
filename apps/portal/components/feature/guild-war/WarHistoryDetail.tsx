import {
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { DEFAULT_GAME_RULES } from "@guild/shared";
import {
  ArrowLeftIcon,
  ChartBarIcon,
  CodeIcon,
  FlagIcon,
  GemIcon,
  LayoutGridIcon,
  NoteIcon,
  PencilIcon,
  SaveIcon,
  ShieldIcon,
  SwordsIcon,
  TableIcon,
  TargetArrowIcon,
  TrashIcon,
  TrophyIcon,
  UsersIcon,
} from "@portal/components/icons";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import { EmptyState } from "@portal/components/shared/EmptyState";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import { resolveResultTagColor } from "@portal/utils/guild-war";
import { resolveMediaUrl } from "@portal/utils/media";
import { useSiteConfigStore } from "@portal/stores/site-config";
import { flexRender, useReactTable } from "@tanstack/react-table";
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
  detailTable: ReturnType<typeof useReactTable<HistoryMemberStat>>;
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

type ComparisonMetric = {
  id: string;
  label: string;
  own: number;
  enemy: number;
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
  const isMobileMemberLayout = useMediaQuery("(max-width: 767px)") ?? false;

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const detailTitle = historyDetail
    ? `${historyDetail.war_name}${historyDetail.enemy_name ? ` ${t("history.versus")} ${historyDetail.enemy_name}` : ""}`
    : historyDetailTitle;
  const ownLabel = siteName || t("history.compare.us");
  const enemyLabel = historyDetail?.enemy_name ?? t("history.compare.enemy");
  const resultKey = historyDetail?.result ?? null;
  const resultColor = resolveResultTagColor(resultKey);
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

  return (
    <section
      className="war-history-detail-panel"
      aria-label={detailTitle}
      data-testid="war-history-inline-detail"
    >
      <div className="war-history-detail-panel__mobile-nav">
        <Button
          variant="subtle"
          color="gray"
          leftSection={<ArrowLeftIcon size={16} />}
          onClick={onBackToList}
        >
          {t("history.backToList")}
        </Button>
      </div>

      <div className="war-history-detail-panel__body">
        {historyDetailLoading ? (
          <Stack gap={8} className="war-history-detail-panel__loading">
            <Skeleton height={96} />
            <Skeleton height={72} />
            <Skeleton height={220} />
          </Stack>
        ) : null}

        {historyDetailError ? <Alert color="red">{loadErrorMessage}</Alert> : null}

        {!historyDetailLoading && !historyDetailError && !historyDetail ? (
          <div className="whd-placeholder">
            <EmptyState title={t("history.selectRecordHint")} />
          </div>
        ) : null}

        {!historyDetailLoading && !historyDetailError && historyDetail ? (
          <Stack gap={0}>
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
                  <Badge size="sm" color={resultColor} variant="light">
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
                    <Badge color="orange" variant="light" size="sm">
                      {t("history.unsavedChanges")}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Group gap={8} wrap="wrap" className="whd-identity__exports">
                <Button
                  variant="default"
                  onClick={() => onExport("csv")}
                  loading={exportPending}
                  disabled={historyRows.length === 0}
                  aria-label={`${exportCsvLabel}: ${historyDetail.war_name}`}
                  leftSection={<TableIcon className="whd-export-icon" size={15} aria-hidden="true" />}
                >
                  {exportCsvLabel}
                </Button>
                <Button
                  variant="default"
                  onClick={() => onExport("json")}
                  loading={exportPending}
                  disabled={historyRows.length === 0}
                  aria-label={`${exportJsonLabel}: ${historyDetail.war_name}`}
                  leftSection={<CodeIcon className="whd-export-icon" size={15} aria-hidden="true" />}
                >
                  {exportJsonLabel}
                </Button>
              </Group>
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
                  <Stack gap={12}>
                    {historyDetail.teams.map((team) => (
                      <div key={team.id} className="whd-team">
                        <div className="whd-team__name">
                          <Text size="sm" fw={600}>{team.team_name}</Text>
                          {team.notes ? <Text size="xs" c="dimmed">{team.notes}</Text> : null}
                        </div>
                        {team.members.length > 0 ? (
                          <div className="whd-team__chips">
                            {team.members.map((member) => {
                              const label = member.username ?? member.user_id;
                              return (
                                <span
                                  key={member.user_id}
                                  className="whd-chip"
                                  data-role={member.role_tag ?? "none"}
                                >
                                  <Avatar
                                    aria-hidden="true"
                                    className="whd-chip__avatar"
                                    radius="xl"
                                    size={20}
                                    src={member.avatar_media_id ? resolveMediaUrl(member.avatar_media_id) : undefined}
                                  >
                                    {label.slice(0, 2).toUpperCase()}
                                  </Avatar>
                                  <span>{label}</span>
                                  {member.role_tag ? <em>{member.role_tag}</em> : null}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <Text size="xs" c="dimmed">{t("history.emptyTeam")}</Text>
                        )}
                      </div>
                    ))}
                  </Stack>
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
                <Group gap={8} wrap="nowrap">
                  {historyViewMode === "chart" ? (
                    <Select
                      className="whd-data__metric"
                      value={historyChartMetric}
                      onChange={(value) => {
                        if (value) onHistoryChartMetricChange(value);
                      }}
                      data={detailTable
                        .getAllLeafColumns()
                        .filter((column) => !["user_id", "role_tag", "missing"].includes(column.id))
                        .map((column) => ({ value: column.id, label: String(column.columnDef.header ?? column.id) }))}
                      aria-label={t("history.chartMetric")}
                      allowDeselect={false}
                    />
                  ) : null}
                  <SegmentedControl
                    size="xs"
                    value={historyViewMode}
                    onChange={(value) => onHistoryViewModeChange(value as HistoryViewMode)}
                    data={[
                      {
                        value: "table",
                        label: (
                          <span className="whd-view-option">
                            <TableIcon className="whd-view-option__icon" size={14} aria-hidden="true" />
                            {t("history.view.table")}
                          </span>
                        ),
                      },
                      {
                        value: "chart",
                        label: (
                          <span className="whd-view-option">
                            <ChartBarIcon className="whd-view-option__icon" size={14} aria-hidden="true" />
                            {t("history.view.chart")}
                          </span>
                        ),
                      },
                    ]}
                  />
                </Group>
              </div>

              {historyViewMode === "table" ? (
                <>
                  {/* 键盘导航提示只在真的能打字的时候才有意义。 */}
                  {canManage && isEditingMemberStats ? (
                    <Text size="xs" c="dimmed">
                      {t("history.keyboardHint")}
                    </Text>
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
            </section>

            {canManage ? (
              <footer className="whd-actions">
                <div>
                  <Button
                    color="red"
                    variant="subtle"
                    leftSection={<TrashIcon size={15} />}
                    onClick={onDeleteHistory}
                    loading={deleteHistoryPending}
                    /* 编辑期间不给删除入口：手上有未保存的改动时删掉整条记录只会更乱。 */
                    disabled={historyDetailLoading || isEditingMemberStats}
                  >
                    {t("common:action.delete")}
                  </Button>
                </div>
                <Group gap={8} justify="flex-end">
                  {/* 点「编辑」进入编辑态，点「保存改动」写回并退出；没改动时保存等于直接退出。 */}
                  {!isEditingMemberStats ? (
                    <Button
                      variant="default"
                      leftSection={<PencilIcon size={15} />}
                      onClick={onBeginEditMemberStats}
                      disabled={historyDetailLoading || historyRows.length === 0}
                    >
                      {t("history.editMemberData")}
                    </Button>
                  ) : (
                    <>
                      {hasUnsavedMemberChanges ? (
                        <Text size="xs" c="dimmed">{t("history.unsavedChanges")}</Text>
                      ) : null}
                      <Button
                        variant="subtle"
                        onClick={onCancelEditMemberStats}
                        disabled={saveMemberStatsPending}
                      >
                        {t("common:action.cancel")}
                      </Button>
                      <Button
                        leftSection={<SaveIcon size={15} />}
                        onClick={onSaveMemberStats}
                        loading={saveMemberStatsPending}
                        disabled={historyDetailLoading}
                      >
                        {t("history.saveChanges")}
                      </Button>
                    </>
                  )}
                </Group>
              </footer>
            ) : null}
          </Stack>
        ) : null}
      </div>
    </section>
  );
}

function WarHistoryMemberCards({
  detailTable,
  label,
}: {
  detailTable: ReturnType<typeof useReactTable<HistoryMemberStat>>;
  label: string;
}) {
  const headersByColumnId = new Map(
    detailTable.getFlatHeaders().map((header) => [header.column.id, header]),
  );

  return (
    <div className="whd-member-cards" role="list" aria-label={label}>
      {detailTable.getRowModel().rows.map((row) => (
        <article
          key={row.id}
          className="whd-member-card"
          role="listitem"
          data-testid={`war-history-member-card-${row.original.user_id}`}
        >
          <dl className="whd-member-card__fields">
            {row.getVisibleCells().map((cell) => {
              const header = headersByColumnId.get(cell.column.id);
              return (
                <div
                  key={cell.id}
                  className="whd-member-card__field"
                  data-column-id={cell.column.id}
                >
                  <dt className="whd-member-card__label">
                    {header && !header.isPlaceholder
                      ? flexRender(header.column.columnDef.header, header.getContext())
                      : cell.column.id}
                  </dt>
                  <dd className="whd-member-card__value">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </dd>
                </div>
              );
            })}
          </dl>
        </article>
      ))}
    </div>
  );
}

function MetricColumn({
  id,
  label,
  own,
  enemy,
  enemyLabel,
}: ComparisonMetric & { enemyLabel: string }) {
  const margin = own - enemy;
  const outcome = margin > 0 ? "positive" : margin < 0 ? "negative" : "neutral";
  const formattedMargin = margin > 0 ? `+${margin.toLocaleString()}` : margin.toLocaleString();

  return (
    <article className="whd-strip__cell" data-metric={id}>
      <span className="whd-strip__heading">
        <HistoryMetricIcon id={id} />
        <span className="whd-strip__label">{label}</span>
      </span>
      <span className="whd-strip__values">
        <strong className="tabular-nums">{own.toLocaleString()}</strong>
        <Tooltip label={enemyLabel}>
          <span className="tabular-nums" tabIndex={0}>/ {enemy.toLocaleString()}</span>
        </Tooltip>
      </span>
      <span className={`whd-strip__margin whd-strip__margin--${outcome} tabular-nums`}>
        {formattedMargin}
      </span>
    </article>
  );
}

function HistoryMetricIcon({ id }: { id: string }) {
  const props = { className: "whd-strip__icon", size: 15, "aria-hidden": true } as const;

  if (id === "kills") return <SwordsIcon {...props} />;
  if (id === "towers") return <FlagIcon {...props} />;
  if (id === "base_hp") return <ShieldIcon {...props} />;
  if (id === "credits") return <GemIcon {...props} />;
  return <TargetArrowIcon {...props} />;
}

function MvpRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="whd-mvp__row">
      <span className="whd-mvp__label">{label}</span>
      <span className="whd-mvp__value">{value}</span>
    </div>
  );
}
