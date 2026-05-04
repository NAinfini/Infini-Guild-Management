import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Badge } from "@mantine/core";
import type { ColumnDef } from "@tanstack/react-table";
import type { HistorySummaryRow } from "../../components/feature/guild-war/WarHistoryTab";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function resolveResultTagColor(result: string | null | undefined): string {
  const normalized = (result ?? "").toLowerCase();
  if (normalized.includes("win") || normalized.includes("胜")) return "green";
  if (normalized.includes("loss") || normalized.includes("lose") || normalized.includes("负")) return "red";
  if (normalized.includes("draw") || normalized.includes("平")) return "blue";
  return "gray";
}

type UseGuildWarHistoryParams = {
  historyDetailData: {
    id: string;
    teams: Array<{
      team_name: string;
      members: Array<{
        user_id: string;
        username?: string;
        damage?: number | null;
        healing?: number | null;
        building_damage?: number | null;
      }>;
    }>;
    member_stats: Array<{
      user_id: string;
      username?: string;
      damage: number | null;
      healing: number | null;
      building_damage: number | null;
      damage_taken?: number | null;
    }>;
  } | null;
};

export function useGuildWarHistory({
  historyDetailData,
}: UseGuildWarHistoryParams) {
  const { t } = useTranslation("guild-war");

  const historyColumns: ColumnDef<HistorySummaryRow, unknown>[] = [
    {
      header: t("history.table.name"),
      id: "war_name",
      accessorKey: "war_name",
    },
    {
      header: t("history.table.enemy"),
      id: "enemy_name",
      accessorKey: "enemy_name",
      cell: ({ getValue }) => {
        const v = getValue();
        return typeof v === "string" && v ? v : "-";
      },
    },
    {
      header: t("history.table.result"),
      id: "result",
      accessorKey: "result",
      cell: ({ getValue }) => {
        const v = getValue();
        const label = typeof v === "string" && v ? v : "-";
        return <Badge color={resolveResultTagColor(v as string | null)} variant="light">{label}</Badge>;
      },
    },
    {
      header: t("history.table.kills"),
      id: "kills",
      enableSorting: false,
      cell: ({ row }) => `${row.original.own_kills ?? 0} / ${row.original.enemy_kills ?? 0}`,
    },
    {
      header: t("history.table.date"),
      id: "created_at",
      accessorKey: "created_at",
      cell: ({ getValue }) => {
        const v = getValue();
        return typeof v === "string" ? formatDateTime(v) : "-";
      },
    },
  ];

  const historyMvp = useMemo(() => {
    const stats = historyDetailData?.member_stats ?? [];
    if (stats.length === 0) {
      return null;
    }

    const topDamage = [...stats].sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0))[0] ?? null;
    const topHealing = [...stats].sort((a, b) => (b.healing ?? 0) - (a.healing ?? 0))[0] ?? null;
    const topBuilding = [...stats].sort((a, b) => (b.building_damage ?? 0) - (a.building_damage ?? 0))[0] ?? null;
    const topDamageTaken = [...stats].sort((a, b) => (b.damage_taken ?? 0) - (a.damage_taken ?? 0))[0] ?? null;

    return {
      damage: topDamage ? `${topDamage.username ?? topDamage.user_id} (${topDamage.damage ?? 0})` : "-",
      healing: topHealing ? `${topHealing.username ?? topHealing.user_id} (${topHealing.healing ?? 0})` : "-",
      building: topBuilding ? `${topBuilding.username ?? topBuilding.user_id} (${topBuilding.building_damage ?? 0})` : "-",
      damageTaken: topDamageTaken ? `${topDamageTaken.username ?? topDamageTaken.user_id} (${topDamageTaken.damage_taken ?? 0})` : "-",
    };
  }, [historyDetailData]);

  const historyTeamSizeBaseline = useMemo(() => {
    const teams = historyDetailData?.teams ?? [];
    if (teams.length === 0) {
      return 0;
    }
    return teams.reduce((max, team) => Math.max(max, team.members.length), 0);
  }, [historyDetailData?.teams]);

  const historyMissingSlotsByUserId = useMemo(() => {
    const map = new Map<string, number>();
    const teams = historyDetailData?.teams ?? [];
    if (historyTeamSizeBaseline <= 0 || teams.length === 0) {
      return map;
    }
    for (const team of teams) {
      const missing = Math.max(0, historyTeamSizeBaseline - team.members.length);
      for (const member of team.members) {
        map.set(member.user_id, missing);
      }
    }
    return map;
  }, [historyDetailData?.teams, historyTeamSizeBaseline]);

  return {
    historyColumns,
    historyMvp,
    historyMissingSlotsByUserId,
    formatDateTime,
  };
}
