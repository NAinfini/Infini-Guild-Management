import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  createTemplate as createTemplateMutation,
  deleteTemplate as deleteTemplateMutation,
  fetchTemplatesList as fetchTemplatesListQuery,
  pauseTemplate as pauseTemplateMutation,
  resumeTemplate as resumeTemplateMutation,
  updateTemplate as updateTemplateMutation,
} from "../../../services/EventService";
import { queryKeys } from "../../../services/PortalQueryKeys";

type UseRecurringTemplatesControllerParams = {
  enabled?: boolean;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useRecurringTemplatesController({
  enabled = true,
  showError,
}: UseRecurringTemplatesControllerParams) {
  const { t } = useTranslation("events");
  const queryClient = useQueryClient();

  const invalidateTemplates = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.events.templates() });
  }, [queryClient]);

  const templatesQuery = useQuery({
    queryKey: queryKeys.events.templates(),
    queryFn: fetchTemplatesListQuery,
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: createTemplateMutation,
    onSuccess: async () => {
      await invalidateTemplates();
      notifications.show({ color: "infini-success", message: t("recurring.message.created") });
    },
    onError: (error) => showError(error, t("recurring.message.createFailed")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateTemplateMutation>[1] }) =>
      updateTemplateMutation(id, payload),
    onSuccess: async () => {
      await invalidateTemplates();
      notifications.show({ color: "infini-success", message: t("recurring.message.updated") });
    },
    onError: (error) => showError(error, t("recurring.message.updateFailed")),
  });

  const pauseMutation = useMutation({
    mutationFn: pauseTemplateMutation,
    onSuccess: async () => {
      await invalidateTemplates();
      notifications.show({ color: "infini-success", message: t("recurring.message.paused") });
    },
    onError: (error) => showError(error, t("recurring.message.pauseFailed")),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeTemplateMutation,
    onSuccess: async () => {
      await invalidateTemplates();
      notifications.show({ color: "infini-success", message: t("recurring.message.resumed") });
    },
    onError: (error) => showError(error, t("recurring.message.resumeFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTemplateMutation,
    onSuccess: async () => {
      await invalidateTemplates();
      notifications.show({ color: "infini-success", message: t("recurring.message.deleted") });
    },
    onError: (error) => showError(error, t("recurring.message.deleteFailed")),
  });

  const createRecurringTemplate = useCallback(
    async (payload: Parameters<typeof createTemplateMutation>[0]) => createMutation.mutateAsync(payload),
    [createMutation],
  );

  const updateRecurringTemplate = useCallback(
    async (id: string, payload: Parameters<typeof updateTemplateMutation>[1]) =>
      updateMutation.mutateAsync({ id, payload }),
    [updateMutation],
  );

  const pauseRecurringTemplate = useCallback(
    async (id: string) => pauseMutation.mutateAsync(id),
    [pauseMutation],
  );

  const resumeRecurringTemplate = useCallback(
    async (id: string) => resumeMutation.mutateAsync(id),
    [resumeMutation],
  );

  const deleteRecurringTemplate = useCallback(
    async (id: string) => deleteMutation.mutateAsync(id),
    [deleteMutation],
  );

  return {
    templates: templatesQuery.data?.data ?? [],
    loading: templatesQuery.isLoading,
    formSaving: createMutation.isPending || updateMutation.isPending,
    createRecurringTemplate,
    updateRecurringTemplate,
    pauseRecurringTemplate,
    resumeRecurringTemplate,
    deleteRecurringTemplate,
  };
}
