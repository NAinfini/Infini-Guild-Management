import type { RecurringTemplate } from "@guild/shared";
import { EVENT_TYPES } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { InfiniMenu } from "@portal/components/shared/InfiniMenu";
import { PortalCard } from "@portal/components/shared/PortalCard";
import { Badge, Group, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { DotsIcon, PencilIcon, PlayIcon, TrashIcon } from "@portal/components/icons";
import {
  IconCalendarRepeat,
  IconPlayerPause,
  IconClock,
  IconUsers,
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

function extractTime(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
        confirmProps: { color: "red" },
        labels: { confirm: t("common:action.confirm"), cancel: t("common:action.cancel") },
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
          <Skeleton key={i} height={80} radius={8} />
        ))}
      </Stack>
    );
  }

  return (
    <>
      <Stack gap={12}>
        {templates.length === 0 ? (
          <PortalCard interactive={false}>
            <Stack align="center" gap={8} py={40} px={16}>
              <IconCalendarRepeat size={40} stroke={1.2} style={{ opacity: 0.3 }} />
              <Text c="dimmed" size="sm">{t("recurring.empty")}</Text>
            </Stack>
          </PortalCard>
        ) : (
          templates.map((template) => {
            const isPaused = template.archived_at !== null;
            const typeDef = EVENT_TYPES.find((et) => et === template.type);
            const time = extractTime(template.start_at);
            return (
              <PortalCard
                key={template.id}
                interactive={canManage}
                style={{ opacity: isPaused ? 0.65 : 1, transition: "opacity 150ms ease" }}
                onClick={canManage ? () => handleEdit(template) : undefined}
              >
                <div style={{ padding: "12px 16px" }}>
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <Group gap={12} align="center" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: isPaused
                            ? "color-mix(in srgb, var(--color-text, #111827) 6%, transparent)"
                            : "color-mix(in srgb, var(--color-primary, #3b82f6) 10%, transparent)",
                          flexShrink: 0,
                        }}
                      >
                        <IconCalendarRepeat
                          size={20}
                          stroke={1.5}
                          style={{
                            color: isPaused ? "var(--color-text-muted, #6b7280)" : "var(--color-primary, #3b82f6)",
                          }}
                        />
                      </div>

                      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={8} align="center" wrap="nowrap">
                          <Text fw={600} size="sm" truncate style={{ maxWidth: "100%" }}>
                            {template.title}
                          </Text>
                          {typeDef && (
                            <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                              {t(`common:eventType.${typeDef}`)}
                            </Badge>
                          )}
                          <Badge
                            size="xs"
                            variant="light"
                            color={isPaused ? "gray" : "green"}
                            style={{ flexShrink: 0 }}
                          >
                            {isPaused ? t("recurring.status.paused") : t("recurring.status.active")}
                          </Badge>
                        </Group>

                        <Group gap={16} wrap="wrap">
                          <Group gap={4} align="center">
                            <IconClock size={13} stroke={1.5} style={{ opacity: 0.5 }} />
                            <Text size="xs" c="dimmed">{time}</Text>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {buildRecurrenceSummary(t, template.recurrence_rule)}
                          </Text>
                          {template.capacity != null && (
                            <Group gap={4} align="center">
                              <IconUsers size={13} stroke={1.5} style={{ opacity: 0.5 }} />
                              <Text size="xs" c="dimmed">{template.capacity}</Text>
                            </Group>
                          )}
                        </Group>
                      </Stack>
                    </Group>

                    <Group gap={12} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                      {template.last_generated_date && (
                        <Tooltip label={t("recurring.lastGenerated", { date: new Date(template.last_generated_date).toLocaleDateString(i18n.language) })} withArrow>
                          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                            {t("recurring.generated", { count: template.generation_count })}
                          </Text>
                        </Tooltip>
                      )}

                      {canManage && (
                        <InfiniMenu position="bottom-end" withArrow>
                          <InfiniMenu.Target>
                            <DepthButton
                              type="secondary"
                              size="sm"
                              iconOnly
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            >
                              <DotsIcon size={16} />
                            </DepthButton>
                          </InfiniMenu.Target>
                          <InfiniMenu.Dropdown>
                            <InfiniMenu.Item
                              leftSection={<PencilIcon size={14} />}
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleEdit(template); }}
                            >
                              {t("menu.edit")}
                            </InfiniMenu.Item>
                            {isPaused ? (
                              <InfiniMenu.Item
                                leftSection={<PlayIcon size={14} />}
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  void onResumeTemplate(template.id);
                                }}
                              >
                                {t("recurring.resume")}
                              </InfiniMenu.Item>
                            ) : (
                              <InfiniMenu.Item
                                leftSection={<IconPlayerPause size={14} />}
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
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
                              leftSection={<TrashIcon size={14} />}
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleDelete(template); }}
                            >
                              {t("recurring.delete")}
                            </InfiniMenu.Item>
                          </InfiniMenu.Dropdown>
                        </InfiniMenu>
                      )}
                    </Group>
                  </Group>
                </div>
              </PortalCard>
            );
          })
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
