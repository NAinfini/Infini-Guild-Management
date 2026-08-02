import { EVENT_TYPES } from "@guild/shared";
import { ActionIcon, Box, Button, Collapse, Flex, Group, Paper, SegmentedControl, Select, Stack, TextInput, Tooltip } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { LockIcon, PinIcon, SearchIcon } from "@portal/components/icons";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { type EventStatusFilter, type EventTypeFilter, type EventWorkbenchViewMode } from "../../../utils/event-navigation";

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
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);
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
          data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
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
        <SegmentedControl
          value={viewMode}
          onChange={(value) => onViewModeChange(value as EventWorkbenchViewMode)}
          data={[
            { value: "cards", label: t("view.cards") },
            { value: "month", label: t("view.calendar") },
          ]}
          className="events-filter-view"
        />
  );
  const actions = (
        canManage && onCreateEvent ? (
          <Button
            onClick={onCreateEvent}
            size="sm"
            style={isMobile ? { minHeight: 44, flexShrink: 0 } : undefined}
          >
            {t("button.create")}
          </Button>
        ) : null
  );

  return (
    <Paper withBorder radius="md" p="sm">
      {isMobile ? (
        <Stack gap={0}>
          <Group gap="xs" wrap="nowrap" align="center">
            <Box style={{ flex: 1, minWidth: 0 }}>{primary}</Box>
            {actions}
            <ActionIcon
              variant={filtersOpen ? "filled" : "default"}
              size="lg"
              onClick={toggleFilters}
              aria-label={t("common:filter.toggle")}
            >
              <IconAdjustmentsHorizontal size={18} />
            </ActionIcon>
          </Group>
          <Collapse in={filtersOpen}>
            <Stack gap="sm" pt="sm">
              <Group gap="xs" wrap="wrap">
                {filters}
              </Group>
              {viewControls}
            </Stack>
          </Collapse>
        </Stack>
      ) : (
        <Flex gap="sm" align="center" wrap="wrap">
          <Box style={{ flex: "1 1 240px", minWidth: 220 }}>{primary}</Box>
          <Group gap="xs" wrap="wrap">
            {filters}
          </Group>
          {viewControls}
          {actions ? <Box style={{ marginLeft: "auto" }}>{actions}</Box> : null}
        </Flex>
      )}
    </Paper>
  );
}
