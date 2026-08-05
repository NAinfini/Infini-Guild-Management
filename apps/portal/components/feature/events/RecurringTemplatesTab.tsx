import { DEFAULT_GAME_RULES, type RecurringTemplate } from "@guild/shared";
import { utcWeekdayToLocal } from "@guild/shared/utils/recurrence";
import { tzOffsetToAnchorIso, buildFormState, computeNextLifecyclePreview, formatLifecycleDate, utcTimeToLocalTime } from "./RecurringTemplateFormModal.helpers";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { CalendarRepeatIcon, CircleCheckIcon, ClockIcon, PauseIcon, SearchIcon, UsersIcon } from "@portal/components/icons";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import {
  Badge,
  Button,
  Group,
  HoverCard,
  Paper,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { useCallback, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  RecurringTemplateFormModal,
  type RecurringTemplateFormPayload,
} from "./RecurringTemplateFormModal";
import { EventsViewSwitcher } from "./EventsViewSwitcher";
import { type EventWorkbenchViewMode } from "../../../utils/event-navigation";
import { getEventTypeLabel } from "@portal/utils/game-rules";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;
type TemplateStatusFilter = "all" | "active" | "paused";

function buildRecurrenceSummary(
  t: (key: string, opts?: Record<string, unknown>) => string,
  rule: RecurringTemplate["recurrence_rule"],
  startTime: string,
): string {
  if (!rule) return "";
  const freq = rule.frequency;
  const interval = rule.interval ?? 1;
  if (freq === "daily") {
    return t("recurring.summary.daily", { interval });
  }
  if (freq === "weekly") {
    // start_time is stored as UTC; anchor on that UTC instant for the
    // UTC→local weekday conversion.
    const anchorIso = tzOffsetToAnchorIso(0, startTime);
    const dayNames = (rule.daysOfWeek ?? [])
      .map((d) => utcWeekdayToLocal(d, anchorIso))
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
  /*
   * 卡片 / 月 / 周期 的切换器由这条筛选栏承载：模板档不渲染 EventsFiltersCard，
   * 否则页面上就是上下两条工具栏。必填而不是可选，是因为它是退出模板档的唯一入口，
   * 漏传的结果是用户进得来出不去，而这种缺失在类型上必须能被发现。
   */
  onViewModeChange: (value: EventWorkbenchViewMode) => void;
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
  onViewModeChange,
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
  const gameRules = DEFAULT_GAME_RULES;
  const confirm = useConfirmDialog();

  const [formOpen, formHandlers] = useDisclosure(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TemplateStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase(i18n.language);

    return templates.filter((template) => {
      if (statusFilter === "active" && template.paused) return false;
      if (statusFilter === "paused" && !template.paused) return false;
      if (typeFilter && template.type !== typeFilter) return false;
      if (!normalizedSearch) return true;

      return [template.title, template.description ?? ""]
        .some((value) => value.toLocaleLowerCase(i18n.language).includes(normalizedSearch));
    });
  }, [i18n.language, searchQuery, statusFilter, templates, typeFilter]);

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== "all" || typeFilter !== null;
  const activeFilterCount = [
    searchQuery.trim().length > 0,
    statusFilter !== "all",
    typeFilter !== null,
  ].filter(Boolean).length;
  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setTypeFilter(null);
  };

  const handleCreate = useCallback(() => {
    setFormMode("create");
    setEditingTemplate(null);
    formHandlers.open();
  }, []);

  const handleEdit = useCallback((template: RecurringTemplate) => {
    setFormMode("edit");
    setEditingTemplate(template);
    formHandlers.open();
  }, []);

  const handleDelete = useCallback(
    async (template: RecurringTemplate) => {
      const accepted = await confirm({
        title: t("recurring.confirm.delete.title"),
        description: (
          <Text size="sm">{t("recurring.confirm.delete.description", { title: template.title })}</Text>
        ),
        confirmLabel: t("common:action.confirm"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (accepted) await onDeleteTemplate(template.id);
    },
    [confirm, onDeleteTemplate, t],
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

  const viewSwitcher = (
    <EventsViewSwitcher viewMode="recurring" canManage={canManage} onViewModeChange={onViewModeChange} />
  );

  /*
   * 加载中也要留着切换器：模板列表可能拉很久，这段时间里它是唯一的退出路径，
   * 一起换成骨架屏就等于把人锁在一屏骨架里。
   */
  if (loading) {
    return (
      <Stack gap={12}>
        <Paper withBorder radius="md" p="sm">
          {viewSwitcher}
        </Paper>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={80} radius={8} />
        ))}
      </Stack>
    );
  }

  const searchControl = (
    <TextInput
      value={searchQuery}
      onChange={(event) => setSearchQuery(event.currentTarget.value)}
      placeholder={t("recurring.filter.search")}
      aria-label={t("recurring.filter.search")}
      leftSection={<SearchIcon size={16} />}
      className="recurring-template-filter-search"
    />
  );
  const filterControls = (
    <>
      <SegmentedControl
        value={statusFilter}
        onChange={(value) => setStatusFilter(value as TemplateStatusFilter)}
        data={[
          { value: "all", label: t("recurring.filter.all") },
          { value: "active", label: t("recurring.status.active") },
          { value: "paused", label: t("recurring.status.paused") },
        ]}
        aria-label={t("recurring.filter.status")}
        className="recurring-template-filter-status"
      />
      <Select
        clearable
        value={typeFilter}
        onChange={setTypeFilter}
        placeholder={t("recurring.filter.type")}
        aria-label={t("recurring.filter.type")}
        data={gameRules.events.types
          .filter((definition) => definition.enabled)
          .map((definition) => ({
            value: definition.id,
            label: getEventTypeLabel(definition.id, i18n.language, gameRules),
          }))}
        className="recurring-template-filter-type"
      />
    </>
  );

  return (
    <>
      <Stack gap={12}>
        {/*
          * 这条工具栏跟活动档那条（EventsFiltersCard）共用同一套渐进披露：搜索、
          * 视图切换和新建始终可见，状态与类型只在容器足够宽时内联。
          * 没有模板时只留切换器：筛一个空列表没有意义，但切换器是退出模板档的唯一
          * 入口，跟着一起消失就是进得来出不去。
          */}
        {templates.length > 0 ? (
          <ContentFilterToolbar
            search={searchControl}
            controls={filterControls}
            primary={(
              <>
                {viewSwitcher}
                {canManage ? (
                  <Button size="sm" onClick={handleCreate}>
                    {t("recurring.create")}
                  </Button>
                ) : null}
              </>
            )}
            toggleLabel={t("common:filter.toggle")}
            activeFilterCount={activeFilterCount}
            collapseBelow={1120}
          />
        ) : (
          <Paper withBorder radius="md" p="sm">{viewSwitcher}</Paper>
        )}
        {templates.length === 0 ? (
          <Paper withBorder radius="md">
            <div>
              <Stack align="center" gap={8} py={40} px={16}>
              <CalendarRepeatIcon size={40} style={{ opacity: 0.3 }} />
              <Text c="dimmed" size="sm">{t("recurring.empty")}</Text>
              {canManage ? (
                <Button size="sm" onClick={handleCreate}>
                  {t("recurring.create")}
                </Button>
              ) : null}
              </Stack>
            </div>
          </Paper>
        ) : filteredTemplates.length === 0 ? (
          <Paper withBorder radius="md">
            <Stack align="center" gap={8} py={40} px={16}>
              <CalendarRepeatIcon size={40} style={{ opacity: 0.3 }} />
              <Text c="dimmed" size="sm">{t("recurring.emptyFiltered")}</Text>
              {hasActiveFilters ? (
                <Button size="sm" variant="default" onClick={resetFilters}>
                  {t("recurring.filter.reset")}
                </Button>
              ) : null}
            </Stack>
          </Paper>
        ) : (
          filteredTemplates.map((template) => {
            const isPaused = template.paused;
            const typeDef = gameRules.events.types.find((definition) => definition.id === template.type);
            const time = template.start_time ? utcTimeToLocalTime(template.start_time) : "--:--";
            const lifecycle = isPaused ? null : computeNextLifecyclePreview(buildFormState(template), template, "edit");
            const lang = i18n.language;
            return (
              <Paper
                key={template.id}
                withBorder
                radius="md"
                /* Dimming the whole row dragged every label to ~2.3:1. The
                   "paused" badge already says it, so the row stays readable. */
                style={{ position: "relative" }}
              >
                {canManage ? (
                  <UnstyledButton
                    type="button"
                    aria-label={t("recurring.editAria", { title: template.title })}
                    onClick={() => handleEdit(template)}
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 1,
                      borderRadius: "inherit",
                      cursor: "pointer",
                    }}
                  />
                ) : null}
                <div style={{ padding: "12px 16px", position: "relative", zIndex: 2, pointerEvents: "none" }}>
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <Group gap={12} align="center" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                      <div className="recurring-template-icon-wrap">
                        <CalendarRepeatIcon
                          size={20}
                          className={`recurring-template-icon${isPaused ? " recurring-template-icon--paused" : ""}`}
                        />
                      </div>

                      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={8} align="center" wrap="nowrap">
                          <Text fw={600} size="sm" truncate style={{ maxWidth: "100%" }}>
                            {template.title}
                          </Text>
                          {typeDef && (
                            <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                              {getEventTypeLabel(typeDef.id, i18n.language, gameRules)}
                            </Badge>
                          )}
                          <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                            <HoverCard.Target>
                              <UnstyledButton
                                type="button"
                                aria-label={isPaused ? t("recurring.status.paused") : t("recurring.status.active")}
                                style={{ flexShrink: 0, pointerEvents: "auto" }}
                              >
                                <Badge
                                  size="xs"
                                  variant="light"
                                  color={isPaused ? "gray" : "green"}
                                  data-animate-icon-trigger
                                >
                                  {isPaused ? t("recurring.status.paused") : t("recurring.status.active")}
                                </Badge>
                              </UnstyledButton>
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
                            {buildRecurrenceSummary(t, template.recurrence_rule, template.start_time)}
                          </Text>
                          {template.capacity != null && (
                            <Group gap={4} align="center">
                              <UsersIcon size={13} style={{ opacity: 0.5 }} />
                              <Text size="xs" c="dimmed">{template.capacity}</Text>
                            </Group>
                          )}
                        </Group>

                        {lifecycle && (
                          <Group gap={14} wrap="wrap" mt={4}>
                            <Text size="xs" className="recurring-template-lifecycle-muted">
                              <Text span fw={600} size="xs">{t("recurring.lifecycle.nextCreation")}</Text>
                              {" "}{formatLifecycleDate(lifecycle.creationTime, lang)}
                            </Text>
                            <Text size="xs" fw={500} className="recurring-template-lifecycle-accent">
                              <Text span fw={700} size="xs" className="recurring-template-lifecycle-accent">{t("recurring.lifecycle.nextStart")}</Text>
                              {" "}{formatLifecycleDate(lifecycle.startTime, lang)}
                            </Text>
                            {lifecycle.endTime && (
                              <Text size="xs" className="recurring-template-lifecycle-muted">
                                <Text span fw={600} size="xs">{t("recurring.lifecycle.nextEnd")}</Text>
                                {" "}{formatLifecycleDate(lifecycle.endTime, lang)}
                              </Text>
                            )}
                          </Group>
                        )}
                      </Stack>
                    </Group>

                    <Group gap={12} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                      {template.last_generated_date && (
                        <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                          <HoverCard.Target>
                            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap", pointerEvents: "auto" }}>
                              {t("recurring.generated", { count: template.generation_count })}
                            </Text>
                          </HoverCard.Target>
                          <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                            <Group gap={10} wrap="nowrap" align="flex-start">
                              <ThemeIcon variant="light" color="gray" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
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
              </Paper>
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
