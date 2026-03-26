import { EVENT_TYPES } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { SegmentedControl, Select, TextInput } from "@mantine/core";
import { IconArchive, IconLock, IconPin, IconSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { type EventTypeFilter, type EventWorkbenchViewMode } from "../../../utils/event-navigation";
import { FilterToolbar } from "../../shared/FilterToolbar";

function isEventTypeFilter(value: string): value is EventTypeFilter {
  return EVENT_TYPES.includes(value as EventTypeFilter);
}

type EventsFiltersCardProps = {
  searchQuery: string;
  eventType: EventTypeFilter | undefined;
  archivedOnly: boolean;
  pinnedOnly: boolean;
  lockedOnly: boolean;
  viewMode: EventWorkbenchViewMode;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onEventTypeChange: (value: EventTypeFilter | undefined) => void;
  onArchivedOnlyChange: (value: boolean) => void;
  onPinnedOnlyChange: (value: boolean) => void;
  onLockedOnlyChange: (value: boolean) => void;
  onViewModeChange: (value: EventWorkbenchViewMode) => void;
  onCreateEvent?: () => void;
  onCreateTemplate?: () => void;
};

export function EventsFiltersCard({
  searchQuery,
  eventType,
  archivedOnly,
  pinnedOnly,
  lockedOnly,
  viewMode,
  canManage,
  onSearchChange,
  onEventTypeChange,
  onArchivedOnlyChange,
  onPinnedOnlyChange,
  onLockedOnlyChange,
  onViewModeChange,
  onCreateEvent,
  onCreateTemplate,
}: EventsFiltersCardProps) {
  const { t } = useTranslation("events");

  return (
    <FilterToolbar className="events-filter-card" contentClassName="events-filter-controls">
        <TextInput
          placeholder={t("filter.search")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          leftSection={<IconSearch size={16} />}
          className="events-filter-search"
          style={{ minWidth: 180 }}
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
        <DepthToggle
          pressed={pinnedOnly}
          onToggle={onPinnedOnlyChange}
          type="secondary"
          size="sm"
          iconOnly
          aria-label={t("filter.pinned")}
          tooltip={t("filter.pinned")}
        >
          <IconPin size={16} />
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
          <IconLock size={16} />
        </DepthToggle>
        <DepthToggle
          pressed={archivedOnly}
          onToggle={onArchivedOnlyChange}
          type="secondary"
          size="sm"
          iconOnly
          aria-label={t("filter.archived")}
          tooltip={t("filter.archived")}
        >
          <IconArchive size={16} />
        </DepthToggle>
        <SegmentedControl
          value={viewMode}
          onChange={(value) => onViewModeChange(value as EventWorkbenchViewMode)}
          data={[
            { value: "cards", label: t("view.cards") },
            { value: "month", label: t("view.calendar") },
            ...(canManage ? [{ value: "recurring", label: t("recurring.tab") }] : []),
          ]}
        />
        {canManage && (onCreateEvent || onCreateTemplate) ? (
          <div style={{ marginLeft: "auto" }}>
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
          </div>
        ) : null}
    </FilterToolbar>
  );
}
