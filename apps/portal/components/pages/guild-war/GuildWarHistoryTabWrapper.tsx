import { Card, Group, Skeleton, Stack } from "@mantine/core";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { hashToPaletteColor, getMetricLabelKey, metricValueOrNullFromWarMember } from "../../../hooks/guild-war/useGuildWarAnalytics";
import type { useGuildWarHistory } from "../../../hooks/guild-war/useGuildWarHistory";
import type { useGuildWarMutations } from "../../../hooks/guild-war/useGuildWarMutations";
import type { useGuildWarData } from "../../../hooks/data/useGuildWarData";
import type { HistoryViewMode } from "../../../stores/guildWar";
import type { EChartsThemeConfig } from "../../../theme/echarts";

const LazyWarHistoryTab = lazy(() =>
  import("../../feature/guild-war/WarHistoryTab").then((mod) => ({ default: mod.WarHistoryTab })),
);

type GuildWarHistoryTabWrapperProps = {
  canManageActive: boolean;
  historyViewMode: HistoryViewMode;
  setHistoryViewMode: (mode: HistoryViewMode) => void;
  historyChartMetric: string;
  setHistoryChartMetric: (metric: string) => void;
  historyDateFrom: string;
  setHistoryDateFrom: (date: string) => void;
  historyDateTo: string;
  setHistoryDateTo: (date: string) => void;
  historyPage: number;
  setHistoryPage: (page: number) => void;
  historyPerPage: number;
  setHistoryPerPage: (perPage: number) => void;
  setSelectedHistoryId: (id: string) => void;
  guildWarHistory: ReturnType<typeof useGuildWarHistory>;
  guildWarMutations: ReturnType<typeof useGuildWarMutations>;
  historyQuery: ReturnType<typeof useGuildWarData>["historyQuery"];
  historyDetailQuery: ReturnType<typeof useGuildWarData>["historyDetailQuery"];
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
  chartPalette: string[];
  initialSearch?: string;
};

export function GuildWarHistoryTabWrapper({
  canManageActive,
  historyViewMode,
  setHistoryViewMode,
  historyChartMetric,
  setHistoryChartMetric,
  historyDateFrom,
  setHistoryDateFrom,
  historyDateTo,
  setHistoryDateTo,
  historyPage,
  setHistoryPage,
  historyPerPage,
  setHistoryPerPage,
  setSelectedHistoryId,
  guildWarHistory,
  guildWarMutations,
  historyQuery,
  historyDetailQuery,
  chartThemeName,
  chartThemeConfig,
  chartPalette,
  initialSearch,
}: GuildWarHistoryTabWrapperProps) {
  const { t } = useTranslation("guild-war");

  return (
    <Suspense
      fallback={
        <Card>
          <Stack gap={10} p="md">
            <Group gap={8}><Skeleton height={28} width="25%" /><Skeleton height={28} width="25%" /></Group>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}
          </Stack>
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
        canManage={canManageActive}
        historyLoading={historyQuery.isLoading}
        historyError={historyQuery.isError}
        historyRows={historyQuery.data?.data ?? []}
        historyTotalPages={historyQuery.data?.total_pages ?? 1}
        historyPage={historyPage}
        historyPerPage={historyPerPage}
        onHistoryPageChange={setHistoryPage}
        onHistoryPerPageChange={setHistoryPerPage}
        historyColumns={guildWarHistory.historyColumns}
        onSelectHistoryId={setSelectedHistoryId}
        historyDetailLoading={historyDetailQuery.isLoading}
        historyDetailError={historyDetailQuery.isError}
        historyDetail={historyDetailQuery.data ?? null}
        historyMvp={guildWarHistory.historyMvp}
        historyMissingSlotsByUserId={guildWarHistory.historyMissingSlotsByUserId}
        onSaveMemberStats={guildWarMutations.saveHistoryMemberStats}
        saveMemberStatsPending={guildWarMutations.updateMemberStatsMutation.isPending}
        onDeleteHistory={(id) => guildWarMutations.deleteHistoryMutation.mutate(id)}
        deleteHistoryPending={guildWarMutations.deleteHistoryMutation.isPending}
        onBulkDeleteHistory={(ids) => guildWarMutations.batchDeleteHistoryMutation.mutate(ids)}
        bulkDeleteHistoryPending={guildWarMutations.batchDeleteHistoryMutation.isPending}
        historyDetailTitle={t("history.detail")}
        loadErrorMessage={t("common:loadError")}
        chartThemeName={chartThemeName}
        chartThemeConfig={chartThemeConfig}
        chartPalette={chartPalette}
        hashToPaletteColor={hashToPaletteColor}
        getMetricLabel={(metric) => t(getMetricLabelKey(metric))}
        metricValueOrNullFromWarMember={metricValueOrNullFromWarMember}
        initialSearch={initialSearch}
      />
    </Suspense>
  );
}
