import { SearchIcon, XIcon } from "@portal/components/icons";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Switch } from "@portal/components/ui/switch";
import {
  ContentFilterGroup,
  ContentFilterToolbar,
} from "@portal/components/shared/ContentFilterToolbar";
import { useTranslation } from "react-i18next";

type AnnouncementSort = "updated_desc" | "updated_asc";

type AnnouncementFiltersCardProps = {
  pinnedFilter: boolean;
  statusFilter: string | undefined;
  sortOrder: AnnouncementSort;
  search: string;
  canEdit: boolean;
  onPinnedFilterChange: (value: boolean) => void;
  onStatusFilterChange: (value: string | undefined) => void;
  onSortOrderChange: (value: AnnouncementSort) => void;
  onSearchChange: (value: string) => void;
};

type FilterOption = {
  value: string;
  label: string;
};

function FilterRadioOption({ option }: { option: FilterOption }) {
  return (
    <label className="announcement-filter-radio">
      <RadioGroupItem value={option.value} />
      <span>{option.label}</span>
    </label>
  );
}

export function AnnouncementFiltersCard({
  pinnedFilter,
  statusFilter,
  sortOrder,
  search,
  canEdit,
  onPinnedFilterChange,
  onStatusFilterChange,
  onSortOrderChange,
  onSearchChange,
}: AnnouncementFiltersCardProps) {
  const { t } = useTranslation("announcements");
  const statusValue = statusFilter ?? (canEdit ? "all" : "published");
  const statusOptions: FilterOption[] = canEdit
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
  const sortOptions: FilterOption[] = [
    { value: "updated_desc", label: t("filter.sort.updated_desc") },
    { value: "updated_asc", label: t("filter.sort.updated_asc") },
  ];
  const activeFilterCount = [
    Boolean(statusFilter),
    pinnedFilter,
    sortOrder !== "updated_desc",
  ].filter(Boolean).length;

  return (
    <ContentFilterToolbar
      className="announcements-filter-toolbar"
      filterLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      resetLabel={t("common:filter.reset")}
      onReset={() => {
        onStatusFilterChange(undefined);
        onSortOrderChange("updated_desc");
        onPinnedFilterChange(false);
      }}
      search={(
        <InputGroup className="announcement-filter-search">
          <InputGroupAddon>
            <SearchIcon size={16} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t("filter.search")}
            aria-label={t("aria.searchAnnouncements")}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
          {search ? (
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
      )}
      filterControls={(
        <>
          <ContentFilterGroup label={t("filter.status")}>
            <RadioGroup
              value={statusValue}
              onValueChange={(value) => onStatusFilterChange(value === "all" ? undefined : value)}
              aria-label={t("filter.status")}
              className="announcement-filter-options"
            >
              {statusOptions.map((option) => <FilterRadioOption key={option.value} option={option} />)}
            </RadioGroup>
          </ContentFilterGroup>

          <ContentFilterGroup label={t("filter.sort")}>
            <RadioGroup
              value={sortOrder}
              onValueChange={(value) => onSortOrderChange(value as AnnouncementSort)}
              aria-label={t("filter.sort")}
              className="announcement-filter-sort"
            >
              {sortOptions.map((option) => <FilterRadioOption key={option.value} option={option} />)}
            </RadioGroup>
          </ContentFilterGroup>

          <ContentFilterGroup label={t("filter.pinned")}>
            <label className="announcement-filter-switch">
              <Switch
                checked={pinnedFilter}
                onCheckedChange={(checked) => onPinnedFilterChange(checked)}
              />
              <span>{t("filter.pinned")}</span>
            </label>
          </ContentFilterGroup>
        </>
      )}
    />
  );
}
