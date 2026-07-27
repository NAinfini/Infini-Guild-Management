import { DepthButton } from "@portal/components/shared/DepthButton";
import { ActionIcon, Group, HoverCard, SegmentedControl, Select, Text, TextInput, ThemeIcon } from "@mantine/core";
import { modals } from "@mantine/modals";
import { CalendarOffIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { FilterToolbar } from "../../shared/FilterToolbar";

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

  const handleBulkDeleteConfirm = async () => {
    const confirmed = await new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("confirm.bulkDelete.title"),
        children: t("confirm.bulkDelete.description", { count: selectedCount }),
        confirmProps: { color: "red" },
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        closeOnConfirm: true,
        closeOnCancel: true,
        centered: true,
      });
    });
    if (confirmed) {
      onBulkDelete();
    }
  };

  const hasActiveFilters = Boolean(typeFilter) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(search.trim());

  return (
    <FilterToolbar
      active={hasActiveFilters}
      primary={
        <TextInput
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder={t("filter.searchPlaceholder")}
          aria-label={t("aria.searchCaption")}
        />
      }
      filters={
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
            <TextInput
              type="date"
              value={dateFrom}
              onChange={(event) => onDateFromChange(event.currentTarget.value)}
              style={{ width: 150 }}
              aria-label={t("aria.dateFrom")}
            />
            <TextInput
              type="date"
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
      }
      actions={
        (canModerate || canUpload) ? (
          <Group gap={8} wrap="wrap">
            {canModerate ? (
              <DepthButton
                onClick={() => { void handleBulkDeleteConfirm(); }}
                type="danger"
                size="sm"
                disabled={selectedCount === 0 || bulkDeletePending}
              >
                {bulkDeleteLabel}
              </DepthButton>
            ) : null}
            {canUpload ? (
              <DepthButton onClick={onAddMedia} type="primary" size="sm">
                {addMediaLabel}
              </DepthButton>
            ) : null}
          </Group>
        ) : null
      }
    />
  );
}
