import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { hashToPaletteColor, getMetricLabelKey, metricValueOrNullFromWarMember } from "../../../hooks/guild-war/useGuildWarAnalytics";
import type { useGuildWarHistory } from "../../../hooks/guild-war/useGuildWarHistory";
import type { useGuildWarMutations } from "../../../hooks/guild-war/useGuildWarMutations";
import type { useGuildWarData } from "../../../hooks/data/useGuildWarData";
import type { HistoryViewMode } from "../../../stores/guildWar";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import { useWarHistoryTabController } from "../../../hooks/guild-war/useWarHistoryTabController";

const LazyWarHistoryTab = lazy(() =>
  import("../../feature/guild-war/WarHistoryTab").then((mod) => ({ default: mod.WarHistoryTab })),
);

type GuildWarHistoryTabWrapperProps = {
  canManageHistory: boolean;
  historyViewMode: HistoryViewMode;
  setHistoryViewMode: (mode: HistoryViewMode) => void;
  historyChartMetric: string;
  setHistoryChartMetric: (metric: string) => void;
  historyDateFrom: string;
  setHistoryDateFrom: (date: string) => void;
  historyDateTo: string;
  setHistoryDateTo: (date: string) => void;
  historySearch: string;
  setHistorySearch: (search: string) => void;
  historyPage: number;
  setHistoryPage: (page: number) => void;
  historyPerPage: number;
  setHistoryPerPage: (perPage: number) => void;
  setSelectedHistoryId: (id: string) => void;
  guildWarHistory: ReturnType<typeof useGuildWarHistory>;
  guildWarMutations: ReturnType<typeof useGuildWarMutations>;
  historyQuery: ReturnType<typeof useGuildWarData>["historyQuery"];
  historyDetailQuery: ReturnType<typeof useGuildWarData>["historyDetailQuery"];
  historyDetailMissing: boolean;
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
  chartPalette: string[];
  initialSearch?: string;
};

export function GuildWarHistoryTabWrapper({
  canManageHistory,
  historyViewMode,
  setHistoryViewMode,
  historyChartMetric,
  setHistoryChartMetric,
  historyDateFrom,
  setHistoryDateFrom,
  historyDateTo,
  setHistoryDateTo,
  historySearch,
  setHistorySearch,
  historyPage,
  setHistoryPage,
  historyPerPage,
  setHistoryPerPage,
  setSelectedHistoryId,
  guildWarHistory,
  guildWarMutations,
  historyQuery,
  historyDetailQuery,
  historyDetailMissing,
  chartThemeName,
  chartThemeConfig,
  chartPalette,
  initialSearch,
}: GuildWarHistoryTabWrapperProps) {
  const { t } = useTranslation("guild-war");
  const historyRows = historyQuery.data?.data ?? [];
  const historyDetail = historyDetailQuery.data ?? null;
  const controller = useWarHistoryTabController({
    initialSearch,
    historySearch,
    onHistorySearchChange: setHistorySearch,
    historyRows,
    historyPage,
    historyPerPage,
    historyDetail,
    canManage: canManageHistory,
    saveMemberStatsPending: guildWarMutations.updateMemberStatsMutation.isPending,
    onSelectHistoryId: setSelectedHistoryId,
    onSaveMemberStats: guildWarMutations.saveHistoryMemberStats,
    onDeleteHistory: (id) => guildWarMutations.deleteHistoryMutation.mutate(id),
  });

  return (
    <Suspense
      fallback={
        <Card className="gap-2 p-4">
          <div className="flex gap-2"><Skeleton className="h-7 w-1/4" /><Skeleton className="h-7 w-1/4" /></div>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4.5 w-full" />)}
        </Card>
      }
    >
      <LazyWarHistoryTab
        heading={null}
        historyViewMode={historyViewMode}
        onHistoryViewModeChange={setHistoryViewMode}
        historyChartMetric={historyChartMetric}
        onHistoryChartMetricChange={setHistoryChartMetric}
        historyDateFrom={historyDateFrom}
        historyDateTo={historyDateTo}
        onHistoryDateFromChange={setHistoryDateFrom}
        onHistoryDateToChange={setHistoryDateTo}
        onClearDates={() => {
          setHistoryDateFrom("");
          setHistoryDateTo("");
        }}
        onExport={(format) => guildWarMutations.exportHistoryMutation.mutate(format)}
        exportPending={guildWarMutations.exportHistoryMutation.isPending}
        exportCsvLabel={t("history.export.csv")}
        exportJsonLabel={t("history.export.json")}
        canManage={canManageHistory}
        historyLoading={historyQuery.isLoading}
        historyError={historyQuery.isError}
        historyRows={historyRows}
        historyTotal={historyQuery.data?.total ?? 0}
        historyTotalPages={historyQuery.data?.total_pages ?? 1}
        historyPage={historyPage}
        historyPerPage={historyPerPage}
        onHistoryPageChange={setHistoryPage}
        onHistoryPerPageChange={setHistoryPerPage}
        historyDetailLoading={historyDetailQuery.isLoading}
        historyDetailError={historyDetailQuery.isError && !historyDetailMissing}
        historyDetail={historyDetail}
        historyMvp={guildWarHistory.historyMvp}
        saveMemberStatsPending={guildWarMutations.updateMemberStatsMutation.isPending}
        deleteHistoryPending={guildWarMutations.deleteHistoryMutation.isPending}
        historyDetailTitle={t("history.detail")}
        loadErrorMessage={t("common:loadError")}
        chartThemeName={chartThemeName}
        chartThemeConfig={chartThemeConfig}
        chartPalette={chartPalette}
        hashToPaletteColor={hashToPaletteColor}
        getMetricLabel={getMetricLabelKey}
        metricValueOrNullFromWarMember={metricValueOrNullFromWarMember}
        controller={controller}
      />
    </Suspense>
  );
}
