import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Group, SegmentedControl, Select, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";

type AnnouncementListScope = "all" | "pinned" | "archived";

type AnnouncementFiltersCardProps = {
  listScope: AnnouncementListScope;
  status: string | undefined;
  search: string;
  canEdit: boolean;
  onListScopeChange: (value: AnnouncementListScope) => void;
  onStatusChange: (value: string | undefined) => void;
  onSearchChange: (value: string) => void;
};

export function AnnouncementFiltersCard({
  listScope,
  status,
  search,
  canEdit,
  onListScopeChange,
  onStatusChange,
  onSearchChange,
}: AnnouncementFiltersCardProps) {
  const { t } = useTranslation("announcements");

  return (
    <InfiniCard>
      <div style={{ padding: "1.2rem" }}>
        <Group gap={8} wrap="wrap">
          <SegmentedControl
            value={listScope}
            onChange={(value) => onListScopeChange(value as AnnouncementListScope)}
            data={[
              { label: "All", value: "all" },
              { label: "Pinned", value: "pinned" },
              { label: "Archived", value: "archived" },
            ]}
          />
          {canEdit ? (
            <Select
              clearable
              className="announcements-filter-status"
              value={status}
              placeholder={t("filter.status")}
              aria-label="Filter announcements by status"
              onChange={(value) => onStatusChange(value ?? undefined)}
              data={[
                { value: "draft", label: "draft" },
                { value: "scheduled", label: "scheduled" },
                { value: "published", label: "published" },
                { value: "archived", label: "archived" },
              ]}
            />
          ) : null}
          <TextInput
            className="announcements-filter-search"
            placeholder={t("filter.search")}
            aria-label="Search announcements"
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </Group>
      </div>
    </InfiniCard>
  );
}

