import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  deleteGuildWarHistory,
  downloadGuildWarExport,
  batchUpdateGuildWarMemberStats,
  batchDeleteGuildWarHistory,
  postGuildWarResults,
  updateGuildWarRoleTag,
} from "../../services/GuildWarService";
import { useAppError } from "../useAppError";
import { queryKeys } from "../../api/query-keys";
import type { HistoryMemberStatsUpdate } from "../../components/feature/guild-war/WarHistoryTab";

const message = {
  success: (content: string) => notifications.show({ color: "green", message: content }),
  warning: (content: string) => notifications.show({ color: "yellow", message: content }),
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
    mutationFn: updateGuildWarRoleTag,
    onSuccess: async () => {
      message.success(t("message.roleTagUpdated"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, t("message.roleTagUpdateFailed"));
    },
  });

  const postResultsMutation = useMutation({
    mutationFn: postGuildWarResults,
    onSuccess: (payload) => {
      message.success(t("message.resultsPostSuccess", { taskId: payload.task_id }));
    },
    onError: (error) => {
      showError(error, t("message.resultsPostFailed"));
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
        updates.map((update) => ({ user_id: update.userId, stats: update.payload })),
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
    postResultsMutation,
    exportHistoryMutation,
    updateMemberStatsMutation,
    deleteHistoryMutation,
    batchDeleteHistoryMutation,
    saveHistoryMemberStats,
  };
}
