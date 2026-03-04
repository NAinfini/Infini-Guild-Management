import type { Announcement } from "@guild/shared";
import { MoreOutlined, PushpinOutlined } from "@portal/utils/icons";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Alert, Badge, Button, Group, Indicator, Loader, Menu, Stack, Text } from "@mantine/core";
import { format } from "date-fns";
import type { ReactNode } from "react";

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function statusLabel(value: Announcement["status"]): string {
  return value.toUpperCase();
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
  onTogglePin: (item: Announcement) => void;
  onArchive: (id: string) => void;
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
  onTogglePin,
  onArchive,
}: AnnouncementListCardProps) {
  return (
    <InfiniCard className="announcements-list-card">
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={8}>
          <Text fw={600}>{title}</Text>
          {isLoading ? <Loader size="sm" /> : null}
          {isError ? <Alert color="yellow" title={warningMessage} /> : null}
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
                        </div>
                        <Group gap={8}>
                          {canEdit ? <Badge>{statusLabel(item.status)}</Badge> : null}
                          {canEdit && item.status === "scheduled" && item.publish_at ? (
                            <Badge color="blue">Scheduled: {formatDateTime(item.publish_at)}</Badge>
                          ) : null}
                        </Group>
                        <Text c="dimmed" size="sm" className="announcement-item-time">
                          {formatDateTime(item.updated_at)}
                        </Text>
                      </Stack>
                    </button>
                    {canEdit ? (
                      <Menu withinPortal>
                        <Menu.Target>
                          <Button aria-label={`Announcement actions for ${item.title}`}>
                            <MoreOutlined />
                          </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => onSelect(item.id)}>Open</Menu.Item>
                          <Menu.Item onClick={() => onTogglePin(item)}>{item.pinned ? "Unpin" : "Pin"}</Menu.Item>
                          <Menu.Item color="red" onClick={() => onArchive(item.id)}>
                            Archive
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    ) : null}
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
