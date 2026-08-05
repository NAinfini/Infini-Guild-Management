import { ActionIcon, Select, TextInput, Tooltip } from "@mantine/core";
import { PinIcon, SearchIcon } from "@portal/components/icons";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
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
  const sortOptions = [
    { value: "updated_desc", label: t("filter.sort.updated_desc") },
    { value: "updated_asc", label: t("filter.sort.updated_asc") },
  ];
  const activeSummary = [
    search.trim()
      ? t("filter.summary.search", { value: search.trim() })
      : null,
    statusFilter
      ? t("filter.summary.status", {
          value: statusOptions.find((option) => option.value === statusFilter)?.label
            ?? statusFilter,
        })
      : null,
    pinnedFilter ? t("filter.summary.pinned") : null,
    sortOrder !== "updated_desc"
      ? t("filter.summary.sort", {
          value: sortOptions.find((option) => option.value === sortOrder)?.label
            ?? sortOrder,
        })
      : null,
  ].filter(Boolean).join(" · ");
  const activeFilterCount = [
    search.trim().length > 0,
    Boolean(statusFilter),
    pinnedFilter,
    sortOrder !== "updated_desc",
  ].filter(Boolean).length;

  return (
    <ContentFilterToolbar
      className="announcements-filter-toolbar"
      toggleLabel={t("common:filter.toggle")}
      activeSummary={activeSummary}
      activeFilterCount={activeFilterCount}
      collapseBelow={900}
      search={(
        <TextInput
          placeholder={t("filter.search")}
          aria-label={t("aria.searchAnnouncements")}
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          leftSection={<SearchIcon size={16} />}
        />
      )}
      controls={(
        <>
          <Select
            value={statusValue}
            onChange={(value) =>
              onStatusFilterChange(value === "all" ? undefined : value ?? undefined)
            }
            data={statusOptions}
            aria-label={t("filter.status")}
            allowDeselect={false}
          />
          <Select
            value={sortOrder}
            onChange={(value) => {
              if (value) onSortOrderChange(value as AnnouncementSort);
            }}
            data={sortOptions}
            aria-label={t("filter.sort")}
            allowDeselect={false}
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
      )}
    />
  );
}
