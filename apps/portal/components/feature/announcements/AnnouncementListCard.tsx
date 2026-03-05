import type { Announcement } from "@guild/shared";
import { PushpinOutlined } from "@portal/utils/icons";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Alert, Badge, Group, Indicator, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { IconArchive, IconCalendarTime, IconCircleCheck, IconFileText } from "@tabler/icons-react";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function statusIcon(value: Announcement["status"]): ReactNode {
  switch (value) {
    case "draft":
      return <IconFileText size={14} style={{ color: "var(--mantine-color-dimmed)" }} />;
    case "scheduled":
      return <IconCalendarTime size={14} style={{ color: "var(--mantine-color-infini-primary-filled)" }} />;
    case "published":
      return <IconCircleCheck size={14} style={{ color: "var(--mantine-color-infini-success-filled)" }} />;
    case "archived":
      return <IconArchive size={14} style={{ color: "var(--mantine-color-infini-danger-filled)" }} />;
    default:
      return null;
  }
}

type AnnouncementListCardProps = {
  title: ReactNode;
  rows: Announcement[];
  selectedId: string | null;
  canEdit: boolean;
  announcementsLastSeenAt: string | null;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  emptyText: ReactNode;
  onSelect: (id: string) => void;
};

export function AnnouncementListCard({
  title,
  rows,
  selectedId,
  canEdit,
  announcementsLastSeenAt,
  isLoading,
  isError,
  warningMessage,
  emptyText,
  onSelect,
}: AnnouncementListCardProps) {
  const { t } = useTranslation("announcements");
  return (
    <InfiniCard className="announcements-list-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={8}>
          <Text fw={600}>{title}</Text>
          {isLoading ? <Loader size="sm" /> : null}
          {isError ? <Alert color="infini-warning" title={warningMessage} /> : null}
          {!isLoading && !isError ? (
            rows.length > 0 ? (
              <Stack gap={8}>
                {rows.map((item) => (
                  <div key={item.id} className="announcements-list-row">
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-label={`Open announcement ${item.title}`}
                      aria-pressed={item.id === selectedId}
                      className={`announcement-item ${item.id === selectedId ? "announcement-item--active" : ""}`.trim()}
                    >
                      <Stack gap={2}>
                        <div className="announcement-item-title">
                          <Indicator
                            disabled={
                              !(Boolean(announcementsLastSeenAt) && Date.parse(item.updated_at) > Date.parse(announcementsLastSeenAt as string))
                            }
                            processing
                            size={8}
                            offset={4}
                          >
                            <Text fw={600}>{item.title}</Text>
                          </Indicator>
                          {item.pinned ? <PushpinOutlined className="announcement-item-pin" /> : null}
                          {canEdit ? (
                            <Tooltip label={t(`status.${item.status}`)} withArrow>
                              <span style={{ display: "inline-flex", lineHeight: 0 }}>{statusIcon(item.status)}</span>
                            </Tooltip>
                          ) : null}
                        </div>
                        <Group gap={8}>
                          {canEdit && item.status === "scheduled" && item.publish_at ? (
                            <Badge color="infini-primary">{t("meta.scheduled", { datetime: formatDateTime(item.publish_at) })}</Badge>
                          ) : null}
                        </Group>
                        <Text c="dimmed" size="sm" className="announcement-item-time">
                          {formatDateTime(item.updated_at)}
                        </Text>
                      </Stack>
                    </button>
                  </div>
                ))}
              </Stack>
            ) : (
              <>{emptyText}</>
            )
          ) : null}
        </Stack>
      </div>
    </InfiniCard>
  );
}

