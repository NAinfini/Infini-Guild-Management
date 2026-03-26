import type { RecurringTemplate } from "@guild/shared";
import { EVENT_TYPES } from "@guild/shared";
import { DepthButton } from "@infini-dev-kit/react";
import { InfiniMenu } from "@portal/components/shared/InfiniMenu";
import { Badge, Group, Skeleton, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconDots,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  RecurringTemplateFormModal,
  type RecurringTemplateFormPayload,
} from "./RecurringTemplateFormModal";

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
  templates: RecurringTemplate[];
  loading: boolean;
  formSaving: boolean;
  onCreateTemplate: (payload: RecurringTemplateFormPayload) => Promise<unknown>;
  onUpdateTemplate: (id: string, payload: RecurringTemplateFormPayload) => Promise<unknown>;
  onPauseTemplate: (id: string) => Promise<unknown>;
  onResumeTemplate: (id: string) => Promise<unknown>;
  onDeleteTemplate: (id: string) => Promise<unknown>;
};

export function RecurringTemplatesTab({
  canManage,
  createRequested,
  templates,
  loading,
  formSaving,
  onCreateTemplate,
  onUpdateTemplate,
  onPauseTemplate,
  onResumeTemplate,
  onDeleteTemplate,
}: RecurringTemplatesTabProps) {
  const { t, i18n } = useTranslation("events");

  const [formOpen, formHandlers] = useDisclosure(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);

  const handleCreate = useCallback(() => {
    setFormMode("create");
    setEditingTemplate(null);
    formHandlers.open();
  }, []);

  useEffect(() => {
    if (createRequested) handleCreate();
  }, [createRequested, handleCreate]);

  const handleEdit = useCallback((template: RecurringTemplate) => {
    setFormMode("edit");
    setEditingTemplate(template);
    formHandlers.open();
  }, []);

  const handleDelete = useCallback(
    (template: RecurringTemplate) => {
      modals.openConfirmModal({
        title: t("recurring.confirm.delete.title"),
        children: (
          <Text size="sm">{t("recurring.confirm.delete.description")}</Text>
        ),
        confirmProps: { color: "infini-danger" },
        onConfirm: () => {
          void onDeleteTemplate(template.id);
        },
        centered: true,
      });
    },
    [onDeleteTemplate, t],
  );

  const handleFormSave = useCallback(
    async (payload: RecurringTemplateFormPayload) => {
      if (formMode === "create") {
        await onCreateTemplate(payload);
        formHandlers.close();
        setEditingTemplate(null);
        return;
      }

      if (editingTemplate) {
        await onUpdateTemplate(editingTemplate.id, payload);
        formHandlers.close();
        setEditingTemplate(null);
      }
    },
    [editingTemplate, formMode, onCreateTemplate, onUpdateTemplate],
  );

  if (loading) {
    return (
      <Stack gap={12} py={16}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Group key={i} gap={8}>
            <Skeleton height={14} width="30%" />
            <Skeleton height={14} width="20%" />
          </Group>
        ))}
      </Stack>
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
                              date: new Date(template.last_generated_date).toLocaleDateString(i18n.language),
                            })}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed">
                          {t("recurring.generated", { count: template.generation_count })}
                        </Text>
                      </Group>
                    </Stack>

                    {canManage && (
                      <InfiniMenu position="bottom-end" withArrow>
                        <InfiniMenu.Target>
                          <DepthButton type="secondary" size="sm">
                            <IconDots size={16} />
                          </DepthButton>
                        </InfiniMenu.Target>
                        <InfiniMenu.Dropdown>
                          <InfiniMenu.Item
                            leftSection={<IconPencil size={14} />}
                            onClick={() => handleEdit(template)}
                          >
                            {t("menu.edit")}
                          </InfiniMenu.Item>
                          {isPaused ? (
                            <InfiniMenu.Item
                              leftSection={<IconPlayerPlay size={14} />}
                              onClick={() => {
                                void onResumeTemplate(template.id);
                              }}
                            >
                              {t("recurring.resume")}
                            </InfiniMenu.Item>
                          ) : (
                            <InfiniMenu.Item
                              leftSection={<IconPlayerPause size={14} />}
                              onClick={() => {
                                void onPauseTemplate(template.id);
                              }}
                            >
                              {t("recurring.pause")}
                            </InfiniMenu.Item>
                          )}
                          <InfiniMenu.Divider />
                          <InfiniMenu.Item
                            className="infini-menu-item--danger"
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => handleDelete(template)}
                          >
                            {t("recurring.delete")}
                          </InfiniMenu.Item>
                        </InfiniMenu.Dropdown>
                      </InfiniMenu>
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
        confirmLoading={formSaving}
        onCancel={() => {
          formHandlers.close();
          setEditingTemplate(null);
        }}
        onSave={handleFormSave}
      />
    </>
  );
}
