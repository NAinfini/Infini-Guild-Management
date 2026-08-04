import type { Announcement } from "@guild/shared";
import { PushpinOutlined } from "@portal/utils/icons";
import { Alert, Badge, Button, Group, Indicator, Paper, Skeleton, Stack, Text, ThemeIcon, Tooltip, VisuallyHidden } from "@mantine/core";
import { ArchiveIcon, CalendarTimeIcon, CircleCheckIcon, FileTextIcon, PlusIcon } from "@portal/components/icons";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { AnnouncementStatus } from "@guild/shared/constants/announcements";

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

const STATUS_ICON = {
  draft: <FileTextIcon size={14} className="announcement-item-status-icon--draft" />,
  scheduled: <CalendarTimeIcon size={14} className="announcement-item-status-icon--scheduled" />,
  published: <CircleCheckIcon size={14} className="announcement-item-status-icon--published" />,
  archived: <ArchiveIcon size={14} className="announcement-item-status-icon--archived" />,
} satisfies Record<AnnouncementStatus, ReactNode>;

const STATUS_THEME = {
  draft: { color: "gray", icon: <FileTextIcon size={18} /> },
  scheduled: { color: "blue", icon: <CalendarTimeIcon size={18} /> },
  published: { color: "green", icon: <CircleCheckIcon size={18} /> },
  archived: { color: "yellow", icon: <ArchiveIcon size={18} /> },
} satisfies Record<AnnouncementStatus, { color: string; icon: ReactNode }>;

type AnnouncementListCardProps = {
  title: ReactNode;
  rows: Announcement[];
  selectedId: string | null;
  canEdit: boolean;
  canCreate: boolean;
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
  canCreate,
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
    <Paper withBorder radius="md" p="var(--card-padding)" className="announcements-list-card">
      {/* 卡头钉住、清单内滚：「新建公告」是随时要够得着的，跟着列表滚走等于没有。 */}
      <div className="announcements-card-body">
        <Group justify="space-between" align="center">
          <Text fw={600}>{title}</Text>
          {canCreate && onCreate ? (
            <Button
              onClick={() => onCreate()}
              size="sm"
              leftSection={<PlusIcon size={16} />}
            >
              {t("action.newAnnouncement")}
            </Button>
          ) : null}
        </Group>
        <Stack gap={8} className="announcements-card-scroll">
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
          {isError ? <Alert color="red" title={warningMessage} /> : null}
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
                      aria-pressed={item.id === selectedId}
                      className={`announcement-item ${item.id === selectedId ? "announcement-item--active" : ""}`.trim()}
                    >
                      <Stack gap={2}>
                        <div className="announcement-item-title">
                            <Text fw={600}>{item.title}</Text>
                          {item.pinned ? <PushpinOutlined className="announcement-item-pin" /> : null}
                          {canEdit || item.status === "archived" ? (() => {
                            const { color, icon } = STATUS_THEME[item.status];
                            return (
                              <Tooltip
                                multiline
                                w={280}
                                withArrow
                                arrowSize={10}
                                openDelay={350}
                                closeDelay={80}
                                position="top"
                                label={
                                  <Group gap={10} wrap="nowrap" align="flex-start">
                                    <ThemeIcon variant="light" color={color} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                                      {icon}
                                    </ThemeIcon>
                                    <div style={{ minWidth: 0 }}>
                                      <Text size="sm" fw={700} lh={1.3}>{t(`status.${item.status}`)}</Text>
                                      <Text size="xs" c="dimmed" lh={1.5}>{t(`tooltip.status.${item.status}.desc`)}</Text>
                                    </div>
                                  </Group>
                                }
                              >
                                <span style={{ display: "inline-flex", lineHeight: 0 }} data-animate-icon-trigger>
                                  {STATUS_ICON[item.status]}
                                  <VisuallyHidden>{t(`status.${item.status}`)}</VisuallyHidden>
                                </span>
                              </Tooltip>
                            );
                          })() : null}
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
    </Paper>
  );
}
