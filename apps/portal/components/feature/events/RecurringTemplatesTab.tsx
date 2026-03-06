import type { RecurringTemplate } from "@guild/shared";
import { EVENT_TYPES } from "@guild/shared";
import { DepthButton } from "@infini-dev-kit/frontend/components";
import { Badge, Group, Loader, Menu, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconDots,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createTemplate,
  deleteTemplate,
  pauseTemplate,
  resumeTemplate,
  updateTemplate,
} from "../../../api/mutations/events";
import { fetchTemplatesList } from "../../../api/queries/events";
import { queryKeys } from "../../../api/query-keys";
import { useAppError } from "../../../hooks/useAppError";
import { RecurringTemplateFormModal } from "./RecurringTemplateFormModal";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

function buildRecurrenceSummary(
  t: (key: string, opts?: Record<string, unknown>) => string,
  rule: RecurringTemplate["recurrence_rule"],
): string {
  if (!rule) return "";
  const freq = rule.frequency;
  const interval = rule.interval ?? 1;
  if (freq === "daily") {
    return t("recurring.summary.daily", { interval });
  }
  if (freq === "weekly") {
    const dayNames = (rule.daysOfWeek ?? [])
      .sort((a, b) => a - b)
      .map((d) => t(WEEKDAY_KEYS[d] ?? "weekday.sun"))
      .join(", ");
    return t("recurring.summary.weekly", { interval, days: dayNames });
  }
  if (freq === "monthly") {
    return t("recurring.summary.monthly", { interval, day: rule.dayOfMonth ?? 1 });
  }
  return "";
}

type RecurringTemplatesTabProps = {
  canManage: boolean;
  createRequested?: number;
};

export function RecurringTemplatesTab({ canManage, createRequested }: RecurringTemplatesTabProps) {
  const { t } = useTranslation("events");
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);

  const templatesQuery = useQuery({
    queryKey: queryKeys.events.templates(),
    queryFn: fetchTemplatesList,
  });

  const templates = templatesQuery.data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.templates() });
      notifications.show({ color: "infini-success", message: t("recurring.message.created") });
      setFormOpen(false);
      setEditingTemplate(null);
    },
    onError: (error) => showError(error, t("recurring.message.createFailed")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateTemplate>[1] }) =>
      updateTemplate(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.templates() });
      notifications.show({ color: "infini-success", message: t("recurring.message.updated") });
      setFormOpen(false);
      setEditingTemplate(null);
    },
    onError: (error) => showError(error, t("recurring.message.updateFailed")),
  });

  const pauseMutation = useMutation({
    mutationFn: pauseTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.templates() });
      notifications.show({ color: "infini-success", message: t("recurring.message.paused") });
    },
    onError: (error) => showError(error, t("recurring.message.pauseFailed")),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.templates() });
      notifications.show({ color: "infini-success", message: t("recurring.message.resumed") });
    },
    onError: (error) => showError(error, t("recurring.message.resumeFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.templates() });
      notifications.show({ color: "infini-success", message: t("recurring.message.deleted") });
    },
    onError: (error) => showError(error, t("recurring.message.deleteFailed")),
  });

  const handleCreate = useCallback(() => {
    setFormMode("create");
    setEditingTemplate(null);
    setFormOpen(true);
  }, []);

  useEffect(() => {
    if (createRequested) handleCreate();
  }, [createRequested, handleCreate]);

  const handleEdit = useCallback((template: RecurringTemplate) => {
    setFormMode("edit");
    setEditingTemplate(template);
    setFormOpen(true);
  }, []);

  const handleDelete = useCallback(
    (template: RecurringTemplate) => {
      modals.openConfirmModal({
        title: t("recurring.confirm.delete.title"),
        children: (
          <Text size="sm">{t("recurring.confirm.delete.description")}</Text>
        ),
        confirmProps: { color: "infini-danger" },
        onConfirm: () => deleteMutation.mutate(template.id),
        centered: true,
      });
    },
    [t, deleteMutation],
  );

  const handleFormSave = useCallback(
    (payload: Parameters<typeof createTemplate>[0]) => {
      if (formMode === "create") {
        createMutation.mutate(payload);
      } else if (editingTemplate) {
        updateMutation.mutate({ id: editingTemplate.id, payload });
      }
    },
    [formMode, editingTemplate, createMutation, updateMutation],
  );

  if (templatesQuery.isLoading) {
    return (
      <Group justify="center" py={40}>
        <Loader size="sm" />
      </Group>
    );
  }

  return (
    <>
      <Stack gap={16}>
        {templates.length === 0 ? (
          <Text c="dimmed" ta="center" py={40}>
            {t("recurring.empty")}
          </Text>
        ) : (
          <Stack gap={12}>
            {templates.map((template) => {
              const isPaused = template.archived_at !== null;
              const typeDef = EVENT_TYPES.find((et) => et === template.type);
              return (
                <div
                  key={template.id}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 8,
                    border: "1px solid color-mix(in srgb, var(--infini-color-border, #e5e7eb) 100%, transparent)",
                    background: isPaused
                      ? "color-mix(in srgb, var(--infini-color-text, #111827) 3%, transparent)"
                      : "color-mix(in srgb, var(--infini-color-primary, #3b82f6) 4%, transparent)",
                    opacity: isPaused ? 0.7 : 1,
                    transition: "opacity 150ms ease",
                  }}
                >
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={8} align="center">
                        <Text fw={600} size="sm" truncate>
                          {template.title}
                        </Text>
                        {typeDef && (
                          <Badge size="xs" variant="light">
                            {t(`common:eventType.${typeDef}`)}
                          </Badge>
                        )}
                        <Badge
                          size="xs"
                          variant="light"
                          color={isPaused ? "gray" : "green"}
                        >
                          {isPaused ? t("recurring.status.paused") : t("recurring.status.active")}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {buildRecurrenceSummary(t, template.recurrence_rule)}
                      </Text>
                      <Group gap={12}>
                        {template.last_generated_date && (
                          <Text size="xs" c="dimmed">
                            {t("recurring.lastGenerated", {
                              date: new Date(template.last_generated_date).toLocaleDateString(),
                            })}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed">
                          {t("recurring.generated", { count: template.generation_count })}
                        </Text>
                      </Group>
                    </Stack>

                    {canManage && (
                      <Menu position="bottom-end" withArrow>
                        <Menu.Target>
                          <DepthButton type="secondary" size="xs" iconOnly>
                            <IconDots size={16} />
                          </DepthButton>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconPencil size={14} />}
                            onClick={() => handleEdit(template)}
                          >
                            {t("menu.edit")}
                          </Menu.Item>
                          {isPaused ? (
                            <Menu.Item
                              leftSection={<IconPlayerPlay size={14} />}
                              onClick={() => resumeMutation.mutate(template.id)}
                            >
                              {t("recurring.resume")}
                            </Menu.Item>
                          ) : (
                            <Menu.Item
                              leftSection={<IconPlayerPause size={14} />}
                              onClick={() => pauseMutation.mutate(template.id)}
                            >
                              {t("recurring.pause")}
                            </Menu.Item>
                          )}
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => handleDelete(template)}
                          >
                            {t("recurring.delete")}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Group>
                </div>
              );
            })}
          </Stack>
        )}
      </Stack>

      <RecurringTemplateFormModal
        open={formOpen}
        mode={formMode}
        template={editingTemplate}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onCancel={() => {
          setFormOpen(false);
          setEditingTemplate(null);
        }}
        onSave={handleFormSave}
      />
    </>
  );
}
