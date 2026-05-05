import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  deleteGuildWarHistory,
  downloadGuildWarExport,
  batchUpdateGuildWarMemberStats,
  batchDeleteGuildWarHistory,
  updateGuildWarRoleTags,
} from "../../services/GuildWarService";
import { useAppError } from "../useAppError";
import { queryKeys } from "../../api/query-keys";
import type { HistoryMemberStatsUpdate } from "../../components/feature/guild-war/WarHistoryTab";
import { notifySuccess, notifyWarning } from "../../utils/notifications";

const message = {
  success: (content: string) => notifySuccess(content),
  warning: (content: string) => notifyWarning(content),
};

function downloadFileBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type UseGuildWarMutationsParams = {
  selectedEventId: string | undefined;
  selectedHistoryId: string;
  historyDateFrom: string;
  historyDateTo: string;
  setSelectedHistoryId: (value: string) => void;
};

export function useGuildWarMutations({
  selectedEventId,
  selectedHistoryId,
  historyDateFrom,
  historyDateTo,
  setSelectedHistoryId,
}: UseGuildWarMutationsParams) {
  const { t } = useTranslation("guild-war");
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const roleTagMutation = useMutation({
    mutationFn: (payload: { event_id: string; user_id: string; role_tag: string | null }) =>
      updateGuildWarRoleTags({
        event_id: payload.event_id,
        updates: [{ user_id: payload.user_id, role_tag: payload.role_tag }],
      }),
    onSuccess: async () => {
      message.success(t("message.roleTagUpdated"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? null),
      });
    },
    onError: (error) => {
      showError(error, t("message.roleTagUpdateFailed"));
    },
  });

  const exportHistoryMutation = useMutation({
    mutationFn: async (format: "csv" | "json") =>
      downloadGuildWarExport({
        format,
        event_id: selectedEventId,
        date_from: historyDateFrom ? `${historyDateFrom}T00:00:00.000Z` : undefined,
        date_to: historyDateTo ? `${historyDateTo}T23:59:59.999Z` : undefined,
      }),
    onSuccess: ({ filename, blob }) => {
      downloadFileBlob(filename, blob);
      message.success(t("history.export.success"));
    },
    onError: (error) => {
      showError(error, t("history.export.failed"));
    },
  });

  const updateMemberStatsMutation = useMutation({
    mutationFn: ({
      historyId,
      updates,
    }: {
      historyId: string;
      updates: HistoryMemberStatsUpdate[];
    }) =>
      batchUpdateGuildWarMemberStats(
        historyId,
        updates.map((update) => ({ user_id: update.userId, stats: { stats: update.payload as Record<string, number | null> } })),
      ),
    onSuccess: async () => {
      message.success(t("history.saveStatsSuccess"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyDetail(selectedHistoryId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.analyticsDetailsAll(),
      });
    },
    onError: (error) => {
      showError(error, t("history.saveStatsFailed"));
    },
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: deleteGuildWarHistory,
    onSuccess: async () => {
      message.success(t("history.deleteSuccess"));
      setSelectedHistoryId("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyAll(),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.analyticsDetailsAll(),
      });
    },
    onError: (error) => {
      showError(error, t("history.deleteFailed"));
    },
  });

  const batchDeleteHistoryMutation = useMutation({
    mutationFn: batchDeleteGuildWarHistory,
    onSuccess: async (_data, ids) => {
      message.success(t("history.bulkDeleteSuccess", { count: ids.length }));
      setSelectedHistoryId("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyAll(),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.analyticsDetailsAll(),
      });
    },
    onError: (error) => {
      showError(error, t("history.bulkDeleteFailed"));
    },
  });

  const saveHistoryMemberStats = async (updates: HistoryMemberStatsUpdate[]) => {
    if (!selectedHistoryId || updates.length === 0) {
      return;
    }
    await updateMemberStatsMutation.mutateAsync({
      historyId: selectedHistoryId,
      updates,
    });
  };

  return {
    roleTagMutation,
    exportHistoryMutation,
    updateMemberStatsMutation,
    deleteHistoryMutation,
    batchDeleteHistoryMutation,
    saveHistoryMemberStats,
  };
}
