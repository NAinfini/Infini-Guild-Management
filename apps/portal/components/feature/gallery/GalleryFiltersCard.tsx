import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { ActionIcon, Button, Group, SegmentedControl, Select, Text, TextInput, Tooltip } from "@mantine/core";
import { IconCalendarOff } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { portalConfirm } from "../../../overlays";

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
  canUpload: boolean;
  isDragOver: boolean;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onSelectFiles: (files: FileList | null) => void;
  canModerate: boolean;
  selectedCount: number;
  onBulkDelete: () => void;
  bulkDeletePending: boolean;
  filterTypeLabel: string;
  dropzoneLabel: string;
  bulkDeleteLabel: string;
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
  canUpload,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onSelectFiles,
  canModerate,
  selectedCount,
  onBulkDelete,
  bulkDeletePending,
  filterTypeLabel,
  dropzoneLabel,
  bulkDeleteLabel,
}: GalleryFiltersCardProps) {
  const { t } = useTranslation("gallery");

  const handleBulkDeleteConfirm = async () => {
    const confirmed = await portalConfirm({
      title: t("confirm.bulkDelete.title"),
      description: t("confirm.bulkDelete.description", { count: selectedCount }),
      intent: "danger",
    });
    if (confirmed) {
      onBulkDelete();
    }
  };

  return (
    <InfiniCard>
      <div style={{ padding: "1.2rem" }}>
        <Group gap={8} wrap="wrap">
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
              { value: "desc", label: "Newest" },
              { value: "asc", label: "Oldest" },
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
          <Tooltip label="Clear Dates">
            <ActionIcon variant="subtle" onClick={onClearDates} disabled={!dateFrom && !dateTo} aria-label="Clear dates">
              <IconCalendarOff size={18} />
            </ActionIcon>
          </Tooltip>
          <TextInput
            style={{ width: 220 }}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search caption / uploader"
            aria-label="Search gallery caption or uploader"
          />

          {canUpload ? (
            <div
              className={`gallery-dropzone${isDragOver ? " gallery-dropzone--active" : ""}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <Text>{dropzoneLabel}</Text>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(event) => onSelectFiles(event.target.files)}
                aria-label="Select gallery images"
              />
            </div>
          ) : null}

          {canModerate ? (
            <Button
              color="red"
              loading={bulkDeletePending}
              disabled={selectedCount === 0}
              onClick={() => {
                void handleBulkDeleteConfirm();
              }}
            >
              {bulkDeleteLabel}
            </Button>
          ) : null}
        </Group>
      </div>
    </InfiniCard>
  );
}
