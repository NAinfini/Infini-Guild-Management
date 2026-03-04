import { EVENT_TYPES } from "@guild/shared";
import { SegmentedControl, Select, Switch } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { FilterToolbar } from "../../shared/FilterToolbar";

type EventViewMode = "cards" | "month";

type EventsFiltersCardProps = {
  eventType: string | undefined;
  archivedOnly: boolean;
  viewMode: EventViewMode;
  showAvailabilityOverlay: boolean;
  onEventTypeChange: (value: string | undefined) => void;
  onArchivedOnlyChange: (value: boolean) => void;
  onViewModeChange: (value: EventViewMode) => void;
  onShowAvailabilityOverlayChange: (value: boolean) => void;
};

export function EventsFiltersCard({
  eventType,
  archivedOnly,
  viewMode,
  showAvailabilityOverlay,
  onEventTypeChange,
  onArchivedOnlyChange,
  onViewModeChange,
  onShowAvailabilityOverlayChange,
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
          data={EVENT_TYPES.map((value) => ({ value, label: value }))}
          className="events-filter-type"
        />
        <label className="events-inline-toggle">
          <Switch checked={archivedOnly} onChange={(event) => onArchivedOnlyChange(event.currentTarget.checked)} />
          <span>{t("filter.archived")}</span>
        </label>
        <SegmentedControl
          value={viewMode}
          onChange={(value) => onViewModeChange(value as EventViewMode)}
          data={[
            { value: "cards", label: t("view.cards") },
            { value: "month", label: t("view.calendar") },
          ]}
        />
        <label className="events-inline-toggle">
          <Switch
            checked={showAvailabilityOverlay}
            onChange={(event) => onShowAvailabilityOverlayChange(event.currentTarget.checked)}
          />
          <span>Availability overlay</span>
        </label>
    </FilterToolbar>
  );
}

