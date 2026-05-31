import { EVENT_TYPES } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { Group, SegmentedControl, Select, TextInput } from "@mantine/core";
import { LockIcon, PinIcon, SearchIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { type EventStatusFilter, type EventTypeFilter, type EventWorkbenchViewMode } from "../../../utils/event-navigation";
import { FilterToolbar } from "../../shared/FilterToolbar";

function isEventTypeFilter(value: string): value is EventTypeFilter {
  return EVENT_TYPES.includes(value as EventTypeFilter);
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
  onCreateTemplate?: () => void;
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
  onCreateTemplate,
}: EventsFiltersCardProps) {
  const { t } = useTranslation("events");
  const hasActiveFilters = Boolean(searchQuery.trim()) || Boolean(eventType) || eventStatus !== "active" || pinnedOnly || lockedOnly;

  return (
    <FilterToolbar
      className="events-filter-card"
      contentClassName="events-filter-controls"
      active={hasActiveFilters}
      primary={
        <TextInput
          placeholder={t("filter.search")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          leftSection={<SearchIcon size={16} />}
          className="events-filter-search"
          aria-label={t("filter.search")}
        />
      }
      filters={
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
          data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
          className="events-filter-type"
        />
        <Group gap={6} wrap="nowrap" className="events-filter-toggles">
        <DepthToggle
          pressed={pinnedOnly}
          onToggle={onPinnedOnlyChange}
          type="secondary"
          size="sm"
          iconOnly
          aria-label={t("filter.pinned")}
          tooltip={t("filter.pinned")}
        >
          <PinIcon size={16} />
        </DepthToggle>
        <DepthToggle
          pressed={lockedOnly}
          onToggle={onLockedOnlyChange}
          type="secondary"
          size="sm"
          iconOnly
          aria-label={t("filter.locked")}
          tooltip={t("filter.locked")}
        >
          <LockIcon size={16} />
        </DepthToggle>
        </Group>
        </>
      }
      viewControls={
        <SegmentedControl
          value={viewMode}
          onChange={(value) => onViewModeChange(value as EventWorkbenchViewMode)}
          data={[
            { value: "cards", label: t("view.cards") },
            { value: "month", label: t("view.calendar") },
            ...(canManage ? [{ value: "recurring", label: t("recurring.tab") }] : []),
          ]}
          className="events-filter-view"
        />
      }
      actions={
        canManage && (onCreateEvent || onCreateTemplate) ? (
          <>
            {viewMode !== "recurring" && onCreateEvent ? (
              <DepthButton onClick={onCreateEvent} type="primary" size="sm">
                {t("button.create")}
              </DepthButton>
            ) : null}
            {viewMode === "recurring" && onCreateTemplate ? (
              <DepthButton onClick={onCreateTemplate} type="primary" size="sm">
                {t("recurring.create")}
              </DepthButton>
            ) : null}
          </>
        ) : null
      }
    />
  );
}
