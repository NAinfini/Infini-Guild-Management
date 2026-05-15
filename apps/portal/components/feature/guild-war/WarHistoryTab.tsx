import {
  Badge,
  Checkbox,
  Group,
  HoverCard,
  NumberInput,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { CircleCheckIcon, AlertTriangleIcon } from "@portal/components/icons";
import { modals } from "@mantine/modals";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@portal/components/shared/InfiniTable";
import type { ColumnDef, SortingState } from "@portal/components/shared/InfiniTable";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { activeGame } from "@guild/shared/games";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import { WarHistoryTable } from "./WarHistoryTable";
import { WarHistoryDetail } from "./WarHistoryDetail";


export type HistoryViewMode = "table" | "chart";
export type AnalyticsMetricKey = string;
type EditableMetricKey = string;
type MemberStatDraft = Record<string, number>;
const EDITABLE_METRIC_KEYS: string[] = activeGame.war.memberStats.map((s) => s.key);

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

function toDraftMetricValue(value: string | number | null | undefined): number {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.floor(numericValue));
}

function createMemberDraft(row: HistoryMemberStat): MemberStatDraft {
  return {
    kills: toDraftMetricValue(row.stats?.kills),
    deaths: toDraftMetricValue(row.stats?.deaths),
    assists: toDraftMetricValue(row.stats?.assists),
    damage: toDraftMetricValue(row.stats?.damage),
    healing: toDraftMetricValue(row.stats?.healing),
    building_damage: toDraftMetricValue(row.stats?.building_damage),
    credits: toDraftMetricValue(row.stats?.credits),
    damage_taken: toDraftMetricValue(row.stats?.damage_taken),
  };
}

function createDraftMap(rows: HistoryMemberStat[]): Record<string, MemberStatDraft> {
  const draftMap: Record<string, MemberStatDraft> = {};
  for (const row of rows) {
    draftMap[row.user_id] = createMemberDraft(row);
  }
  return draftMap;
}

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
  historyColumns: ColumnDef<HistorySummaryRow, unknown>[];
  onSelectHistoryId: (historyId: string) => void;
  historyDetailLoading: boolean;
  historyDetailError: boolean;
  historyDetail: HistoryDetailData | null;
  historyMvp: HistoryMvpSummary | null;
  historyMissingSlotsByUserId: Map<string, number>;
  onSaveMemberStats: (updates: HistoryMemberStatsUpdate[]) => Promise<void>;
  saveMemberStatsPending: boolean;
  onDeleteHistory: (historyId: string) => void;
  deleteHistoryPending: boolean;
  onBulkDeleteHistory: (ids: string[]) => void;
  bulkDeleteHistoryPending: boolean;
  historyDetailTitle: string;
  loadErrorMessage: string;
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
  chartPalette: string[];
  hashToPaletteColor: (value: string, palette: string[]) => string;
  getMetricLabel: (metric: AnalyticsMetricKey) => string;
  metricValueOrNullFromWarMember: (row: HistoryMemberStat, metric: AnalyticsMetricKey) => number | null;
  initialSearch?: string;
};

export function WarHistoryTab({
  heading,
  historyViewMode,
  onHistoryViewModeChange: _onHistoryViewModeChange,
  historyChartMetric,
  onHistoryChartMetricChange: _onHistoryChartMetricChange,
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
  historyColumns,
  onSelectHistoryId,
  historyDetailLoading,
  historyDetailError,
  historyDetail,
  historyMvp,
  historyMissingSlotsByUserId: _historyMissingSlotsByUserId,
  onSaveMemberStats,
  saveMemberStatsPending,
  onDeleteHistory,
  deleteHistoryPending,
  onBulkDeleteHistory,
  bulkDeleteHistoryPending,
  historyDetailTitle,
  loadErrorMessage,
  chartThemeName,
  chartThemeConfig,
  chartPalette,
  hashToPaletteColor,
  getMetricLabel,
  metricValueOrNullFromWarMember,
  initialSearch,
}: WarHistoryTabProps) {
  const { t } = useTranslation("guild-war");
  const [historySearch, setHistorySearch] = useState(initialSearch ?? "");
  const [detailModalOpen, detailModalHandlers] = useDisclosure(false);
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);
  const [summarySorting, setSummarySorting] = useState<SortingState>([]);
  const [detailSorting, setDetailSorting] = useState<SortingState>([]);
  const [memberStatsBaseline, setMemberStatsBaseline] = useState<Record<string, MemberStatDraft>>({});
  const [memberStatsDraft, setMemberStatsDraft] = useState<Record<string, MemberStatDraft>>({});
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedHistoryIds(new Set());
  }, [historyPage, historyPerPage]);

  useEffect(() => {
    setHistorySearch(initialSearch ?? "");
  }, [initialSearch]);

  useEffect(() => {
    if (initialSearch) {
      const matchingRow = historyRows.find((row) => row.war_name === initialSearch);
      if (matchingRow) {
        setHighlightRowId(matchingRow.id);
        setTimeout(() => setHighlightRowId(null), 1200);
      }
    }
  }, [initialSearch, historyRows]);

  const historyDetailId = historyDetail?.id ?? null;
  useEffect(() => {
    if (!detailModalOpen || !historyDetail) {
      return;
    }

    const nextBaseline = createDraftMap(historyDetail.member_stats);
    setMemberStatsBaseline(nextBaseline);
    const nextDraft: Record<string, MemberStatDraft> = {};
    for (const [userId, draft] of Object.entries(nextBaseline)) {
      nextDraft[userId] = { ...draft };
    }
    setMemberStatsDraft(nextDraft);
  }, [detailModalOpen, historyDetailId]);

  const filteredHistoryRows = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    if (!keyword) return historyRows;
    return historyRows.filter((row) => (
      row.war_name.toLowerCase().includes(keyword)
      || (row.enemy_name ?? "").toLowerCase().includes(keyword)
      || (row.result ?? "").toLowerCase().includes(keyword)
      || row.created_at.toLowerCase().includes(keyword)
      || String(row.own_stats?.kills ?? "").includes(keyword)
      || String(row.enemy_stats?.kills ?? "").includes(keyword)
    ));
  }, [historyRows, historySearch]);

  const pendingMemberStatUpdates = useMemo<HistoryMemberStatsUpdate[]>(() => {
    if (!canManage || !historyDetail) {
      return [];
    }

    const updates: HistoryMemberStatsUpdate[] = [];
    for (const row of historyDetail.member_stats) {
      const draft = memberStatsDraft[row.user_id];
      const baseline = memberStatsBaseline[row.user_id];
      if (!draft || !baseline) {
        continue;
      }

      const payload: Partial<Record<EditableMetricKey, number>> = {};
      for (const key of EDITABLE_METRIC_KEYS) {
        if (draft[key] !== baseline[key]) {
          payload[key] = draft[key];
        }
      }

      if (Object.keys(payload).length > 0) {
        updates.push({
          userId: row.user_id,
          payload,
        });
      }
    }

    return updates;
  }, [canManage, historyDetail, memberStatsBaseline, memberStatsDraft]);

  const hasUnsavedMemberChanges = pendingMemberStatUpdates.length > 0;

  const confirmDiscardUnsavedChanges = async (): Promise<boolean> => {
    if (!hasUnsavedMemberChanges) {
      return true;
    }
    return await new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("history.unsavedChanges"),
        children: t("history.unsavedExitConfirm"),
        labels: {
          cancel: t("common:action.cancel"),
          confirm: t("history.discardChanges"),
        },
        confirmProps: { color: "yellow" },
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        closeOnConfirm: true,
        closeOnCancel: true,
        centered: true,
      });
    });
  };

  const requestCloseDetailModal = async () => {
    if (saveMemberStatsPending) {
      return;
    }
    const confirmed = await confirmDiscardUnsavedChanges();
    if (!confirmed) {
      return;
    }
    detailModalHandlers.close();
    setMemberStatsBaseline({});
    setMemberStatsDraft({});
  };

  const handleSaveMemberStats = async () => {
    if (!canManage || pendingMemberStatUpdates.length === 0) {
      return;
    }
    await onSaveMemberStats(pendingMemberStatUpdates);
    const nextBaseline: Record<string, MemberStatDraft> = {};
    for (const [userId, draft] of Object.entries(memberStatsDraft)) {
      nextBaseline[userId] = { ...draft };
    }
    setMemberStatsBaseline(nextBaseline);
  };

  const handleDeleteHistory = async () => {
    if (!canManage || !historyDetail) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("history.deleteConfirmTitle"),
        children: t("history.deleteConfirmDescription", { name: historyDetail.war_name }),
        labels: {
          cancel: t("common:action.cancel"),
          confirm: t("common:action.delete"),
        },
        confirmProps: { color: "red" },
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        closeOnConfirm: true,
        closeOnCancel: true,
        centered: true,
      });
    });
    if (confirmed) {
      onDeleteHistory(historyDetail.id);
      detailModalHandlers.close();
      setMemberStatsBaseline({});
      setMemberStatsDraft({});
    }
  };

  const handleBulkDelete = async () => {
    if (!canManage || selectedHistoryIds.size === 0) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("history.bulkDeleteConfirmTitle"),
        children: t("history.bulkDeleteConfirmDescription", { count: selectedHistoryIds.size }),
        labels: {
          cancel: t("common:action.cancel"),
          confirm: t("common:action.delete"),
        },
        confirmProps: { color: "red" },
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        closeOnConfirm: true,
        closeOnCancel: true,
        centered: true,
      });
    });
    if (confirmed) {
      onBulkDeleteHistory(Array.from(selectedHistoryIds));
      setSelectedHistoryIds(new Set());
    }
  };

  const toggleHistorySelection = (id: string) => {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allFilteredSelected = filteredHistoryRows.length > 0 && filteredHistoryRows.every((row) => selectedHistoryIds.has(row.id));

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedHistoryIds(new Set());
    } else {
      setSelectedHistoryIds(new Set(filteredHistoryRows.map((row) => row.id)));
    }
  }, [allFilteredSelected, filteredHistoryRows]);

  const updateDraftMetric = (userId: string, key: EditableMetricKey, value: string | number) => {
    const nextValue = toDraftMetricValue(value);
    setMemberStatsDraft((current) => {
      const existing = current[userId];
      if (!existing) {
        return current;
      }
      if (existing[key] === nextValue) {
        return current;
      }
      return {
        ...current,
        [userId]: {
          ...existing,
          [key]: nextValue,
        },
      };
    });
  };

  const detailRows = useMemo<HistoryMemberStat[]>(() => {
    if (!historyDetail) {
      return [];
    }
    return historyDetail.member_stats.map((row) => {
      const draft = memberStatsDraft[row.user_id];
      if (!draft) {
        return row;
      }
      return {
        ...row,
        stats: {
          ...row.stats,
          kills: draft.kills,
          deaths: draft.deaths,
          assists: draft.assists,
          damage: draft.damage,
          healing: draft.healing,
          building_damage: draft.building_damage,
          credits: draft.credits,
          damage_taken: draft.damage_taken,
        },
      };
    });
  }, [historyDetail, memberStatsDraft]);

  const handleSelectHistoryId = async (historyId: string) => {
    const confirmed = await confirmDiscardUnsavedChanges();
    if (!confirmed) {
      return;
    }
    onSelectHistoryId(historyId);
    detailModalHandlers.open();
  };

  const summaryColumnsWithSelect = useMemo<ColumnDef<HistorySummaryRow, unknown>[]>(() => {
    if (!canManage) return historyColumns;
    const checkboxColumn: ColumnDef<HistorySummaryRow, unknown> = {
      id: "_select",
      size: 40,
      enableSorting: false,
      header: () => (
        <Checkbox
          size="xs"
          checked={allFilteredSelected}
          indeterminate={selectedHistoryIds.size > 0 && !allFilteredSelected}
          onChange={toggleSelectAll}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          size="xs"
          checked={selectedHistoryIds.has(row.original.id)}
          onChange={() => toggleHistorySelection(row.original.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    };
    return [checkboxColumn, ...historyColumns];
  }, [canManage, historyColumns, allFilteredSelected, selectedHistoryIds, toggleSelectAll]);

  // Summary table
  const summaryTable = useReactTable({
    data: filteredHistoryRows,
    columns: summaryColumnsWithSelect,
    state: { sorting: summarySorting },
    onSortingChange: setSummarySorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  // Detail member stats table columns
  const detailColumns = useMemo<ColumnDef<HistoryMemberStat, unknown>[]>(() => [
    {
      header: t("history.table.user"),
      id: "user_id",
      accessorKey: "user_id",
      cell: ({ row }) => row.original.username ?? row.original.user_id,
    },
    {
      header: t("history.table.role"),
      id: "role_tag",
      accessorFn: (row) => row.role_tag ?? "",
      cell: ({ row }) => row.original.role_tag ?? "-",
    },
    {
      header: t("history.table.kills"),
      id: "kills",
      accessorFn: (row) => row.stats?.kills ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.kills ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "kills", value)}
          />
        ) : (row.original.stats?.kills ?? "-"),
    },
    {
      header: t("history.table.deaths"),
      id: "deaths",
      accessorFn: (row) => row.stats?.deaths ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.deaths ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "deaths", value)}
          />
        ) : (row.original.stats?.deaths ?? "-"),
    },
    {
      header: t("history.table.assists"),
      id: "assists",
      accessorFn: (row) => row.stats?.assists ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.assists ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "assists", value)}
          />
        ) : (row.original.stats?.assists ?? "-"),
    },
    {
      header: t("analytics.metric.kda"),
      id: "kda",
      enableSorting: true,
      accessorFn: (row) => {
        const k = row.stats?.kills ?? 0;
        const d = row.stats?.deaths ?? 0;
        const a = row.stats?.assists ?? 0;
        return (k + a) / Math.max(1, d);
      },
      cell: ({ row }) => {
        const k = row.original.stats?.kills ?? 0;
        const d = row.original.stats?.deaths ?? 0;
        const a = row.original.stats?.assists ?? 0;
        return ((k + a) / Math.max(1, d)).toFixed(2);
      },
    },
    {
      header: t("history.table.damage"),
      id: "damage",
      accessorFn: (row) => row.stats?.damage ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.damage ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "damage", value)}
            decimalScale={2}
          />
        ) : (row.original.stats?.damage ?? "-"),
    },
    {
      header: t("history.table.healing"),
      id: "healing",
      accessorFn: (row) => row.stats?.healing ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.healing ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "healing", value)}
            decimalScale={2}
          />
        ) : (row.original.stats?.healing ?? "-"),
    },
    {
      header: t("history.table.building"),
      id: "building_damage",
      accessorFn: (row) => row.stats?.building_damage ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.building_damage ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "building_damage", value)}
            decimalScale={2}
          />
        ) : (row.original.stats?.building_damage ?? "-"),
    },
    {
      header: t("history.table.credits"),
      id: "credits",
      accessorFn: (row) => row.stats?.credits ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.credits ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "credits", value)}
          />
        ) : (row.original.stats?.credits ?? "-"),
    },
    {
      header: t("history.table.damageTaken"),
      id: "damage_taken",
      accessorFn: (row) => row.stats?.damage_taken ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            hideControls
            min={0}
            size="xs"
            value={row.original.stats?.damage_taken ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "damage_taken", value)}
            decimalScale={2}
          />
        ) : (row.original.stats?.damage_taken ?? "-"),
    },
    {
      header: t("history.table.missing"),
      id: "missing",
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original.stats;
        const hasAnyData = s !== null && s !== undefined && Object.values(s).some((v) => v !== null && v !== 0);
        return hasAnyData ? (
          <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
            <HoverCard.Target>
              <Badge data-animate-icon-trigger color="green" style={{ cursor: "default" }}>{t("history.table.complete")}</Badge>
            </HoverCard.Target>
            <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
              <Group gap={10} wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" color="green" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                  <CircleCheckIcon size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={700} lh={1.3} mb={4}>{t("hovercard.statusComplete.title")}</Text>
                  <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.statusComplete.desc")}</Text>
                </div>
              </Group>
            </HoverCard.Dropdown>
          </HoverCard>
        ) : (
          <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
            <HoverCard.Target>
              <Badge data-animate-icon-trigger color="yellow" style={{ cursor: "default" }}>{t("history.table.missing")}</Badge>
            </HoverCard.Target>
            <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
              <Group gap={10} wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" color="yellow" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                  <AlertTriangleIcon size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={700} lh={1.3} mb={4}>{t("hovercard.statusMissing.title")}</Text>
                  <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.statusMissing.desc")}</Text>
                </div>
              </Group>
            </HoverCard.Dropdown>
          </HoverCard>
        );
      },
    },
  ], [t, canManage]);

  const detailTable = useReactTable({
    data: detailRows,
    columns: detailColumns,
    state: { sorting: detailSorting },
    onSortingChange: setDetailSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <Stack gap={12} style={{ width: "100%", alignItems: "stretch" }}>
      {heading}

      <WarHistoryTable
        historyDateFrom={historyDateFrom}
        historyDateTo={historyDateTo}
        onHistoryDateFromChange={onHistoryDateFromChange}
        onHistoryDateToChange={onHistoryDateToChange}
        onClearDates={onClearDates}
        historySearch={historySearch}
        onHistorySearchChange={setHistorySearch}
        historyLoading={historyLoading}
        historyError={historyError}
        loadErrorMessage={loadErrorMessage}
        filteredHistoryRows={filteredHistoryRows}
        historyRows={historyRows}
        canManage={canManage}
        selectedHistoryIds={selectedHistoryIds}
        summaryTable={summaryTable}
        highlightRowId={highlightRowId}
        onRowClick={handleSelectHistoryId}
        historyTotalPages={historyTotalPages}
        historyPage={historyPage}
        historyPerPage={historyPerPage}
        onHistoryPageChange={onHistoryPageChange}
        onHistoryPerPageChange={onHistoryPerPageChange}
        bulkDeleteHistoryPending={bulkDeleteHistoryPending}
        onBulkDelete={handleBulkDelete}
      />

      <WarHistoryDetail
        opened={detailModalOpen}
        onClose={() => { void requestCloseDetailModal(); }}
        historyDetail={historyDetail}
        historyDetailTitle={historyDetailTitle}
        historyDetailLoading={historyDetailLoading}
        historyDetailError={historyDetailError}
        loadErrorMessage={loadErrorMessage}
        historyMvp={historyMvp}
        historyViewMode={historyViewMode}
        historyChartMetric={historyChartMetric}
        detailTable={detailTable}
        canManage={canManage}
        hasUnsavedMemberChanges={hasUnsavedMemberChanges}
        saveMemberStatsPending={saveMemberStatsPending}
        deleteHistoryPending={deleteHistoryPending}
        exportPending={exportPending}
        exportCsvLabel={exportCsvLabel}
        exportJsonLabel={exportJsonLabel}
        historyRows={historyRows}
        onSaveMemberStats={handleSaveMemberStats}
        onDeleteHistory={handleDeleteHistory}
        onExport={onExport}
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
