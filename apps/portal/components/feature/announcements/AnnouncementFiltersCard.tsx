import { ActionIcon, Box, Collapse, Flex, Group, Paper, SegmentedControl, Stack, TextInput, Tooltip } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { PinIcon, SearchIcon } from "@portal/components/icons";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

type AnnouncementFiltersCardProps = {
  pinnedFilter: boolean;
  statusFilter: string | undefined;
  search: string;
  canEdit: boolean;
  onPinnedFilterChange: (value: boolean) => void;
  onStatusFilterChange: (value: string | undefined) => void;
  onSearchChange: (value: string) => void;
};

export function AnnouncementFiltersCard({
  pinnedFilter,
  statusFilter,
  search,
  canEdit,
  onPinnedFilterChange,
  onStatusFilterChange,
  onSearchChange,
}: AnnouncementFiltersCardProps) {
  const { t } = useTranslation("announcements");
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);

  const statusValue = statusFilter ?? (canEdit ? "all" : "published");
  const statusOptions = canEdit
    ? [
        { value: "all", label: t("filter.status.all") },
        { value: "published", label: t("filter.published") },
        { value: "archived", label: t("filter.archived") },
        { value: "draft", label: t("filter.draft") },
        { value: "scheduled", label: t("filter.scheduled") },
      ]
    : [
        { value: "published", label: t("filter.published") },
        { value: "archived", label: t("filter.archived") },
      ];

  const primary = (
    <TextInput
      className="announcements-filter-search"
      placeholder={t("filter.search")}
      aria-label={t("aria.searchAnnouncements")}
      value={search}
      onChange={(event) => onSearchChange(event.currentTarget.value)}
      leftSection={<SearchIcon size={16} />}
    />
  );
  const filters = (
    <>
          <SegmentedControl
            value={statusValue}
            onChange={(value) => onStatusFilterChange(value === "all" ? undefined : value)}
            data={statusOptions}
            aria-label={t("filter.status")}
          />
          <Tooltip label={t("filter.pinned")}>
          <ActionIcon
            aria-pressed={pinnedFilter}
            onClick={() => onPinnedFilterChange(!pinnedFilter)}
            color="portal-brand"
            variant={pinnedFilter ? "light" : "default"}
            size="lg"
            aria-label={t("filter.pinned")}
          >
            <PinIcon size={16} />
          </ActionIcon>
          </Tooltip>
    </>
  );

  return (
    <Paper withBorder radius="md" p="sm">
      {isMobile ? (
        <Stack gap={0}>
          <Group gap="xs" wrap="nowrap" align="center">
            <Box style={{ flex: 1, minWidth: 0 }}>{primary}</Box>
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
            <Group gap="xs" wrap="wrap" pt="sm">
              {filters}
            </Group>
          </Collapse>
        </Stack>
      ) : (
        <Flex gap="sm" align="center" wrap="wrap">
          <Box style={{ flex: "1 1 280px", minWidth: 240 }}>{primary}</Box>
          <Group gap="xs" wrap="wrap">
            {filters}
          </Group>
        </Flex>
      )}
    </Paper>
  );
}
