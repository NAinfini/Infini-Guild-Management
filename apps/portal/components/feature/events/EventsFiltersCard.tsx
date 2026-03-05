import { EVENT_TYPES } from "@guild/shared";
import { DepthToggle } from "@infini-dev-kit/frontend/components";
import { SegmentedControl, Select } from "@mantine/core";
import { IconArchive } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { FilterToolbar } from "../../shared/FilterToolbar";

type EventViewMode = "cards" | "month";

type EventsFiltersCardProps = {
  eventType: string | undefined;
  archivedOnly: boolean;
  viewMode: EventViewMode;
  onEventTypeChange: (value: string | undefined) => void;
  onArchivedOnlyChange: (value: boolean) => void;
  onViewModeChange: (value: EventViewMode) => void;
};

export function EventsFiltersCard({
  eventType,
  archivedOnly,
  viewMode,
  onEventTypeChange,
  onArchivedOnlyChange,
  onViewModeChange,
}: EventsFiltersCardProps) {
  const { t } = useTranslation("events");

  return (
    <FilterToolbar className="events-filter-card" contentClassName="events-filter-controls">
        <Select
          clearable
          placeholder={t("filter.type")}
          value={eventType ?? null}
          aria-label="Filter events by type"
          onChange={(value) => onEventTypeChange(value ?? undefined)}
          data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
          className="events-filter-type"
        />
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
        <SegmentedControl
          value={viewMode}
          onChange={(value) => onViewModeChange(value as EventViewMode)}
          data={[
            { value: "cards", label: t("view.cards") },
            { value: "month", label: t("view.calendar") },
          ]}
        />
    </FilterToolbar>
  );
}

