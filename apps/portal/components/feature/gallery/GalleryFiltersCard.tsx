import { ActionIcon, Box, Button, Collapse, Flex, Group, HoverCard, Paper, SegmentedControl, Select, Stack, Text, TextInput, ThemeIcon } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { CalendarOffIcon } from "@portal/components/icons";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";

type GalleryFiltersCardProps = {
  typeFilter: "image" | "video" | undefined;
  onTypeFilterChange: (value: "image" | "video" | undefined) => void;
  sortOrder: "desc" | "asc";
  onSortOrderChange: (value: "desc" | "asc") => void;
  dateFrom: string;
  dateTo: string;
  search: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onClearDates: () => void;
  canModerate: boolean;
  canUpload: boolean;
  selectedCount: number;
  onBulkDelete: () => void;
  bulkDeletePending: boolean;
  onAddMedia: () => void;
  filterTypeLabel: string;
  bulkDeleteLabel: string;
  addMediaLabel: string;
};

export function GalleryFiltersCard({
  typeFilter,
  onTypeFilterChange,
  sortOrder,
  onSortOrderChange,
  dateFrom,
  dateTo,
  search,
  onDateFromChange,
  onDateToChange,
  onSearchChange,
  onClearDates,
  canModerate,
  canUpload,
  selectedCount,
  onBulkDelete,
  bulkDeletePending,
  onAddMedia,
  filterTypeLabel,
  bulkDeleteLabel,
  addMediaLabel,
}: GalleryFiltersCardProps) {
  const { t } = useTranslation("gallery");
  const confirm = useConfirmDialog();
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);

  const handleBulkDeleteConfirm = async () => {
    const confirmed = await confirm({
      title: t("confirm.bulkDelete.title"),
      description: t("confirm.bulkDelete.description", { count: selectedCount }),
      cancelLabel: t("common:action.cancel"),
      confirmLabel: t("common:action.confirm"),
      intent: "danger",
    });
    if (confirmed) {
      onBulkDelete();
    }
  };

  const primary = (
        <TextInput
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder={t("filter.searchPlaceholder")}
          aria-label={t("aria.searchCaption")}
        />
  );
  const filters = (
        <>
          <Select
            clearable
            placeholder={filterTypeLabel}
            style={{ width: 180 }}
            value={typeFilter ?? null}
            aria-label={t("aria.filterByType")}
            onChange={(value) => onTypeFilterChange((value as "image" | "video" | null) ?? undefined)}
            data={[
              { value: "image", label: t("type.image") },
              { value: "video", label: t("type.video") },
            ]}
          />
          <SegmentedControl
            value={sortOrder}
            onChange={(value) => onSortOrderChange(value as "desc" | "asc")}
            data={[
              { value: "desc", label: t("sort.newest") },
              { value: "asc", label: t("sort.oldest") },
            ]}
          />
          <Group gap={4} wrap="nowrap">
            <NativeDateTimeInput
              value={dateFrom}
              onChange={(event) => onDateFromChange(event.currentTarget.value)}
              style={{ width: 150 }}
              aria-label={t("aria.dateFrom")}
            />
            <NativeDateTimeInput
              value={dateTo}
              onChange={(event) => onDateToChange(event.currentTarget.value)}
              style={{ width: 150 }}
              aria-label={t("aria.dateTo")}
            />
            <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target>
                <ActionIcon variant="subtle" onClick={onClearDates} disabled={!dateFrom && !dateTo} aria-label={t("aria.clearDates")}>
                  <CalendarOffIcon size={18} />
                </ActionIcon>
              </HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="gray" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <CalendarOffIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3}>{t("hovercard.clearDates.title")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.clearDates.desc")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
          </Group>
        </>
  );
  const actions = (
        (canModerate || canUpload) ? (
          <Group gap={8} wrap="wrap">
            {canModerate ? (
              <Button
                onClick={() => { void handleBulkDeleteConfirm(); }}
                color="red"
                size="sm"
                disabled={selectedCount === 0 || bulkDeletePending}
              >
                {bulkDeleteLabel}
              </Button>
            ) : null}
            {canUpload ? (
              <Button onClick={onAddMedia} size="sm">
                {addMediaLabel}
              </Button>
            ) : null}
          </Group>
        ) : null
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
          <Collapse expanded={filtersOpen}>
            <Stack gap="sm" pt="sm">
              <Group gap="xs" wrap="wrap">
                {filters}
              </Group>
              {actions}
            </Stack>
          </Collapse>
        </Stack>
      ) : (
        <Flex gap="sm" align="center" wrap="wrap">
          <Box style={{ flex: "1 1 240px", minWidth: 220 }}>{primary}</Box>
          <Group gap="xs" wrap="wrap">
            {filters}
          </Group>
          {actions ? <Box style={{ marginLeft: "auto" }}>{actions}</Box> : null}
        </Flex>
      )}
    </Paper>
  );
}
