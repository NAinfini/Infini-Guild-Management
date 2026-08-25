import { DEFAULT_GAME_RULES, type RecurringTemplate } from "@guild/shared";
import { utcWeekdayToLocal } from "@guild/shared/utils/recurrence";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import { Label } from "@portal/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import {
  CalendarRepeatIcon,
  CircleCheckIcon,
  ClockIcon,
  PauseIcon,
  SearchIcon,
  XIcon,
  UsersIcon,
} from "@portal/components/icons";
import { ContentFilterGroup, ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { formatCalendarDate } from "../../../utils/datetime";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getEventTypeLabel } from "@portal/utils/game-rules";
import {
  buildFormState,
  computeNextLifecyclePreview,
  formatLifecycleDate,
  templateScheduleAnchor,
  utcClockToLocalAt,
} from "./RecurringTemplateForm.helpers";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;
type TemplateStatusFilter = "all" | "active" | "paused";

function buildRecurrenceSummary(
  t: (key: string, opts?: Record<string, unknown>) => string,
  rule: RecurringTemplate["recurrence_rule"],
  referenceDate: Date,
): string {
  if (rule.frequency === "daily") return t("recurring.summary.daily", { interval: rule.interval });
  if (rule.frequency === "weekly") {
    const anchorIso = new Date(referenceDate).toISOString();
    const dayNames = rule.daysOfWeek
      .map((day) => utcWeekdayToLocal(day, anchorIso))
      .sort((left, right) => left - right)
      .map((day) => t(WEEKDAY_KEYS[day] ?? "weekday.sun"))
      .join(", ");
    return t("recurring.summary.weekly", { interval: rule.interval, days: dayNames });
  }
  return t("recurring.summary.monthly", { interval: rule.interval, day: rule.dayOfMonth });
}

type RecurringTemplatesTabProps = {
  canManage: boolean;
  templates: RecurringTemplate[];
  loading: boolean;
  onCreateTemplate: () => void;
  onEditTemplate: (template: RecurringTemplate) => void;
};

export function RecurringTemplatesTab({ canManage, templates, loading, onCreateTemplate, onEditTemplate }: RecurringTemplatesTabProps) {
  const { t, i18n } = useTranslation("events");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TemplateStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const filteredTemplates = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase(i18n.language);
    return templates.filter((template) => {
      if (statusFilter === "active" && template.paused) return false;
      if (statusFilter === "paused" && !template.paused) return false;
      if (typeFilter && template.type !== typeFilter) return false;
      return !normalizedSearch || [template.title, template.description ?? ""].some((value) => value.toLocaleLowerCase(i18n.language).includes(normalizedSearch));
    });
  }, [i18n.language, searchQuery, statusFilter, templates, typeFilter]);
  const activeFilterCount = [statusFilter !== "all", typeFilter !== null].filter(Boolean).length;
  const hasActiveFilters = searchQuery.trim().length > 0 || activeFilterCount > 0;
  const resetFilters = () => { setSearchQuery(""); setStatusFilter("all"); setTypeFilter(null); };

  if (loading) return <div className="recurring-template-list recurring-template-list--loading">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div>;

  const searchControl = (
    <InputGroup className="recurring-template-filter-search">
      <InputGroupAddon>
        <SearchIcon size={16} aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.currentTarget.value)}
        placeholder={t("recurring.filter.search")}
        aria-label={t("recurring.filter.search")}
      />
      {searchQuery ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={t("common:action.clear")}
            onClick={() => setSearchQuery("")}
            size="icon-xs"
          >
            <XIcon size={14} aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
  const filterControls = <>
    <ContentFilterGroup label={t("recurring.filter.status")}>
      <div className="recurring-template-filter-status" role="group" aria-label={t("recurring.filter.status")}>
        {(["all", "active", "paused"] as const).map((value) => <Button key={value} size="sm" variant={statusFilter === value ? "default" : "ghost"} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{value === "all" ? t("recurring.filter.all") : t(`recurring.status.${value}`)}</Button>)}
      </div>
    </ContentFilterGroup>
    <ContentFilterGroup label={t("recurring.filter.type")}>
      <RadioGroup value={typeFilter ?? "all"} onValueChange={(value) => setTypeFilter(value === "all" ? null : value)} aria-label={t("recurring.filter.type")} className="recurring-template-type-options">
        <Label className="recurring-template-type-option"><RadioGroupItem value="all" />{t("recurring.filter.all")}</Label>
        {DEFAULT_GAME_RULES.events.types.filter((definition) => definition.enabled).map((definition) => <Label key={definition.id} className="recurring-template-type-option"><RadioGroupItem value={definition.id} />{getEventTypeLabel(definition.id, i18n.language)}</Label>)}
      </RadioGroup>
    </ContentFilterGroup>
  </>;

  return <div className="recurring-template-list">
    <ContentFilterToolbar search={searchControl} filterControls={filterControls} actions={canManage ? <Button size="sm" onClick={onCreateTemplate}>{t("recurring.create")}</Button> : null} filterLabel={t("common:filter.toggle")} activeFilterCount={activeFilterCount} resetLabel={t("common:filter.reset")} onReset={() => { setStatusFilter("all"); setTypeFilter(null); }} />
    {templates.length === 0 ? <EmptyTemplatesState label={t("recurring.empty")} /> : filteredTemplates.length === 0 ? <EmptyTemplatesState label={t("recurring.emptyFiltered")} action={hasActiveFilters ? <Button size="sm" variant="outline" onClick={resetFilters}>{t("recurring.filter.reset")}</Button> : null} /> : filteredTemplates.map((template) => <TemplateRow key={template.id} template={template} canManage={canManage} onEdit={onEditTemplate} />)}
  </div>;
}

function EmptyTemplatesState({ label, action }: { label: string; action?: ReactNode }) {
  return <Card className="recurring-template-empty"><CardContent><CalendarRepeatIcon size={40} aria-hidden="true" /><p>{label}</p>{action}</CardContent></Card>;
}

function TemplateRow({ template, canManage, onEdit }: { template: RecurringTemplate; canManage: boolean; onEdit: (template: RecurringTemplate) => void }) {
  const { t, i18n } = useTranslation("events");
  const isPaused = template.paused;
  const typeDef = DEFAULT_GAME_RULES.events.types.find((definition) => definition.id === template.type);
  const lifecycle = isPaused ? null : computeNextLifecyclePreview(buildFormState(template), template, "edit");
  const scheduleAnchor = lifecycle?.startTime ?? templateScheduleAnchor(template) ?? new Date();
  const time = template.start_time ? utcClockToLocalAt(template.start_time, scheduleAnchor) : "--:--";
  const statusTitle = isPaused ? t("tooltip.templatePaused.title") : t("tooltip.templateActive.title");
  const statusDescription = isPaused ? t("tooltip.templatePaused.desc") : t("tooltip.templateActive.desc");
  return <Card className="recurring-template-row">
    {canManage ? <button type="button" className="recurring-template-row__open" aria-label={t("recurring.editAria", { title: template.title })} onClick={() => onEdit(template)} /> : null}
    <CardContent className="recurring-template-row__content">
      <div className="recurring-template-icon-wrap"><CalendarRepeatIcon size={20} className={`recurring-template-icon${isPaused ? " recurring-template-icon--paused" : ""}`} /></div>
      <div className="recurring-template-row__body">
        <div className="recurring-template-row__title-row"><strong>{template.title}</strong>{typeDef ? <Badge variant="outline">{getEventTypeLabel(typeDef.id, i18n.language)}</Badge> : null}<Tooltip><TooltipTrigger render={<button type="button" aria-label={statusTitle} data-animate-icon-trigger className="recurring-template-status-trigger" />}><Badge variant={isPaused ? "outline" : "secondary"}>{isPaused ? t("recurring.status.paused") : t("recurring.status.active")}</Badge></TooltipTrigger><TooltipContent className="recurring-template-status-tooltip"><span>{isPaused ? <PauseIcon size={16} /> : <CircleCheckIcon size={16} />}</span><span><strong>{statusTitle}</strong><span>{statusDescription}</span></span></TooltipContent></Tooltip></div>
        <div className="recurring-template-row__meta"><span><ClockIcon size={13} />{time}</span><span>{buildRecurrenceSummary(t, template.recurrence_rule, scheduleAnchor)}</span>{template.capacity != null ? <span><UsersIcon size={13} />{template.capacity}</span> : null}</div>
        {lifecycle ? <div className="recurring-template-row__lifecycle"><span>{t("recurring.lifecycle.nextCreation")} {formatLifecycleDate(lifecycle.creationTime, i18n.language)}</span><strong>{t("recurring.lifecycle.nextStart")} {formatLifecycleDate(lifecycle.startTime, i18n.language)}</strong>{lifecycle.endTime ? <span>{t("recurring.lifecycle.nextEnd")} {formatLifecycleDate(lifecycle.endTime, i18n.language)}</span> : null}</div> : null}
      </div>
      {template.last_generated_date ? <Tooltip><TooltipTrigger render={<span className="recurring-template-row__generated" />}>{t("recurring.generated", { count: template.generation_count })}</TooltipTrigger><TooltipContent className="recurring-template-generated-tooltip"><strong>{t("recurring.hovercard.lastGenerated.title")}</strong><span>{t("recurring.lastGenerated", { date: formatCalendarDate(template.last_generated_date, i18n.language, "short") })}</span><span>{t("recurring.hovercard.lastGenerated.desc")}</span></TooltipContent></Tooltip> : null}
    </CardContent>
  </Card>;
}
