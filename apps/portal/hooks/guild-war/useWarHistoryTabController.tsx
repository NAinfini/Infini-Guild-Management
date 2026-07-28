import { Checkbox, Badge, Group, HoverCard, Text, ThemeIcon } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { activeGame } from "@guild/shared/games";
import { CircleCheckIcon, AlertTriangleIcon } from "@portal/components/icons";
import { MetricGridInput } from "@portal/components/shared/MetricGridInput";
import { useConfirmDialog } from "@portal/components/shared/ConfirmDialog";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@portal/components/shared/InfiniTable";
import type { ColumnDef, SortingState } from "@portal/components/shared/InfiniTable";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  HistoryDetailData,
  HistoryMemberStat,
  HistoryMemberStatsUpdate,
  HistorySummaryRow,
} from "@portal/types/guild-war";

type EditableMetricKey = string;
type MemberStatDraft = Record<string, number>;

const EDITABLE_METRIC_KEYS: string[] = activeGame.war.memberStats.map((stat) => stat.key);

export function toDraftMetricValue(value: string | number | null | undefined): number {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, numericValue);
}

function createMemberDraft(row: HistoryMemberStat): MemberStatDraft {
  return Object.fromEntries(
    EDITABLE_METRIC_KEYS.map((key) => [key, toDraftMetricValue(row.stats?.[key])]),
  );
}

function createDraftMap(rows: HistoryMemberStat[]): Record<string, MemberStatDraft> {
  const draftMap: Record<string, MemberStatDraft> = {};
  for (const row of rows) {
    draftMap[row.user_id] = createMemberDraft(row);
  }
  return draftMap;
}

type UseWarHistoryTabControllerParams = {
  initialSearch?: string;
  historySearch: string;
  onHistorySearchChange: (search: string) => void;
  historyRows: HistorySummaryRow[];
  historyPage: number;
  historyPerPage: number;
  historyColumns: ColumnDef<HistorySummaryRow, unknown>[];
  historyDetail: HistoryDetailData | null;
  canManage: boolean;
  saveMemberStatsPending: boolean;
  onSelectHistoryId: (historyId: string) => void;
  onSaveMemberStats: (updates: HistoryMemberStatsUpdate[]) => Promise<void>;
  onDeleteHistory: (historyId: string) => void;
  onBulkDeleteHistory: (ids: string[]) => void;
};

export function useWarHistoryTabController({
  initialSearch,
  historySearch,
  onHistorySearchChange,
  historyRows,
  historyColumns,
  historyDetail,
  canManage,
  saveMemberStatsPending,
  onSelectHistoryId,
  onSaveMemberStats,
  onDeleteHistory,
  onBulkDeleteHistory,
}: UseWarHistoryTabControllerParams) {
  const { t } = useTranslation("guild-war");
  const confirm = useConfirmDialog();
  const [detailModalOpen, detailModalHandlers] = useDisclosure(false);
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);
  const [summarySorting, setSummarySorting] = useState<SortingState>([]);
  const [detailSorting, setDetailSorting] = useState<SortingState>([]);
  const [memberStatsBaseline, setMemberStatsBaseline] = useState<Record<string, MemberStatDraft>>({});
  const [memberStatsDraft, setMemberStatsDraft] = useState<Record<string, MemberStatDraft>>({});
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!initialSearch) {
      return;
    }
    const matchingRow = historyRows.find((row) => row.war_name === initialSearch);
    if (matchingRow) {
      setHighlightRowId(matchingRow.id);
      const timeoutId = window.setTimeout(() => setHighlightRowId(null), 1200);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
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
  }, [detailModalOpen, historyDetail, historyDetailId]);

  const filteredHistoryRows = historyRows;

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
        updates.push({ userId: row.user_id, payload });
      }
    }

    return updates;
  }, [canManage, historyDetail, memberStatsBaseline, memberStatsDraft]);

  const hasUnsavedMemberChanges = pendingMemberStatUpdates.length > 0;

  const confirmDiscardUnsavedChanges = useCallback(async (): Promise<boolean> => {
    if (!hasUnsavedMemberChanges) {
      return true;
    }
    return confirm({
      title: t("history.unsavedChanges"),
      description: t("history.unsavedExitConfirm"),
      confirmLabel: t("history.discardChanges"),
      cancelLabel: t("common:action.cancel"),
      intent: "warning",
    });
  }, [confirm, hasUnsavedMemberChanges, t]);

  const requestCloseDetailModal = useCallback(async () => {
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
  }, [confirmDiscardUnsavedChanges, detailModalHandlers, saveMemberStatsPending]);

  const handleSaveMemberStats = useCallback(async () => {
    if (!canManage || pendingMemberStatUpdates.length === 0) {
      return;
    }
    await onSaveMemberStats(pendingMemberStatUpdates);
    const nextBaseline: Record<string, MemberStatDraft> = {};
    for (const [userId, draft] of Object.entries(memberStatsDraft)) {
      nextBaseline[userId] = { ...draft };
    }
    setMemberStatsBaseline(nextBaseline);
  }, [canManage, memberStatsDraft, onSaveMemberStats, pendingMemberStatUpdates]);

  const handleDeleteHistory = useCallback(async () => {
    if (!canManage || !historyDetail) {
      return;
    }
    const confirmed = await confirm({
      title: t("history.deleteConfirmTitle"),
      description: t("history.deleteConfirmDescription", { name: historyDetail.war_name }),
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) {
      onDeleteHistory(historyDetail.id);
      detailModalHandlers.close();
      setMemberStatsBaseline({});
      setMemberStatsDraft({});
    }
  }, [canManage, confirm, detailModalHandlers, historyDetail, onDeleteHistory, t]);

  const handleBulkDelete = useCallback(async () => {
    if (!canManage || selectedHistoryIds.size === 0) {
      return;
    }
    const confirmed = await confirm({
      title: t("history.bulkDeleteConfirmTitle"),
      description: t("history.bulkDeleteConfirmDescription", { count: selectedHistoryIds.size }),
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) {
      onBulkDeleteHistory(Array.from(selectedHistoryIds));
      setSelectedHistoryIds(new Set());
    }
  }, [canManage, confirm, onBulkDeleteHistory, selectedHistoryIds, t]);

  const toggleHistorySelection = useCallback((id: string) => {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allFilteredSelected = filteredHistoryRows.length > 0
    && filteredHistoryRows.every((row) => selectedHistoryIds.has(row.id));
  const someFilteredSelected = filteredHistoryRows.some((row) => selectedHistoryIds.has(row.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedHistoryIds((current) => {
      const next = new Set(current);
      for (const row of filteredHistoryRows) {
        if (allFilteredSelected) {
          next.delete(row.id);
        } else {
          next.add(row.id);
        }
      }
      return next;
    });
  }, [allFilteredSelected, filteredHistoryRows]);

  const updateDraftMetric = useCallback((userId: string, key: EditableMetricKey, value: string | number) => {
    const nextValue = toDraftMetricValue(value);
    setMemberStatsDraft((current) => {
      const existing = current[userId];
      if (!existing || existing[key] === nextValue) {
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
  }, []);

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
          ...draft,
        },
      };
    });
  }, [historyDetail, memberStatsDraft]);

  const handleSelectHistoryId = useCallback(async (historyId: string) => {
    const confirmed = await confirmDiscardUnsavedChanges();
    if (!confirmed) {
      return;
    }
    onSelectHistoryId(historyId);
    detailModalHandlers.open();
  }, [confirmDiscardUnsavedChanges, detailModalHandlers, onSelectHistoryId]);

  const summaryColumnsWithSelect = useMemo<ColumnDef<HistorySummaryRow, unknown>[]>(() => {
    if (!canManage) {
      return historyColumns;
    }
    const checkboxColumn: ColumnDef<HistorySummaryRow, unknown> = {
      id: "_select",
      size: 40,
      enableSorting: false,
      header: () => (
        <Checkbox
          size="xs"
          checked={allFilteredSelected}
          indeterminate={someFilteredSelected && !allFilteredSelected}
          onChange={toggleSelectAll}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          size="xs"
          checked={selectedHistoryIds.has(row.original.id)}
          onChange={() => toggleHistorySelection(row.original.id)}
          onClick={(event) => event.stopPropagation()}
        />
      ),
    };
    return [checkboxColumn, ...historyColumns];
  }, [
    allFilteredSelected,
    canManage,
    historyColumns,
    selectedHistoryIds,
    someFilteredSelected,
    toggleHistorySelection,
    toggleSelectAll,
  ]);

  const summaryTable = useReactTable({
    data: filteredHistoryRows,
    columns: summaryColumnsWithSelect,
    state: { sorting: summarySorting },
    onSortingChange: setSummarySorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

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
    ...EDITABLE_METRIC_KEYS.map((metricKey, columnIndex): ColumnDef<HistoryMemberStat, unknown> => ({
      header: t(`history.table.${metricKey === "building_damage" ? "building" : metricKey === "damage_taken" ? "damageTaken" : metricKey}`),
      id: metricKey,
      accessorFn: (row) => row.stats?.[metricKey] ?? 0,
      cell: ({ row, table }) => {
        if (!canManage) {
          return row.original.stats?.[metricKey] ?? "-";
        }

        const visibleRows = table.getRowModel().rows;
        const visibleRowIndex = visibleRows.findIndex((visibleRow) => visibleRow.id === row.id);
        return (
          <MetricGridInput
            aria-label={t("history.aria.memberMetric", {
              member: row.original.username ?? row.original.user_id,
              metric: t(`history.table.${metricKey === "building_damage" ? "building" : metricKey === "damage_taken" ? "damageTaken" : metricKey}`),
            })}
            gridId="guild-war-history-metrics"
            rowIndex={visibleRowIndex}
            columnIndex={columnIndex}
            rowCount={visibleRows.length}
            columnCount={EDITABLE_METRIC_KEYS.length}
            hideControls
            min={0}
            size="xs"
            variant="unstyled"
            value={row.original.stats?.[metricKey] ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, metricKey, value)}
            decimalScale={["damage", "healing", "building_damage", "damage_taken"].includes(metricKey) ? 2 : undefined}
            styles={{ input: { minWidth: 64, padding: "2px 4px", textAlign: "center" } }}
          />
        );
      },
    })),
    {
      header: t("analytics.metric.kda"),
      id: "kda",
      enableSorting: true,
      accessorFn: (row) => {
        const kills = row.stats?.kills ?? 0;
        const deaths = row.stats?.deaths ?? 0;
        const assists = row.stats?.assists ?? 0;
        return (kills + assists) / Math.max(1, deaths);
      },
      cell: ({ row }) => {
        const kills = row.original.stats?.kills ?? 0;
        const deaths = row.original.stats?.deaths ?? 0;
        const assists = row.original.stats?.assists ?? 0;
        return ((kills + assists) / Math.max(1, deaths)).toFixed(2);
      },
    },
    {
      header: t("history.table.missing"),
      id: "missing",
      enableSorting: false,
      cell: ({ row }) => {
        const stats = row.original.stats;
        const hasAnyData = stats !== null
          && stats !== undefined
          && Object.values(stats).some((value) => value !== null && value !== 0);
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
  ], [canManage, t, updateDraftMetric]);

  const detailTable = useReactTable({
    data: detailRows,
    columns: detailColumns,
    state: { sorting: detailSorting },
    onSortingChange: setDetailSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  return {
    historySearch,
    setHistorySearch: onHistorySearchChange,
    detailModalOpen,
    filteredHistoryRows,
    selectedHistoryIds,
    summaryTable,
    detailTable,
    highlightRowId,
    hasUnsavedMemberChanges,
    handleSelectHistoryId,
    handleBulkDelete,
    toggleHistorySelection,
    toggleSelectAll,
    handleSaveMemberStats,
    handleDeleteHistory,
    requestCloseDetailModal,
  };
}

export type WarHistoryTabController = ReturnType<typeof useWarHistoryTabController>;
