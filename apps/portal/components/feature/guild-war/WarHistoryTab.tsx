import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Skeleton,
  Modal,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconCalendarOff } from "@tabler/icons-react";
import { CrownOutlined, ShieldOutlined, SwordsOutlined, TargetOutlined } from "@portal/utils/icons";
import { InfiniTable, getCoreRowModel, getSortedRowModel, useReactTable } from "@portal/components/shared/InfiniTable";
import type { ColumnDef, SortingState } from "@portal/components/shared/InfiniTable";
import ReactEChartsCore from "echarts-for-react/lib/core";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { EmptyState } from "../../shared/EmptyState";
import { CompareBar } from "../../shared/CompareBar";


type HistoryViewMode = "table" | "chart";
type AnalyticsMetricKey =
  | "kills"
  | "deaths"
  | "assists"
  | "damage"
  | "healing"
  | "building_damage"
  | "credits"
  | "damage_taken"
  | "kda";
type EditableMetricKey = Exclude<AnalyticsMetricKey, "kda">;
type MemberStatDraft = Record<EditableMetricKey, number>;

const EDITABLE_METRIC_KEYS: EditableMetricKey[] = [
  "kills",
  "deaths",
  "assists",
  "damage",
  "healing",
  "building_damage",
  "credits",
  "damage_taken",
];

export type HistoryMemberStatsUpdate = {
  userId: string;
  payload: Partial<Record<EditableMetricKey, number>>;
};

export type HistorySummaryRow = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  created_at: string;
  own_kills: number | null;
  enemy_kills: number | null;
};

type HistoryMemberStat = {
  id: string;
  user_id: string;
  role_tag: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  healing: number | null;
  building_damage: number | null;
  credits: number | null;
  damage_taken: number | null;
};

type HistoryDetailTeam = {
  id: string;
  team_name: string;
  notes: string | null;
  members: Array<{
    user_id: string;
    role_tag: string | null;
  }>;
};

type HistoryDetailData = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  own_kills: number | null;
  enemy_kills: number | null;
  own_towers: number | null;
  enemy_towers: number | null;
  own_base_hp: number | null;
  enemy_base_hp: number | null;
  own_distance: number | null;
  enemy_distance: number | null;
  own_credits: number | null;
  enemy_credits: number | null;
  notes: string | null;
  member_stats: HistoryMemberStat[];
  teams: HistoryDetailTeam[];
};

type HistoryMvpSummary = {
  damage: string;
  healing: string;
  building: string;
};

function resolveResultTagColor(result: string | null | undefined): string {
  const normalized = (result ?? "").toLowerCase();
  if (normalized.includes("win") || normalized.includes("胜")) return "infini-success";
  if (normalized.includes("loss") || normalized.includes("lose") || normalized.includes("负")) return "infini-danger";
  if (normalized.includes("draw") || normalized.includes("平")) return "infini-primary";
  return "gray";
}

function toDraftMetricValue(value: string | number | null | undefined): number {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.floor(numericValue));
}

function createMemberDraft(row: HistoryMemberStat): MemberStatDraft {
  return {
    kills: toDraftMetricValue(row.kills),
    deaths: toDraftMetricValue(row.deaths),
    assists: toDraftMetricValue(row.assists),
    damage: toDraftMetricValue(row.damage),
    healing: toDraftMetricValue(row.healing),
    building_damage: toDraftMetricValue(row.building_damage),
    credits: toDraftMetricValue(row.credits),
    damage_taken: toDraftMetricValue(row.damage_taken),
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
  historyColumns: ColumnDef<HistorySummaryRow, unknown>[];
  onSelectHistoryId: (historyId: string) => void;
  historyDetailLoading: boolean;
  historyDetailError: boolean;
  historyDetail: HistoryDetailData | null;
  historyMvp: HistoryMvpSummary | null;
  historyMissingSlotsByUserId: Map<string, number>;
  onPostResults: (platform: "discord" | "wechat") => void;
  postResultsPending: boolean;
  onSaveMemberStats: (updates: HistoryMemberStatsUpdate[]) => Promise<void>;
  saveMemberStatsPending: boolean;
  onDeleteHistory: (historyId: string) => void;
  deleteHistoryPending: boolean;
  renderCounter: (value: number | null | undefined) => ReactNode;
  historyDetailTitle: string;
  historyResultLabel: string;
  loadErrorMessage: string;
  chartThemeName: string;
  chartPalette: string[];
  hashToPaletteColor: (value: string, palette: string[]) => string;
  getMetricLabel: (metric: AnalyticsMetricKey) => string;
  metricValueOrNullFromWarMember: (row: HistoryMemberStat, metric: AnalyticsMetricKey) => number | null;
  echarts: unknown;
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
  historyColumns,
  onSelectHistoryId,
  historyDetailLoading,
  historyDetailError,
  historyDetail,
  historyMvp,
  historyMissingSlotsByUserId: _historyMissingSlotsByUserId,
  onPostResults,
  postResultsPending,
  onSaveMemberStats,
  saveMemberStatsPending,
  onDeleteHistory,
  deleteHistoryPending,
  renderCounter: _renderCounter,
  historyDetailTitle,
  historyResultLabel,
  loadErrorMessage,
  chartThemeName,
  chartPalette,
  hashToPaletteColor,
  getMetricLabel,
  metricValueOrNullFromWarMember,
  echarts,
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
  }, [detailModalOpen, historyDetail?.id]);

  const filteredHistoryRows = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    if (!keyword) return historyRows;
    return historyRows.filter((row) => (
      row.war_name.toLowerCase().includes(keyword)
      || (row.enemy_name ?? "").toLowerCase().includes(keyword)
      || (row.result ?? "").toLowerCase().includes(keyword)
      || row.created_at.toLowerCase().includes(keyword)
      || String(row.own_kills ?? "").includes(keyword)
      || String(row.enemy_kills ?? "").includes(keyword)
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
        confirmProps: { color: "infini-warning" },
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
        confirmProps: { color: "infini-danger" },
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
        kills: draft.kills,
        deaths: draft.deaths,
        assists: draft.assists,
        damage: draft.damage,
        healing: draft.healing,
        building_damage: draft.building_damage,
        credits: draft.credits,
        damage_taken: draft.damage_taken,
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

  // Summary table
  const summaryTable = useReactTable({
    data: filteredHistoryRows,
    columns: historyColumns,
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
      accessorFn: (row) => row.kills ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            min={0}
            size="xs"
            value={row.original.kills ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "kills", value)}
          />
        ) : (row.original.kills ?? "-"),
    },
    {
      header: t("history.table.deaths"),
      id: "deaths",
      accessorFn: (row) => row.deaths ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            min={0}
            size="xs"
            value={row.original.deaths ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "deaths", value)}
          />
        ) : (row.original.deaths ?? "-"),
    },
    {
      header: t("history.table.assists"),
      id: "assists",
      accessorFn: (row) => row.assists ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            min={0}
            size="xs"
            value={row.original.assists ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "assists", value)}
          />
        ) : (row.original.assists ?? "-"),
    },
    {
      header: t("history.table.damage"),
      id: "damage",
      accessorFn: (row) => row.damage ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            min={0}
            size="xs"
            value={row.original.damage ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "damage", value)}
          />
        ) : (row.original.damage ?? "-"),
    },
    {
      header: t("history.table.healing"),
      id: "healing",
      accessorFn: (row) => row.healing ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            min={0}
            size="xs"
            value={row.original.healing ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "healing", value)}
          />
        ) : (row.original.healing ?? "-"),
    },
    {
      header: t("history.table.building"),
      id: "building_damage",
      accessorFn: (row) => row.building_damage ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            min={0}
            size="xs"
            value={row.original.building_damage ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "building_damage", value)}
          />
        ) : (row.original.building_damage ?? "-"),
    },
    {
      header: t("history.table.credits"),
      id: "credits",
      accessorFn: (row) => row.credits ?? 0,
      cell: ({ row }) =>
        canManage ? (
          <NumberInput
            min={0}
            size="xs"
            value={row.original.credits ?? 0}
            onChange={(value) => updateDraftMetric(row.original.user_id, "credits", value)}
          />
        ) : (row.original.credits ?? "-"),
    },
    {
      header: t("history.table.missing"),
      id: "missing",
      enableSorting: false,
      cell: ({ row }) => {
        const stat = row.original;
        const hasAnyData =
          (stat.kills !== null && stat.kills !== 0) ||
          (stat.deaths !== null && stat.deaths !== 0) ||
          (stat.assists !== null && stat.assists !== 0) ||
          (stat.damage !== null && stat.damage !== 0) ||
          (stat.healing !== null && stat.healing !== 0) ||
          (stat.building_damage !== null && stat.building_damage !== 0) ||
          (stat.credits !== null && stat.credits !== 0);
        return hasAnyData ? (
          <Badge color="infini-success">{t("history.table.complete")}</Badge>
        ) : (
          <Badge color="infini-warning">{t("history.table.missing")}</Badge>
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

      <div className="war-history-filters">
        <div className="war-history-filters__group">
          <TextInput
            value={historySearch}
            onChange={(event) => setHistorySearch(String(event.currentTarget.value ?? ""))}
            placeholder={t("history.search.placeholder")}
            aria-label="Search guild war histories"
            style={{ width: 240 }}
          />
          <TextInput
            type="date"
            value={historyDateFrom}
            onChange={(event) => onHistoryDateFromChange(event.currentTarget.value)}
            aria-label="Guild war history date from"
            style={{ width: 170 }}
          />
          <TextInput
            type="date"
            value={historyDateTo}
            onChange={(event) => onHistoryDateToChange(event.currentTarget.value)}
            aria-label="Guild war history date to"
            style={{ width: 170 }}
          />
          <Tooltip label={t("history.clearDates")}>
            <ActionIcon variant="subtle" onClick={onClearDates} disabled={!historyDateFrom && !historyDateTo} aria-label="Clear dates">
              <IconCalendarOff size={18} />
            </ActionIcon>
          </Tooltip>
        </div>

        {canManage && historyDetail ? (
          <>
            <div className="war-history-filters__divider" />
            <div className="war-history-filters__group">
              <DepthButton onClick={() => onPostResults("discord")} loading={postResultsPending}>
                {t("active.postDiscord")}
              </DepthButton>
              <DepthButton onClick={() => onPostResults("wechat")} loading={postResultsPending}>
                {t("active.postWechat")}
              </DepthButton>
            </div>
          </>
        ) : null}
      </div>

      {historyLoading ? <Stack gap={8}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {historyError ? <Alert color="infini-warning">{loadErrorMessage}</Alert> : null}

      {!historyLoading && !historyError ? (
        <PortalCard interactive={false} className="war-history-list-card">
          <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Group justify="space-between">
              <Text fw={600}>{t("history.warList")}</Text>
              <Badge color="infini-primary">{filteredHistoryRows.length} / {historyRows.length}</Badge>
            </Group>
            <div className="war-history-list-table-wrap">
              {filteredHistoryRows.length > 0 ? (
                <InfiniTable
                  table={summaryTable}
                  onRowClick={(row) => handleSelectHistoryId(row.original.id)}
                  rowClassName={(row) => highlightRowId === row.original.id ? "war-history-row-highlight" : undefined}
                />
              ) : (
                <div className="war-history-list-empty">
                  <EmptyState title={t("history.noWarHistories")} />
                </div>
              )}
            </div>
          </Stack>
          </div>
        </PortalCard>
      ) : null}

      <Modal
        opened={detailModalOpen}
        onClose={() => {
          void requestCloseDetailModal();
        }}
        title={historyDetail ? `${historyDetail.war_name}${historyDetail.enemy_name ? ` ${t("history.versus")} ${historyDetail.enemy_name}` : ""}` : historyDetailTitle}
        size="min(1800px, calc(100vw - 2rem))"
      >
          <Stack gap={16}>
            {historyDetailLoading ? <Stack gap={8}><Skeleton height={20} width="40%" />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={16} />)}</Stack> : null}
            {historyDetailError ? <Alert color="infini-warning">{loadErrorMessage}</Alert> : null}
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
                <Badge color={resolveResultTagColor(historyDetail.result)}>{historyDetail.result ?? "Unknown"}</Badge>
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
                              .map((member) => `${member.user_id}${member.role_tag ? ` [${member.role_tag}]` : ""}`)
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
                          data: historyDetail.member_stats.map((item) => item.user_id),
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
                    variant="light"
                    size="sm"
                    onClick={handleDeleteHistory}
                    loading={deleteHistoryPending}
                    disabled={historyDetailLoading}
                  >
                    {t("common:action.delete")}
                  </Button>
                ) : null}
                {canManage ? (
                  <DepthButton
                    type="primary"
                    onClick={handleSaveMemberStats}
                    loading={saveMemberStatsPending}
                    disabled={!hasUnsavedMemberChanges || historyDetailLoading}
                    className={hasUnsavedMemberChanges ? "war-history-save-button--ready" : undefined}
                  >
                    {t("history.saveChanges")}
                  </DepthButton>
                ) : null}
                <DepthButton type="primary" onClick={() => onExport("csv")} loading={exportPending}>
                  {exportCsvLabel}
                </DepthButton>
                <DepthButton type="primary" onClick={() => onExport("json")} loading={exportPending}>
                  {exportJsonLabel}
                </DepthButton>
              </Group>
              </Stack>
            ) : null}
          </Stack>
      </Modal>
    </Stack>
  );
}
