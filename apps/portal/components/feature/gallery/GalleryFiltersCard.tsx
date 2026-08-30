import { SearchIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import {
  ContentFilterGroup,
  ContentFilterOption,
  ContentFilterToolbar,
} from "@portal/components/shared/ContentFilterToolbar";
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

type FilterOption = {
  value: "all" | "image" | "video" | "desc" | "asc";
  label: string;
};

function GalleryFilterRadioOption({ option }: { option: FilterOption }) {
  return (
    <ContentFilterOption>
      <RadioGroupItem value={option.value} />
      <span>{option.label}</span>
    </ContentFilterOption>
  );
}

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
    <InputGroup className="gallery-filters__search">
      <InputGroupAddon><SearchIcon size={16} aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput
        value={search}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        placeholder={t("filter.searchPlaceholder")}
        aria-label={t("aria.searchTitle")}
      />
      {search ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label={t("common:action.clear")} onClick={() => onSearchChange("")} size="icon-xs">
            <XIcon size={14} aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
  const filters = (
    <div className="gallery-filters__controls">
      <ContentFilterGroup label={filterTypeLabel}>
        <RadioGroup
          value={typeFilter ?? "all"}
          onValueChange={(value) => onTypeFilterChange(value === "all" ? undefined : value as "image" | "video")}
          aria-label={t("aria.filterByType")}
          className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
        >
          <GalleryFilterRadioOption option={{ value: "all", label: t("filter.all") }} />
          <GalleryFilterRadioOption option={{ value: "image", label: t("type.image") }} />
          <GalleryFilterRadioOption option={{ value: "video", label: t("type.video") }} />
        </RadioGroup>
      </ContentFilterGroup>
      <ContentFilterGroup label={t("filter.sort")}>
        <RadioGroup
          value={sortOrder}
          onValueChange={(value) => onSortOrderChange(value as "desc" | "asc")}
          aria-label={t("filter.sort")}
          className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
        >
          <GalleryFilterRadioOption option={{ value: "desc", label: t("sort.newest") }} />
          <GalleryFilterRadioOption option={{ value: "asc", label: t("sort.oldest") }} />
        </RadioGroup>
      </ContentFilterGroup>
      <ContentFilterGroup label={t("filter.dateRange")}>
        <div className="content-filter-toolbar__date-fields">
          <NativeDateTimeInput
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.currentTarget.value)}
            placeholder={t("filter.dateFromPlaceholder")}
            aria-label={t("aria.dateFrom")}
          />
          <NativeDateTimeInput
            value={dateTo}
            onChange={(event) => onDateToChange(event.currentTarget.value)}
            placeholder={t("filter.dateToPlaceholder")}
            aria-label={t("aria.dateTo")}
          />
        </div>
      </ContentFilterGroup>
    </div>
  );
  const actions = (
    (canModerate || canUpload) ? (
      <div className="gallery-filters__actions">
        {canModerate ? (
          <Button
            onClick={() => { void handleBulkDeleteConfirm(); }}
            variant="destructive"
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
      </div>
    ) : null
  );

  return (
    <ContentFilterToolbar
      className="gallery-filters"
      search={primary}
      filterControls={filters}
      actions={actions}
      filterLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      resetLabel={t("common:filter.reset")}
      onReset={() => {
        onTypeFilterChange(undefined);
        onSortOrderChange("desc");
        onClearDates();
      }}
    />
  );
}
