import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { ActionIcon, Button, Group, SegmentedControl, Select, TextInput, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconCalendarOff } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

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
        confirmProps: { color: "infini-danger" },
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

  return (
    <InfiniCard interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Group gap={8} wrap="wrap" className="gallery-filters-card__row">
          <Select
            clearable
            placeholder={filterTypeLabel}
            style={{ width: 180 }}
            value={typeFilter ?? null}
            aria-label="Filter gallery by type"
            onChange={(value) => onTypeFilterChange((value as "image" | "video" | null) ?? undefined)}
            data={[
              { value: "image", label: "image" },
              { value: "video", label: "video" },
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
          <TextInput
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.currentTarget.value)}
            style={{ width: 170 }}
            aria-label="Gallery date from"
          />
          <TextInput
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.currentTarget.value)}
            style={{ width: 170 }}
            aria-label="Gallery date to"
          />
          <Tooltip label={t("filter.clearDates")}>
            <ActionIcon variant="subtle" onClick={onClearDates} disabled={!dateFrom && !dateTo} aria-label="Clear dates">
              <IconCalendarOff size={18} />
            </ActionIcon>
          </Tooltip>
          <TextInput
            style={{ width: 220 }}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder={t("filter.searchPlaceholder")}
            aria-label="Search gallery caption or uploader"
          />
          <Group gap={8} wrap="wrap" className="gallery-filters-card__actions">
            {canModerate ? (
              <Button
                color="infini-danger"
                loading={bulkDeletePending}
                disabled={selectedCount === 0}
                onClick={() => {
                  void handleBulkDeleteConfirm();
                }}
              >
                {bulkDeleteLabel}
              </Button>
            ) : null}
            {canUpload ? <Button onClick={onAddMedia}>{addMediaLabel}</Button> : null}
          </Group>
        </Group>
      </div>
    </InfiniCard>
  );
}
