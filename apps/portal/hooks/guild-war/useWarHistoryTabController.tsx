import { Badge, Group, HoverCard, Text, ThemeIcon } from "@mantine/core";
import { DEFAULT_GAME_RULES, GUILD_WAR_KDA_KEY, evaluateKda } from "@guild/shared";
import { CircleCheckIcon, AlertTriangleIcon } from "@portal/components/icons";
import { MetricGridInput } from "@portal/components/shared/MetricGridInput";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  HistoryDetailData,
  HistoryMemberStat,
  HistoryMemberStatsUpdate,
  HistorySummaryRow,
} from "@portal/types/guild-war";
import { getGuildWarMemberStatLabel } from "@portal/utils/game-rules";

type EditableMetricKey = string;
type MemberStatDraft = Record<string, number>;

export function toDraftMetricValue(value: string | number | null | undefined): number {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, numericValue);
}

function createMemberDraft(row: HistoryMemberStat, metricKeys: readonly string[]): MemberStatDraft {
  return Object.fromEntries(
    metricKeys.map((key) => [key, toDraftMetricValue(row.stats?.[key])]),
  );
}

function createDraftMap(rows: HistoryMemberStat[], metricKeys: readonly string[]): Record<string, MemberStatDraft> {
  const draftMap: Record<string, MemberStatDraft> = {};
  for (const row of rows) {
    draftMap[row.user_id] = createMemberDraft(row, metricKeys);
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
  historyDetail: HistoryDetailData | null;
  canManage: boolean;
  saveMemberStatsPending: boolean;
  onSelectHistoryId: (historyId: string) => void;
  onSaveMemberStats: (updates: HistoryMemberStatsUpdate[]) => Promise<void>;
  onDeleteHistory: (historyId: string) => void;
};

export function useWarHistoryTabController({
  initialSearch,
  historySearch,
  onHistorySearchChange,
  historyRows,
  historyDetail,
  canManage,
  saveMemberStatsPending,
  onSelectHistoryId,
  onSaveMemberStats,
  onDeleteHistory,
}: UseWarHistoryTabControllerParams) {
  const { t } = useTranslation("guild-war");
  const gameRules = DEFAULT_GAME_RULES;
  const warRules = gameRules.guild_war;
  const editableMetricKeys = useMemo(
    () => warRules.member_stats.map((definition) => definition.key),
    [warRules.member_stats],
  );
  const confirm = useConfirmDialog();
  // The detail panel is always mounted on desktop. `activeHistoryId` is the row
  // it shows; `mobileView` only decides which of the two panes the single-column
  // layout reveals, so returning to the list on mobile never clears the selection
  // (and therefore never fights the auto-select effect below).
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);
  const [detailSorting, setDetailSorting] = useState<SortingState>([]);
  const [memberStatsBaseline, setMemberStatsBaseline] = useState<Record<string, MemberStatDraft>>({});
  const [memberStatsDraft, setMemberStatsDraft] = useState<Record<string, MemberStatDraft>>({});
  // Member statistics are read-only until the moderator explicitly enters edit mode.
  const [isEditingMemberStats, setIsEditingMemberStats] = useState(false);

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

  // Auto-select so the detail pane is populated the moment the tab opens, and
  // re-select when the active row disappears (deletion, filtering, paging).
  useEffect(() => {
    if (historyRows.length === 0) {
      if (activeHistoryId !== null) {
        setActiveHistoryId(null);
      }
      return;
    }
    if (activeHistoryId && historyRows.some((row) => row.id === activeHistoryId)) {
      return;
    }
    const firstRow = historyRows[0]!;
    setActiveHistoryId(firstRow.id);
    onSelectHistoryId(firstRow.id);
  }, [activeHistoryId, historyRows, onSelectHistoryId]);

  const historyDetailId = historyDetail?.id ?? null;
  useEffect(() => {
    if (!historyDetail) {
      return;
    }

    const nextBaseline = createDraftMap(historyDetail.member_stats, editableMetricKeys);
    setMemberStatsBaseline(nextBaseline);
    const nextDraft: Record<string, MemberStatDraft> = {};
    for (const [userId, draft] of Object.entries(nextBaseline)) {
      nextDraft[userId] = { ...draft };
    }
    setMemberStatsDraft(nextDraft);
    /* 换了一条战史就回到只读态，否则会带着上一条的编辑态进入新记录。 */
    setIsEditingMemberStats(false);
  }, [editableMetricKeys, historyDetail, historyDetailId]);

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

      const changed = editableMetricKeys.some((key) => draft[key] !== baseline[key]);
      if (!changed) {
        continue;
      }

      /*
       * 送整份草稿，不是只送改动的那几项。
       * member-stats 接口会整组替换固定统计列；只送差异的话，这次没碰过的指标
       * 会连同旧值一起被覆盖掉——改一个击杀数，死亡、助攻、伤害全部清空。
       * 草稿本身由 createMemberDraft 按全部可编辑指标建立，送出去就是完整的一份。
       */
      const payload: Partial<Record<EditableMetricKey, number>> = {};
      for (const key of editableMetricKeys) {
        payload[key] = draft[key];
      }
      updates.push({ userId: row.user_id, payload });
    }

    return updates;
  }, [canManage, editableMetricKeys, historyDetail, memberStatsBaseline, memberStatsDraft]);

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

  // Mobile-only: reveal the list pane again. The selection is deliberately kept
  // so returning to the detail does not lose the reader's place.
  const showMobileList = useCallback(async () => {
    if (saveMemberStatsPending) {
      return;
    }
    const confirmed = await confirmDiscardUnsavedChanges();
    if (!confirmed) {
      return;
    }
    setMobileView("list");
  }, [confirmDiscardUnsavedChanges, saveMemberStatsPending]);

  const beginEditMemberStats = useCallback(() => {
    if (!canManage) {
      return;
    }
    setIsEditingMemberStats(true);
  }, [canManage]);

  /* 退出编辑态时把草稿退回基线，避免下次进来还留着上次没保存的数字。 */
  const cancelEditMemberStats = useCallback(async () => {
    const confirmed = await confirmDiscardUnsavedChanges();
    if (!confirmed) {
      return;
    }
    const restored: Record<string, MemberStatDraft> = {};
    for (const [userId, draft] of Object.entries(memberStatsBaseline)) {
      restored[userId] = { ...draft };
    }
    setMemberStatsDraft(restored);
    setIsEditingMemberStats(false);
  }, [confirmDiscardUnsavedChanges, memberStatsBaseline]);

  const handleSaveMemberStats = useCallback(async () => {
    if (!canManage) {
      return;
    }
    /* 没改任何东西时不发请求，但仍然退出编辑态——「保存」就是退出的那个动作。 */
    if (pendingMemberStatUpdates.length > 0) {
      await onSaveMemberStats(pendingMemberStatUpdates);
      const nextBaseline: Record<string, MemberStatDraft> = {};
      for (const [userId, draft] of Object.entries(memberStatsDraft)) {
        nextBaseline[userId] = { ...draft };
      }
      setMemberStatsBaseline(nextBaseline);
    }
    setIsEditingMemberStats(false);
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
      // Drop the selection so the auto-select effect promotes the next record.
      setActiveHistoryId(null);
      setMemberStatsBaseline({});
      setMemberStatsDraft({});
    }
  }, [canManage, confirm, historyDetail, onDeleteHistory, t]);

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
    setActiveHistoryId(historyId);
    setMobileView("detail");
  }, [confirmDiscardUnsavedChanges, onSelectHistoryId]);

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
    ...warRules.member_stats.map((definition, columnIndex): ColumnDef<HistoryMemberStat, unknown> => ({
      header: getGuildWarMemberStatLabel(definition.key),
      id: definition.key,
      accessorFn: (row) => row.stats?.[definition.key] ?? 0,
      cell: ({ row, table }) => {
        const metricKey = definition.key;
        /* 只读态一律显示纯数字：没有权限，或者有权限但还没点「编辑」。 */
        if (!canManage || !isEditingMemberStats) {
          return row.original.stats?.[metricKey] ?? "-";
        }

        const visibleRows = table.getRowModel().rows;
        const visibleRowIndex = visibleRows.findIndex((visibleRow) => visibleRow.id === row.id);
        return (
          <MetricGridInput
            aria-label={t("history.aria.memberMetric", {
              member: row.original.username ?? row.original.user_id,
              metric: getGuildWarMemberStatLabel(metricKey),
            })}
            gridId="guild-war-history-metrics"
            rowIndex={visibleRowIndex}
            columnIndex={columnIndex}
            rowCount={visibleRows.length}
            columnCount={editableMetricKeys.length}
            hideControls
            min={0}
            size="xs"
            variant="unstyled"
            value={row.original.stats?.[metricKey] ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, metricKey, value)}
            styles={{ input: { minWidth: 64, padding: "2px 4px", textAlign: "center" } }}
          />
        );
      },
    })),
    {
      header: getGuildWarMemberStatLabel(GUILD_WAR_KDA_KEY),
      id: GUILD_WAR_KDA_KEY,
      enableSorting: true,
      accessorFn: (row) => {
        return evaluateKda(row.stats ?? {});
      },
      cell: ({ row }) => evaluateKda(row.original.stats ?? {}).toFixed(2),
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
              <Badge
                component="button"
                type="button"
                data-animate-icon-trigger
                color="green"
                style={{ cursor: "default" }}
              >
                {t("history.table.complete")}
              </Badge>
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
              <Badge
                component="button"
                type="button"
                data-animate-icon-trigger
                color="yellow"
                style={{ cursor: "default" }}
              >
                {t("history.table.missing")}
              </Badge>
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
  ], [canManage, editableMetricKeys.length, gameRules, isEditingMemberStats, t, updateDraftMetric, warRules]);

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
    activeHistoryId,
    mobileView,
    filteredHistoryRows,
    detailTable,
    highlightRowId,
    hasUnsavedMemberChanges,
    isEditingMemberStats,
    beginEditMemberStats,
    cancelEditMemberStats,
    handleSelectHistoryId,
    handleSaveMemberStats,
    handleDeleteHistory,
    showMobileList,
  };
}

export type WarHistoryTabController = ReturnType<typeof useWarHistoryTabController>;
