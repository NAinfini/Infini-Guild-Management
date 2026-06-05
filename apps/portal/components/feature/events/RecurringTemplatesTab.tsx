import type { RecurringTemplate } from "@guild/shared";
import { EVENT_TYPES } from "@guild/shared";
import { utcWeekdayToLocal } from "@guild/shared/utils/recurrence";
import { PortalCard } from "@portal/components/shared/PortalCard";
import { CalendarRepeatIcon, CircleCheckIcon, ClockIcon, PauseIcon, UsersIcon } from "@portal/components/icons";
import { Badge, Group, HoverCard, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { modals } from "@mantine/modals";
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
  startAtIso: string,
): string {
  if (!rule) return "";
  const freq = rule.frequency;
  const interval = rule.interval ?? 1;
  if (freq === "daily") {
    return t("recurring.summary.daily", { interval });
  }
  if (freq === "weekly") {
    const dayNames = (rule.daysOfWeek ?? [])
      .map((d) => utcWeekdayToLocal(d, startAtIso))
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
          <Text size="sm">{t("recurring.confirm.delete.description", { title: template.title })}</Text>
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
              <CalendarRepeatIcon size={40} style={{ opacity: 0.3 }} />
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
                            ? "color-mix(in srgb, var(--color-text, #1A1815) 6%, transparent)"
                            : "color-mix(in srgb, var(--color-primary, #D4A843) 10%, transparent)",
                          flexShrink: 0,
                        }}
                      >
                        <CalendarRepeatIcon
                          size={20}
                          style={{
                            color: isPaused ? "var(--color-text-muted, #6B665E)" : "var(--color-primary, #D4A843)",
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
                          <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                            <HoverCard.Target>
                              <Badge
                                size="xs"
                                variant="light"
                                color={isPaused ? "gray" : "green"}
                                style={{ flexShrink: 0 }}
                                data-animate-icon-trigger
                              >
                                {isPaused ? t("recurring.status.paused") : t("recurring.status.active")}
                              </Badge>
                            </HoverCard.Target>
                            <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                              <Group gap={10} wrap="nowrap" align="flex-start">
                                <ThemeIcon variant="light" color={isPaused ? "yellow" : "green"} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                                  {isPaused ? <PauseIcon size={16} /> : <CircleCheckIcon size={16} />}
                                </ThemeIcon>
                                <div style={{ minWidth: 0 }}>
                                  <Text size="sm" fw={700} lh={1.3} mb={4}>
                                    {isPaused ? t("tooltip.templatePaused.title") : t("tooltip.templateActive.title")}
                                  </Text>
                                  <Text size="xs" c="dimmed" lh={1.5}>
                                    {isPaused ? t("tooltip.templatePaused.desc") : t("tooltip.templateActive.desc")}
                                  </Text>
                                </div>
                              </Group>
                            </HoverCard.Dropdown>
                          </HoverCard>
                        </Group>

                        <Group gap={16} wrap="wrap">
                          <Group gap={4} align="center">
                            <ClockIcon size={13} style={{ opacity: 0.5 }} />
                            <Text size="xs" c="dimmed">{time}</Text>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {buildRecurrenceSummary(t, template.recurrence_rule, template.start_at)}
                          </Text>
                          {template.capacity != null && (
                            <Group gap={4} align="center">
                              <UsersIcon size={13} style={{ opacity: 0.5 }} />
                              <Text size="xs" c="dimmed">{template.capacity}</Text>
                            </Group>
                          )}
                        </Group>
                      </Stack>
                    </Group>

                    <Group gap={12} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                      {template.last_generated_date && (
                        <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                          <HoverCard.Target>
                            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                              {t("recurring.generated", { count: template.generation_count })}
                            </Text>
                          </HoverCard.Target>
                          <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                            <Group gap={10} wrap="nowrap" align="flex-start">
                              <ThemeIcon variant="light" color="yellow" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                                <ClockIcon size={16} />
                              </ThemeIcon>
                              <div style={{ minWidth: 0 }}>
                                <Text size="sm" fw={700} lh={1.3}>{t("recurring.hovercard.lastGenerated.title")}</Text>
                                <Text size="xs" c="dimmed" lh={1.5}>{t("recurring.lastGenerated", { date: new Date(template.last_generated_date).toLocaleDateString(i18n.language) })}</Text>
                                <Text size="xs" c="dimmed" lh={1.5}>{t("recurring.hovercard.lastGenerated.desc")}</Text>
                              </div>
                            </Group>
                          </HoverCard.Dropdown>
                        </HoverCard>
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
        onPause={onPauseTemplate}
        onResume={onResumeTemplate}
        onDelete={(id) => {
          const tpl = templates.find((t) => t.id === id);
          if (tpl) handleDelete(tpl);
        }}
      />
    </>
  );
}
