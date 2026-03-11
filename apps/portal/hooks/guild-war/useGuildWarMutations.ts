import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  applyGuildWarTemplate,
  createGuildWarTemplate,
  deleteGuildWarHistory,
  deleteGuildWarTemplate,
  downloadGuildWarExport,
  batchUpdateGuildWarMemberStats,
  postGuildWarResults,
  updateGuildWarRoleTag,
} from "../../services/GuildWarService";
import { useAppError } from "../useAppError";
import { queryKeys } from "../../services/PortalQueryKeys";
import type { HistoryMemberStatsUpdate } from "../../components/feature/guild-war/WarHistoryTab";

const message = {
  success: (content: string) => notifications.show({ color: "infini-success", message: content }),
  warning: (content: string) => notifications.show({ color: "infini-warning", message: content }),
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
  selectedTemplateId: string;
  templateName: string;
  templateDescription: string;
  historyDateFrom: string;
  historyDateTo: string;
  setTemplateName: (value: string) => void;
  setTemplateDescription: (value: string) => void;
  setSelectedTemplateId: (value: string) => void;
  setSelectedHistoryId: (value: string) => void;
};

export function useGuildWarMutations({
  selectedEventId,
  selectedHistoryId,
  selectedTemplateId,
  templateName,
  templateDescription,
  historyDateFrom,
  historyDateTo,
  setTemplateName,
  setTemplateDescription,
  setSelectedTemplateId,
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

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) {
        throw new Error("Missing event id");
      }
      const normalizedName = templateName.trim();
      if (!normalizedName) {
        throw new Error(t("message.templateNameRequired"));
      }
      const normalizedDescription = templateDescription.trim();
      return createGuildWarTemplate({
        event_id: selectedEventId,
        template_name: normalizedName,
        template_type: "structure" as const,
        description: normalizedDescription.length > 0 ? normalizedDescription : undefined,
      });
    },
    onSuccess: async (template) => {
      message.success(t("message.templateSaved"));
      setTemplateName("");
      setTemplateDescription("");
      setSelectedTemplateId(template.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.templates(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, t("message.templateSaveFailed"));
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) {
        throw new Error("Missing event id");
      }
      if (!selectedTemplateId) {
        throw new Error("Missing template id");
      }
      return applyGuildWarTemplate({
        event_id: selectedEventId,
        template_id: selectedTemplateId,
      });
    },
    onSuccess: async () => {
      message.success(t("message.templateApplied"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyAll(),
      });
    },
    onError: (error) => {
      showError(error, t("message.templateApplyFailed"));
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) {
        throw new Error("Missing template id");
      }
      return deleteGuildWarTemplate(selectedTemplateId);
    },
    onSuccess: async () => {
      message.success(t("message.templateDeleted"));
      setSelectedTemplateId("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.templates(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, t("message.templateDeleteFailed"));
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
    createTemplateMutation,
    applyTemplateMutation,
    deleteTemplateMutation,
    exportHistoryMutation,
    updateMemberStatsMutation,
    deleteHistoryMutation,
    saveHistoryMemberStats,
  };
}
