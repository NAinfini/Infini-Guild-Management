import { DEFAULT_GAME_RULES, findEventTypeDefinition } from "@guild/shared";
import { ActionIcon, Button, Group, SegmentedControl, Select, TextInput, Tooltip } from "@mantine/core";
import { LockIcon, PinIcon, SearchIcon } from "@portal/components/icons";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { useTranslation } from "react-i18next";
import { type EventStatusFilter, type EventTypeFilter, type EventWorkbenchViewMode } from "../../../utils/event-navigation";
import { EventsViewSwitcher } from "./EventsViewSwitcher";
import { getEventTypeLabel } from "@portal/utils/game-rules";

function isEventTypeFilter(value: string): value is EventTypeFilter {
  return Boolean(findEventTypeDefinition(DEFAULT_GAME_RULES, value)?.enabled);
}

type EventsFiltersCardProps = {
  searchQuery: string;
  eventType: EventTypeFilter | undefined;
  eventStatus: EventStatusFilter;
  pinnedOnly: boolean;
  lockedOnly: boolean;
  viewMode: EventWorkbenchViewMode;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onEventTypeChange: (value: EventTypeFilter | undefined) => void;
  onEventStatusChange: (value: EventStatusFilter) => void;
  onPinnedOnlyChange: (value: boolean) => void;
  onLockedOnlyChange: (value: boolean) => void;
  onViewModeChange: (value: EventWorkbenchViewMode) => void;
  onCreateEvent?: () => void;
};

export function EventsFiltersCard({
  searchQuery,
  eventType,
  eventStatus,
  pinnedOnly,
  lockedOnly,
  viewMode,
  canManage,
  onSearchChange,
  onEventTypeChange,
  onEventStatusChange,
  onPinnedOnlyChange,
  onLockedOnlyChange,
  onViewModeChange,
  onCreateEvent,
}: EventsFiltersCardProps) {
  const { t } = useTranslation("events");
  const activeFilterCount = [
    searchQuery.trim().length > 0,
    Boolean(eventType),
    eventStatus !== "active",
    pinnedOnly,
    lockedOnly,
  ].filter(Boolean).length;
  const primary = (
        <TextInput
          placeholder={t("filter.search")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          leftSection={<SearchIcon size={16} />}
          className="events-filter-search"
          aria-label={t("filter.search")}
        />
  );
  const filters = (
        <>
          <SegmentedControl
            value={eventStatus}
            onChange={(value) => onEventStatusChange(value as EventStatusFilter)}
            data={[
              { value: "active", label: t("filter.status.active") },
              { value: "archived", label: t("filter.status.archived") },
              { value: "all", label: t("filter.status.all") },
            ]}
            className="events-filter-status"
            aria-label={t("filter.status")}
          />
        <Select
          clearable
          placeholder={t("filter.type")}
          value={eventType ?? null}
          aria-label={t("aria.filterByType")}
          onChange={(value) => onEventTypeChange(value && isEventTypeFilter(value) ? value : undefined)}
          data={DEFAULT_GAME_RULES.events.types
            .filter((definition) => definition.enabled)
            .map((definition) => ({
              value: definition.id,
              label: getEventTypeLabel(definition.id),
            }))}
          className="events-filter-type"
        />
        <Group gap={6} wrap="nowrap" className="events-filter-toggles">
        <Tooltip label={t("filter.pinned")}>
        <ActionIcon
          aria-pressed={pinnedOnly}
          onClick={() => onPinnedOnlyChange(!pinnedOnly)}
          color="portal-brand"
          variant={pinnedOnly ? "light" : "default"}
          size="sm"
          aria-label={t("filter.pinned")}
        >
          <PinIcon size={16} />
        </ActionIcon>
        </Tooltip>
        <Tooltip label={t("filter.locked")}>
        <ActionIcon
          aria-pressed={lockedOnly}
          onClick={() => onLockedOnlyChange(!lockedOnly)}
          color="portal-brand"
          variant={lockedOnly ? "light" : "default"}
          size="sm"
          aria-label={t("filter.locked")}
        >
          <LockIcon size={16} />
        </ActionIcon>
        </Tooltip>
        </Group>
        </>
  );
  const viewControls = (
    <EventsViewSwitcher viewMode={viewMode} canManage={canManage} onViewModeChange={onViewModeChange} />
  );
  const actions = (
        canManage && onCreateEvent ? (
          <Button onClick={onCreateEvent} size="sm">
            {t("button.create")}
          </Button>
        ) : null
  );

  /*
   * 模板档不会走到这里：那一档的切换器挂在 RecurringTemplatesTab 自己那条筛选栏上，
   * EventsPage 直接不渲染这张卡。这里再渲染一次就是上下并排的两条工具栏，而且上面
   * 那条筛的是活动、按了对模板不起作用。
  */
  return (
    <ContentFilterToolbar
      search={primary}
      controls={filters}
      primary={(
        <>
          {viewControls}
          {actions}
        </>
      )}
      toggleLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      collapseBelow={1120}
    />
  );
}
