import { DepthToggle, InfiniCard } from "@infini-dev-kit/frontend/components";
import { Group, TextInput, Tooltip } from "@mantine/core";
import { IconArchive, IconCalendarTime, IconFileText, IconPin } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

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

  const toggleStatus = (value: string) => {
    onStatusFilterChange(statusFilter === value ? undefined : value);
  };

  return (
    <InfiniCard interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Group gap={8} wrap="wrap" align="center">
          <TextInput
            className="announcements-filter-search"
            placeholder={t("filter.search")}
            aria-label="Search announcements"
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
          <Tooltip label={t("filter.pinned")} withArrow>
            <DepthToggle
              pressed={pinnedFilter}
              onToggle={onPinnedFilterChange}
              type="secondary"
              size="sm"
              iconOnly
              aria-label={t("filter.pinned")}
            >
              <IconPin size={16} />
            </DepthToggle>
          </Tooltip>
          <Tooltip label={t("filter.archived")} withArrow>
            <DepthToggle
              pressed={statusFilter === "archived"}
              onToggle={() => toggleStatus("archived")}
              type="secondary"
              size="sm"
              iconOnly
              aria-label={t("filter.archived")}
            >
              <IconArchive size={16} />
            </DepthToggle>
          </Tooltip>
          {canEdit ? (
            <>
              <Tooltip label={t("filter.draft")} withArrow>
                <DepthToggle
                  pressed={statusFilter === "draft"}
                  onToggle={() => toggleStatus("draft")}
                  type="secondary"
                  size="sm"
                  iconOnly
                  aria-label={t("filter.draft")}
                >
                  <IconFileText size={16} />
                </DepthToggle>
              </Tooltip>
              <Tooltip label={t("filter.scheduled")} withArrow>
                <DepthToggle
                  pressed={statusFilter === "scheduled"}
                  onToggle={() => toggleStatus("scheduled")}
                  type="secondary"
                  size="sm"
                  iconOnly
                  aria-label={t("filter.scheduled")}
                >
                  <IconCalendarTime size={16} />
                </DepthToggle>
              </Tooltip>
            </>
          ) : null}
        </Group>
      </div>
    </InfiniCard>
  );
}
