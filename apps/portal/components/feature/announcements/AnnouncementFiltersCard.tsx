import { SearchIcon, XIcon } from "@portal/components/icons";
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
import { useTranslation } from "react-i18next";

type AnnouncementSort = "updated_desc" | "updated_asc";

type AnnouncementFiltersCardProps = {
  statusFilter: string | undefined;
  sortOrder: AnnouncementSort;
  search: string;
  canEdit: boolean;
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
    <ContentFilterOption>
      <RadioGroupItem value={option.value} />
      <span>{option.label}</span>
    </ContentFilterOption>
  );
}

export function AnnouncementFiltersCard({
  statusFilter,
  sortOrder,
  search,
  canEdit,
  onStatusFilterChange,
  onSortOrderChange,
  onSearchChange,
}: AnnouncementFiltersCardProps) {
  const { t } = useTranslation("announcements");
  const statusValue = statusFilter ?? (canEdit ? "all" : "published");
  const statusOptions: FilterOption[] = [
    { value: "all", label: t("filter.status.all") },
    { value: "published", label: t("filter.published") },
    { value: "archived", label: t("filter.archived") },
    { value: "draft", label: t("filter.draft") },
    { value: "scheduled", label: t("filter.scheduled") },
  ];
  const sortOptions: FilterOption[] = [
    { value: "updated_desc", label: t("filter.sort.updated_desc") },
    { value: "updated_asc", label: t("filter.sort.updated_asc") },
  ];
  const activeFilterCount = [
    canEdit && Boolean(statusFilter),
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
          {canEdit ? (
            <ContentFilterGroup label={t("filter.status")}>
              <RadioGroup
                value={statusValue}
                onValueChange={(value) => onStatusFilterChange(value === "all" ? undefined : value)}
                aria-label={t("filter.status")}
                className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
              >
                {statusOptions.map((option) => <FilterRadioOption key={option.value} option={option} />)}
              </RadioGroup>
            </ContentFilterGroup>
          ) : null}

          <ContentFilterGroup label={t("filter.sort")}>
            <RadioGroup
              value={sortOrder}
              onValueChange={(value) => onSortOrderChange(value as AnnouncementSort)}
              aria-label={t("filter.sort")}
              className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
            >
              {sortOptions.map((option) => <FilterRadioOption key={option.value} option={option} />)}
            </RadioGroup>
          </ContentFilterGroup>

        </>
      )}
    />
  );
}
