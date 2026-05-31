import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { SegmentedControl, TextInput } from "@mantine/core";
import { PinIcon, SearchIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { FilterToolbar } from "../../shared/FilterToolbar";

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

  return (
    <FilterToolbar
      active={Boolean(search.trim()) || pinnedFilter || Boolean(statusFilter)}
      primary={
          <TextInput
            className="announcements-filter-search"
            placeholder={t("filter.search")}
            aria-label={t("aria.searchAnnouncements")}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            leftSection={<SearchIcon size={16} />}
          />
      }
      filters={
        <>
          <SegmentedControl
            value={statusValue}
            onChange={(value) => onStatusFilterChange(value === "all" ? undefined : value)}
            data={statusOptions}
            aria-label={t("filter.status")}
          />
          <DepthToggle
            pressed={pinnedFilter}
            onToggle={onPinnedFilterChange}
            type="primary"
            size="sm"
            iconOnly
            aria-label={t("filter.pinned")}
            tooltip={t("filter.pinned")}
          >
            <PinIcon size={16} />
          </DepthToggle>
        </>
      }
    />
  );
}
