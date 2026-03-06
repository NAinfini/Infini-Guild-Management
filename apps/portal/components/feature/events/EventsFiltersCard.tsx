import { EVENT_TYPES } from "@guild/shared";
import { DepthButton, DepthToggle } from "@infini-dev-kit/frontend/components";
import { SegmentedControl, Select, TextInput, Tooltip } from "@mantine/core";
import { IconArchive, IconLock, IconPin, IconSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { FilterToolbar } from "../../shared/FilterToolbar";

type EventViewMode = "cards" | "month" | "recurring";

type EventsFiltersCardProps = {
  searchQuery: string;
  eventType: string | undefined;
  archivedOnly: boolean;
  pinnedOnly: boolean;
  lockedOnly: boolean;
  viewMode: EventViewMode;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onEventTypeChange: (value: string | undefined) => void;
  onArchivedOnlyChange: (value: boolean) => void;
  onPinnedOnlyChange: (value: boolean) => void;
  onLockedOnlyChange: (value: boolean) => void;
  onViewModeChange: (value: EventViewMode) => void;
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
          aria-label="Filter events by type"
          onChange={(value) => onEventTypeChange(value ?? undefined)}
          data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
          className="events-filter-type"
        />
        <Tooltip label={t("filter.pinned")} withArrow>
          <DepthToggle
            pressed={pinnedOnly}
            onToggle={onPinnedOnlyChange}
            type="secondary"
            size="sm"
            iconOnly
            aria-label={t("filter.pinned")}
          >
            <IconPin size={16} />
          </DepthToggle>
        </Tooltip>
        <Tooltip label={t("filter.locked")} withArrow>
          <DepthToggle
            pressed={lockedOnly}
            onToggle={onLockedOnlyChange}
            type="secondary"
            size="sm"
            iconOnly
            aria-label={t("filter.locked")}
          >
            <IconLock size={16} />
          </DepthToggle>
        </Tooltip>
        <Tooltip label={t("filter.archived")} withArrow>
          <DepthToggle
            pressed={archivedOnly}
            onToggle={onArchivedOnlyChange}
            type="secondary"
            size="sm"
            iconOnly
            aria-label={t("filter.archived")}
          >
            <IconArchive size={16} />
          </DepthToggle>
        </Tooltip>
        <SegmentedControl
          value={viewMode}
          onChange={(value) => onViewModeChange(value as EventViewMode)}
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

