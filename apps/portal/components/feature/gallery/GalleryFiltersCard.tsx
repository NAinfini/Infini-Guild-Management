import { ActionIcon, Button, Group, HoverCard, SegmentedControl, Select, Text, TextInput, ThemeIcon } from "@mantine/core";
import { CalendarOffIcon } from "@portal/components/icons";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
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
  const activeFilterCount = [
    search.trim().length > 0,
    Boolean(typeFilter),
    sortOrder !== "desc",
    Boolean(dateFrom || dateTo),
  ].filter(Boolean).length;
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
      className="gallery-filters__search"
      value={search}
      onChange={(event) => onSearchChange(event.currentTarget.value)}
      placeholder={t("filter.searchPlaceholder")}
      aria-label={t("aria.searchCaption")}
    />
  );
  const filters = (
    <div className="gallery-filters__controls">
      <div className="gallery-filters__choice-row">
        <Select
          className="gallery-filters__type"
          clearable
          placeholder={filterTypeLabel}
          value={typeFilter ?? null}
          aria-label={t("aria.filterByType")}
          onChange={(value) => onTypeFilterChange((value as "image" | "video" | null) ?? undefined)}
          data={[
            { value: "image", label: t("type.image") },
            { value: "video", label: t("type.video") },
          ]}
        />
        <SegmentedControl
          className="gallery-filters__sort"
          value={sortOrder}
          onChange={(value) => onSortOrderChange(value as "desc" | "asc")}
          data={[
            { value: "desc", label: t("sort.newest") },
            { value: "asc", label: t("sort.oldest") },
          ]}
        />
      </div>
      <div className="gallery-filters__date-row">
        <NativeDateTimeInput
          className="gallery-filters__date"
          value={dateFrom}
          onChange={(event) => onDateFromChange(event.currentTarget.value)}
          placeholder={t("filter.dateFromPlaceholder")}
          aria-label={t("aria.dateFrom")}
        />
        <NativeDateTimeInput
          className="gallery-filters__date"
          value={dateTo}
          onChange={(event) => onDateToChange(event.currentTarget.value)}
          placeholder={t("filter.dateToPlaceholder")}
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
      </div>
    </div>
  );
  const actions = (
    (canModerate || canUpload) ? (
      <Group className="gallery-filters__actions" gap={8} wrap="wrap">
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
    <ContentFilterToolbar
      className="gallery-filters"
      search={primary}
      controls={filters}
      primary={actions}
      toggleLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      collapseBelow={1240}
    />
  );
}
