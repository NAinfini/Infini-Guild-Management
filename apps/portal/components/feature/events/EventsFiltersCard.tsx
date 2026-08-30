import { DEFAULT_GAME_RULES, findEventTypeDefinition } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Switch } from "@portal/components/ui/switch";
import { SearchIcon, XIcon } from "@portal/components/icons";
import {
  ContentFilterGroup,
  ContentFilterOption,
  ContentFilterToolbar,
} from "@portal/components/shared/ContentFilterToolbar";
import { useTranslation } from "react-i18next";
import { type EventListViewMode, type EventStatusFilter, type EventTypeFilter } from "../../../utils/event-navigation";
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
  viewMode: EventListViewMode;
  canCreate: boolean;
  onSearchChange: (value: string) => void;
  onEventTypeChange: (value: EventTypeFilter | undefined) => void;
  onEventStatusChange: (value: EventStatusFilter) => void;
  onPinnedOnlyChange: (value: boolean) => void;
  onLockedOnlyChange: (value: boolean) => void;
  onViewModeChange: (value: EventListViewMode) => void;
  onCreateEvent?: () => void;
};

export function EventsFiltersCard({
  searchQuery,
  eventType,
  eventStatus,
  pinnedOnly,
  lockedOnly,
  viewMode,
  canCreate,
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
    Boolean(eventType),
    eventStatus !== "active",
    pinnedOnly,
    lockedOnly,
  ].filter(Boolean).length;
  const primary = (
        <InputGroup className="events-filter-search">
          <InputGroupAddon>
          <SearchIcon size={16} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t("filter.search")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            aria-label={t("filter.search")}
          />
          {searchQuery ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t("common:action.clear")}
                onClick={() => onSearchChange("")}
                size="icon-xs"
              >
                <XIcon size={14} aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
  );
  const filters = (
        <>
          <ContentFilterGroup label={t("filter.status")}>
            <RadioGroup
              value={eventStatus}
              onValueChange={(value) => onEventStatusChange(value as EventStatusFilter)}
              aria-label={t("filter.status")}
              className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
            >
              {(["active", "archived", "all"] as const).map((value) => (
                <ContentFilterOption key={value}>
                  <RadioGroupItem value={value} />
                  <span>{t(`filter.status.${value}`)}</span>
                </ContentFilterOption>
              ))}
            </RadioGroup>
          </ContentFilterGroup>
          <ContentFilterGroup label={t("filter.type")}>
            <RadioGroup
              value={eventType ?? "all"}
              onValueChange={(value) => onEventTypeChange(value === "all" || !isEventTypeFilter(value) ? undefined : value)}
              aria-label={t("aria.filterByType")}
            >
              <div className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns">
                <ContentFilterOption><RadioGroupItem value="all" /><span>{t("filter.status.all")}</span></ContentFilterOption>
                {DEFAULT_GAME_RULES.events.types
                  .filter((definition) => definition.enabled)
                  .map((definition) => (
                    <ContentFilterOption key={definition.id}><RadioGroupItem value={definition.id} /><span>{getEventTypeLabel(definition.id)}</span></ContentFilterOption>
                  ))}
              </div>
            </RadioGroup>
          </ContentFilterGroup>
          <ContentFilterGroup label={t("filter.options")}>
            <div className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns">
              <ContentFilterOption><Switch checked={pinnedOnly} onCheckedChange={onPinnedOnlyChange} /><span>{t("filter.pinned")}</span></ContentFilterOption>
              <ContentFilterOption><Switch checked={lockedOnly} onCheckedChange={onLockedOnlyChange} /><span>{t("filter.locked")}</span></ContentFilterOption>
            </div>
          </ContentFilterGroup>
        </>
  );
  const viewControls = (
    <div className="events-filter-view-controls">
      <EventsViewSwitcher
        viewMode={viewMode === "month" ? "month" : "cards"}
        onViewModeChange={onViewModeChange}
      />
    </div>
  );
  const actions = (
        canCreate && onCreateEvent ? (
          <Button onClick={() => onCreateEvent()} size="sm">
            {t("button.create")}
          </Button>
        ) : null
  );

  return (
    <ContentFilterToolbar
      search={primary}
      filterControls={filters}
      view={viewControls}
      actions={actions}
      filterLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      resetLabel={t("common:filter.reset")}
      onReset={() => {
        onEventTypeChange(undefined);
        onEventStatusChange("active");
        onPinnedOnlyChange(false);
        onLockedOnlyChange(false);
      }}
    />
  );
}
