import { DepthToggle, InfiniCard } from "@infini-dev-kit/frontend/components";
import { Button, Group, TextInput, Tooltip } from "@mantine/core";
import { IconArchive, IconCalendarTime, IconFileText, IconPin, IconPlus } from "@tabler/icons-react";
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
  onCreate?: () => void;
};

export function AnnouncementFiltersCard({
  listScope,
  status,
  search,
  canEdit,
  onListScopeChange,
  onStatusChange,
  onSearchChange,
  onCreate,
}: AnnouncementFiltersCardProps) {
  const { t } = useTranslation("announcements");
  const isPinned = listScope === "pinned";
  const isArchived = listScope === "archived";

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
              pressed={isPinned}
              onToggle={() => onListScopeChange(isPinned ? "all" : "pinned")}
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
              pressed={isArchived}
              onToggle={() => onListScopeChange(isArchived ? "all" : "archived")}
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
                  pressed={status === "draft"}
                  onToggle={() => onStatusChange(status === "draft" ? undefined : "draft")}
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
                  pressed={status === "scheduled"}
                  onToggle={() => onStatusChange(status === "scheduled" ? undefined : "scheduled")}
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
          {canEdit && onCreate ? (
            <Button
              size="compact-sm"
              leftSection={<IconPlus size={14} />}
              onClick={onCreate}
              style={{ marginInlineStart: "auto" }}
            >
              {t("action.create")}
            </Button>
          ) : null}
        </Group>
      </div>
    </InfiniCard>
  );
}
