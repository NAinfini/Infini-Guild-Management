import { DepthToggle, InfiniCard } from "@infini-dev-kit/frontend/components";
import { Group, TextInput } from "@mantine/core";
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

  const handleStatusToggle = (value: string, nextPressed: boolean) => {
    onStatusFilterChange(nextPressed ? value : undefined);
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
          <DepthToggle
            pressed={pinnedFilter}
            onToggle={onPinnedFilterChange}
            type="secondary"
            size="sm"
            iconOnly
            aria-label={t("filter.pinned")}
            title={t("filter.pinned")}
          >
            <IconPin size={16} />
          </DepthToggle>
          <DepthToggle
            pressed={statusFilter === "archived"}
            onToggle={(nextPressed) => handleStatusToggle("archived", nextPressed)}
            type="secondary"
            size="sm"
            iconOnly
            aria-label={t("filter.archived")}
            title={t("filter.archived")}
          >
            <IconArchive size={16} />
          </DepthToggle>
          {canEdit ? (
            <>
              <DepthToggle
                pressed={statusFilter === "draft"}
                onToggle={(nextPressed) => handleStatusToggle("draft", nextPressed)}
                type="secondary"
                size="sm"
                iconOnly
                aria-label={t("filter.draft")}
                title={t("filter.draft")}
              >
                <IconFileText size={16} />
              </DepthToggle>
              <DepthToggle
                pressed={statusFilter === "scheduled"}
                onToggle={(nextPressed) => handleStatusToggle("scheduled", nextPressed)}
                type="secondary"
                size="sm"
                iconOnly
                aria-label={t("filter.scheduled")}
                title={t("filter.scheduled")}
              >
                <IconCalendarTime size={16} />
              </DepthToggle>
            </>
          ) : null}
        </Group>
      </div>
    </InfiniCard>
  );
}
