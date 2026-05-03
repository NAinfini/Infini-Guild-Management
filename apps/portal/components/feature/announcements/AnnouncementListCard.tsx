import type { Announcement } from "@guild/shared";
import { PushpinOutlined } from "@portal/utils/icons";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { Alert, Badge, Button, Group, Indicator, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { PlusIcon } from "@portal/components/icons";
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
      return <IconCalendarTime size={14} style={{ color: "var(--mantine-color-blue-filled)" }} />;
    case "published":
      return <IconCircleCheck size={14} style={{ color: "var(--mantine-color-green-filled)" }} />;
    case "archived":
      return <IconArchive size={14} style={{ color: "var(--mantine-color-red-filled)" }} />;
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
  onCreate?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
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
  onCreate,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: AnnouncementListCardProps) {
  const { t } = useTranslation("announcements");
  return (
    <PortalCard className="announcements-list-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={8}>
          <Group justify="space-between" align="center">
            <Text fw={600}>{title}</Text>
            {canEdit && onCreate ? (
              <DepthButton
                onClick={() => onCreate()}
                type="secondary"
                size="sm"
                before={<PlusIcon size={16} />}
              >
                {t("action.newAnnouncement")}
              </DepthButton>
            ) : null}
          </Group>
          {isLoading ? (
            <Stack gap={8}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Stack key={i} gap={4} style={{ padding: "8px 0" }}>
                  <Skeleton height={14} width="70%" />
                  <Skeleton height={10} width="40%" />
                </Stack>
              ))}
            </Stack>
          ) : null}
          {isError ? <Alert color="yellow" title={warningMessage} /> : null}
          {!isLoading && !isError ? (
            rows.length > 0 ? (
              <Stack gap={8}>
                {rows.map((item) => (
                  <div key={item.id} className="announcements-list-row">
                    <Indicator
                      disabled={
                        !(Boolean(announcementsLastSeenAt) && Date.parse(item.updated_at) > Date.parse(announcementsLastSeenAt as string))
                      }
                      processing
                      size={8}
                      position="top-start"
                      offset={4}
                      style={{ flex: 1 }}
                    >
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-label={t("aria.openAnnouncement", { title: item.title })}
                      aria-pressed={item.id === selectedId}
                      className={`announcement-item ${item.id === selectedId ? "announcement-item--active" : ""}`.trim()}
                    >
                      <Stack gap={2}>
                        <div className="announcement-item-title">
                            <Text fw={600}>{item.title}</Text>
                          {item.pinned ? <PushpinOutlined className="announcement-item-pin" /> : null}
                          {canEdit || item.status === "archived" ? (
                            <Tooltip label={t(`status.${item.status}`)} withArrow>
                              <span style={{ display: "inline-flex", lineHeight: 0 }}>{statusIcon(item.status)}</span>
                            </Tooltip>
                          ) : null}
                        </div>
                        <Group gap={8}>
                          {canEdit && item.status === "scheduled" && item.publish_at ? (
                            <Badge color="blue">{t("meta.scheduled", { datetime: formatDateTime(item.publish_at) })}</Badge>
                          ) : null}
                        </Group>
                        <Text c="dimmed" size="sm" className="announcement-item-time">
                          {formatDateTime(item.updated_at)}
                        </Text>
                      </Stack>
                    </button>
                    </Indicator>
                  </div>
                ))}
                {hasMore && onLoadMore ? (
                  <Button
                    variant="subtle"
                    size="xs"
                    loading={isLoadingMore}
                    onClick={onLoadMore}
                    style={{ alignSelf: "center" }}
                  >
                    {t("action.loadMore")}
                  </Button>
                ) : null}
              </Stack>
            ) : (
              <>{emptyText}</>
            )
          ) : null}
        </Stack>
      </div>
    </PortalCard>
  );
}

