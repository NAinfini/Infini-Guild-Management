import type { ReactNode } from "react";
import type { WarHistoryTabController } from "@portal/hooks/guild-war/useWarHistoryTabController";
import type {
  AnalyticsMetricKey,
  HistoryDetailData,
  HistoryMemberStat,
  HistoryMvpSummary,
  HistorySummaryRow,
  HistoryViewMode,
} from "@portal/types/guild-war";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import { WarHistoryTable } from "./WarHistoryTable";
import { WarHistoryDetail } from "./WarHistoryDetail";

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
  historyTotal: number;
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
  historyTotal,
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
    <div className="war-history-shell">
      {heading}

      {/* Both panes are always mounted. `--mobile-*` only decides which one the
          single-column layout reveals below 992px. */}
      <div className={`war-history-workspace war-history-workspace--mobile-${controller.mobileView}`}>
        <div className="war-history-master">
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
            historyTotal={historyTotal}
            activeHistoryId={controller.activeHistoryId}
            highlightRowId={controller.highlightRowId}
            onRowClick={controller.handleSelectHistoryId}
            historyTotalPages={historyTotalPages}
            historyPage={historyPage}
            historyPerPage={historyPerPage}
            onHistoryPageChange={onHistoryPageChange}
            onHistoryPerPageChange={onHistoryPerPageChange}
          />
        </div>

        <WarHistoryDetail
          onBackToList={() => { void controller.showMobileList(); }}
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
          isEditingMemberStats={controller.isEditingMemberStats}
          onBeginEditMemberStats={controller.beginEditMemberStats}
          onCancelEditMemberStats={() => { void controller.cancelEditMemberStats(); }}
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
      </div>
    </div>
  );
}
