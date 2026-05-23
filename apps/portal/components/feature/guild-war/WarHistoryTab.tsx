import { Stack } from "@mantine/core";
import type { ReactNode } from "react";
import type { WarHistoryTabController } from "@portal/hooks/guild-war/useWarHistoryTabController";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import { WarHistoryTable } from "./WarHistoryTable";
import { WarHistoryDetail } from "./WarHistoryDetail";


export type HistoryViewMode = "table" | "chart";
export type AnalyticsMetricKey = string;

export type HistoryMemberStatsUpdate = {
  userId: string;
  payload: Partial<Record<string, number>>;
};

export type HistorySummaryRow = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  created_at: string;
  own_stats: Record<string, number | null> | null;
  enemy_stats: Record<string, number | null> | null;
};

export type HistoryMemberStat = {
  id: string;
  user_id: string;
  username?: string;
  role_tag: string | null;
  stats: Record<string, number | null> | null;
};

type HistoryDetailTeam = {
  id: string;
  team_name: string;
  notes: string | null;
  members: Array<{
    user_id: string;
    username?: string;
    role_tag: string | null;
  }>;
};

export type HistoryDetailData = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  own_stats: Record<string, number | null> | null;
  enemy_stats: Record<string, number | null> | null;
  notes: string | null;
  member_stats: HistoryMemberStat[];
  teams: HistoryDetailTeam[];
};

export type HistoryMvpSummary = {
  damage: string;
  healing: string;
  building: string;
  damageTaken: string;
};

type WarHistoryTabProps = {
  heading: ReactNode;
  historyViewMode: HistoryViewMode;
  onHistoryViewModeChange: (value: HistoryViewMode) => void;
  historyChartMetric: AnalyticsMetricKey;
  onHistoryChartMetricChange: (value: AnalyticsMetricKey) => void;
  historyDateFrom: string;
  historyDateTo: string;
  onHistoryDateFromChange: (value: string) => void;
  onHistoryDateToChange: (value: string) => void;
  onClearDates: () => void;
  onExport: (format: "csv" | "json") => void;
  exportPending: boolean;
  exportCsvLabel: string;
  exportJsonLabel: string;
  canManage: boolean;
  historyLoading: boolean;
  historyError: boolean;
  historyRows: HistorySummaryRow[];
  historyTotalPages: number;
  historyPage: number;
  historyPerPage: number;
  onHistoryPageChange: (page: number) => void;
  onHistoryPerPageChange: (perPage: number) => void;
  historyDetailLoading: boolean;
  historyDetailError: boolean;
  historyDetail: HistoryDetailData | null;
  historyMvp: HistoryMvpSummary | null;
  saveMemberStatsPending: boolean;
  deleteHistoryPending: boolean;
  bulkDeleteHistoryPending: boolean;
  historyDetailTitle: string;
  loadErrorMessage: string;
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
  chartPalette: string[];
  hashToPaletteColor: (value: string, palette: string[]) => string;
  getMetricLabel: (metric: AnalyticsMetricKey) => string;
  metricValueOrNullFromWarMember: (row: HistoryMemberStat, metric: AnalyticsMetricKey) => number | null;
  controller: WarHistoryTabController;
};

export function WarHistoryTab({
  heading,
  historyViewMode,
  onHistoryViewModeChange,
  historyChartMetric,
  onHistoryChartMetricChange,
  historyDateFrom,
  historyDateTo,
  onHistoryDateFromChange,
  onHistoryDateToChange,
  onClearDates,
  onExport,
  exportPending,
  exportCsvLabel,
  exportJsonLabel,
  canManage,
  historyLoading,
  historyError,
  historyRows,
  historyTotalPages,
  historyPage,
  historyPerPage,
  onHistoryPageChange,
  onHistoryPerPageChange,
  historyDetailLoading,
  historyDetailError,
  historyDetail,
  historyMvp,
  saveMemberStatsPending,
  deleteHistoryPending,
  bulkDeleteHistoryPending,
  historyDetailTitle,
  loadErrorMessage,
  chartThemeName,
  chartThemeConfig,
  chartPalette,
  hashToPaletteColor,
  getMetricLabel,
  metricValueOrNullFromWarMember,
  controller,
}: WarHistoryTabProps) {
  return (
    <Stack gap={12} style={{ width: "100%", alignItems: "stretch" }}>
      {heading}

      <WarHistoryTable
        historyDateFrom={historyDateFrom}
        historyDateTo={historyDateTo}
        onHistoryDateFromChange={onHistoryDateFromChange}
        onHistoryDateToChange={onHistoryDateToChange}
        onClearDates={onClearDates}
        historySearch={controller.historySearch}
        onHistorySearchChange={controller.setHistorySearch}
        historyLoading={historyLoading}
        historyError={historyError}
        loadErrorMessage={loadErrorMessage}
        filteredHistoryRows={controller.filteredHistoryRows}
        historyRows={historyRows}
        canManage={canManage}
        selectedHistoryIds={controller.selectedHistoryIds}
        summaryTable={controller.summaryTable}
        highlightRowId={controller.highlightRowId}
        onRowClick={controller.handleSelectHistoryId}
        historyTotalPages={historyTotalPages}
        historyPage={historyPage}
        historyPerPage={historyPerPage}
        onHistoryPageChange={onHistoryPageChange}
        onHistoryPerPageChange={onHistoryPerPageChange}
        bulkDeleteHistoryPending={bulkDeleteHistoryPending}
        onBulkDelete={controller.handleBulkDelete}
      />

      <WarHistoryDetail
        opened={controller.detailModalOpen}
        onClose={() => { void controller.requestCloseDetailModal(); }}
        historyDetail={historyDetail}
        historyDetailTitle={historyDetailTitle}
        historyDetailLoading={historyDetailLoading}
        historyDetailError={historyDetailError}
        loadErrorMessage={loadErrorMessage}
        historyMvp={historyMvp}
        historyViewMode={historyViewMode}
        historyChartMetric={historyChartMetric}
        detailTable={controller.detailTable}
        canManage={canManage}
        hasUnsavedMemberChanges={controller.hasUnsavedMemberChanges}
        saveMemberStatsPending={saveMemberStatsPending}
        deleteHistoryPending={deleteHistoryPending}
        exportPending={exportPending}
        exportCsvLabel={exportCsvLabel}
        exportJsonLabel={exportJsonLabel}
        historyRows={historyRows}
        onSaveMemberStats={controller.handleSaveMemberStats}
        onDeleteHistory={controller.handleDeleteHistory}
        onExport={onExport}
        onHistoryViewModeChange={onHistoryViewModeChange}
        onHistoryChartMetricChange={onHistoryChartMetricChange}
        chartThemeName={chartThemeName}
        chartThemeConfig={chartThemeConfig}
        chartPalette={chartPalette}
        hashToPaletteColor={hashToPaletteColor}
        getMetricLabel={getMetricLabel}
        metricValueOrNullFromWarMember={metricValueOrNullFromWarMember}
      />
    </Stack>
  );
}
