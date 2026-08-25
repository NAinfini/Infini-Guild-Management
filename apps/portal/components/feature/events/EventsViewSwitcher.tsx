import { Tabs, TabsList, TabsTrigger } from "@portal/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { type EventListViewMode } from "../../../utils/event-navigation";

type EventsViewSwitcherProps = {
  viewMode: EventListViewMode;
  onViewModeChange: (value: EventListViewMode) => void;
};

/* Cards and calendar are two presentations of the same filtered event result set. */
export function EventsViewSwitcher({ viewMode, onViewModeChange }: EventsViewSwitcherProps) {
  const { t } = useTranslation("events");

  return (
    <Tabs
      value={viewMode}
      onValueChange={(value) => onViewModeChange(value as EventListViewMode)}
      className="events-filter-view"
    >
      <TabsList aria-label={t("view.events")}>
        <TabsTrigger value="cards">{t("view.cards")}</TabsTrigger>
        <TabsTrigger value="month">{t("view.calendar")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
