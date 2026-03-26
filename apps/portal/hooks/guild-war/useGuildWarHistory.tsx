import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { NumberTicker } from "@infini-dev-kit/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { HistorySummaryRow } from "../../components/feature/guild-war/WarHistoryTab";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function renderCounter(value: number | null | undefined) {
  return <NumberTicker value={value ?? 0} />;
}

type UseGuildWarHistoryParams = {
  historyDetailData: {
    id: string;
    teams: Array<{
      team_name: string;
      members: Array<{
        user_id: string;
        damage?: number | null;
        healing?: number | null;
        building_damage?: number | null;
      }>;
    }>;
    member_stats: Array<{
      user_id: string;
      damage: number | null;
      healing: number | null;
      building_damage: number | null;
    }>;
  } | null;
  templatesData: Array<{
    id: string;
    template_name: string;
    description?: string | null;
    team_count: number;
    member_count: number;
  }>;
  canManageActive: boolean;
  selectedEventId: string | undefined;
  createTemplatePending: boolean;
  applyTemplatePending: boolean;
  deleteTemplatePending: boolean;
};

export function useGuildWarHistory({
  historyDetailData,
  templatesData,
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
        return typeof v === "string" ? v : "-";
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

    return {
      damage: topDamage ? `${topDamage.user_id} (${topDamage.damage ?? 0})` : "-",
      healing: topHealing ? `${topHealing.user_id} (${topHealing.healing ?? 0})` : "-",
      building: topBuilding ? `${topBuilding.user_id} (${topBuilding.building_damage ?? 0})` : "-",
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

  const templateOptions = useMemo(
    () =>
      templatesData.map((template) => ({
        value: template.id,
        label: `${template.template_name} (${template.team_count}/${template.member_count})`,
      })),
    [templatesData],
  );

  return {
    historyColumns,
    historyMvp,
    historyMissingSlotsByUserId,
    templateOptions,
    formatDateTime,
    renderCounter,
  };
}
