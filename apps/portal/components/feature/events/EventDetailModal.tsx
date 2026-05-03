import type { Event, MemberProfile, User } from "@guild/shared";
import { Avatar, Grid, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { MediaGallery, buildMediaGalleryLabels } from "@portal/components/shared/MediaGallery";
import {
  IconCalendarEvent,
  IconClock,
  IconUserMinus,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";

const EVENT_TYPE_COLORS: Record<string, string> = {
  weekly_mission: "blue",
  guild_war: "red",
  social: "grape",
  other: "gray",
};

export type MemberEntry = { user: User; profile: MemberProfile };

function formatLocalDate(startAt: string, locale: string): string {
  const d = new Date(startAt);
  return d.toLocaleDateString(locale, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function formatLocalTime(startAt: string, endAt: string | null, locale: string): string {
  const start = new Date(startAt);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startTime = start.toLocaleTimeString(locale, timeOpts);
  if (!endAt) return startTime;
  const end = new Date(endAt);
  const endTime = end.toLocaleTimeString(locale, timeOpts);
  return `${startTime} - ${endTime}`;
}

function resolveEventAttachmentUrl(key: string): string {
  if (/^(?:https?:)?\/\//i.test(key) || key.startsWith("data:")) {
    return key;
  }
  if (typeof window === "undefined") {
    return `/api/events/image?key=${encodeURIComponent(key)}`;
  }
  const url = new URL("/api/events/image", window.location.origin);
  url.searchParams.set("key", key);
  return url.toString();
}

type EventDetailModalProps = {
  event: Event | null;
  members: MemberEntry[];
  allUsers: MemberEntry[];
  canManage: boolean;
  currentUserId?: string;
  joinPending?: boolean;
  leavePending?: boolean;
  onClose: () => void;
  onJoin?: (eventId: string) => void;
  onLeave?: (eventId: string) => void;
  onAddParticipant: (eventId: string, userId: string) => void;
  onRemoveParticipant: (eventId: string, userId: string) => void;
};

export function EventDetailModal({
  event,
  members,
  allUsers,
  canManage,
  currentUserId,
  joinPending,
  leavePending,
  onClose,
  onJoin,
  onLeave,
  onAddParticipant,
  onRemoveParticipant,
}: EventDetailModalProps) {
  const { t, i18n } = useTranslation("events");
  const { t: tc } = useTranslation("common");
  const mediaLabels = useMemo(() => buildMediaGalleryLabels(tc), [tc]);
  const isJoined = currentUserId ? members.some((entry) => entry.user.id === currentUserId) : false;
  const isFull = event?.capacity != null ? members.length >= event.capacity : false;
  const hasEnded = Boolean(event?.end_at && new Date(event.end_at) < new Date());
  const showMemberAction = Boolean(currentUserId && (isJoined ? onLeave : onJoin));
  const memberActionDisabled = event ? event.signup_locked || Boolean(event.archived_at) || hasEnded || (!isJoined && isFull) : true;
  const memberActionLabel = isJoined
    ? t("button.leave")
    : isFull
      ? t("button.full")
      : t("button.join");

  return (
    <Modal
      opened={event !== null}
      onClose={onClose}
      title={event?.title ?? t("detail.title")}
      size={event?.attachments && event.attachments.length > 0 ? "calc(100vw - 80px)" : "lg"}
      centered
    >
      {event ? (
        <Grid gutter={16}>
          <Grid.Col span={event.attachments && event.attachments.length > 0 ? 5 : 12}>
            <Stack gap={20}>
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.2)" }}>
                <Group gap={8} mb={8}>
                  <IconCalendarEvent size={20} style={{ color: "#3b82f6" }} />
                  <Text size="md" fw={600}>{t("detail.eventType")}</Text>
                </Group>
                <Text size="md">{t(`common:eventType.${event.type}`)}</Text>
              </div>

              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(17, 24, 39, 0.03)", border: "1px solid rgba(17, 24, 39, 0.1)" }}>
                <Group gap={8} mb={8}>
                  <IconClock size={20} style={{ color: "#8b5cf6" }} />
                  <Text size="md" fw={600}>{t("detail.time")}</Text>
                </Group>
                <Group gap={8}>
                  <Text size="md">{formatLocalDate(event.start_at, i18n.language)}</Text>
                  <Text size="md" c="dimmed">·</Text>
                  <Text size="md">{formatLocalTime(event.start_at, event.end_at, i18n.language)}</Text>
                </Group>
              </div>

              {event.description ? (
                <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(17, 24, 39, 0.03)", border: "1px solid rgba(17, 24, 39, 0.1)" }}>
                  <Text size="md" fw={600} mb={8}>{t("detail.description")}</Text>
                  <Text size="md" c="dimmed">{event.description}</Text>
                </div>
              ) : null}

              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                <Group justify="space-between" gap={12} mb={12} wrap="wrap">
                  <Group gap={8}>
                    <IconUsers size={20} style={{ color: "#10b981" }} />
                    <Text size="md" fw={600}>{event.capacity ? t("detail.membersWithCap", { count: members.length, capacity: event.capacity }) : t("detail.members", { count: members.length })}</Text>
                  </Group>
                  {showMemberAction ? (
                    <DepthButton
                      type={isJoined ? "danger" : "primary"}
                      size="sm"
                      onClick={() => {
                        if (isJoined) {
                          onLeave?.(event.id);
                          return;
                        }
                        onJoin?.(event.id);
                      }}
                      disabled={memberActionDisabled || joinPending || leavePending}
                      loading={joinPending || leavePending}
                    >
                      {isJoined ? <IconUserMinus size={14} style={{ marginRight: 4 }} /> : <IconUserPlus size={14} style={{ marginRight: 4 }} />}
                      {memberActionLabel}
                    </DepthButton>
                  ) : null}
                </Group>

                {canManage ? (
                  <Select
                    placeholder={t("detail.addMemberPlaceholder")}
                    searchable
                    clearable
                    mb={12}
                    value={null}
                    onChange={(userId) => {
                      if (userId && event) {
                        onAddParticipant(event.id, userId);
                      }
                    }}
                    data={allUsers
                      .filter((entry) => entry.user.is_active && !entry.user.deleted_at && !members.some((m) => m.user.id === entry.user.id))
                      .map((entry) => ({ value: entry.user.id, label: entry.user.username }))
                    }
                    leftSection={<IconUserPlus size={16} />}
                  />
                ) : null}

                {members.length === 0 ? (
                  <Text c="dimmed" size="md">{t("detail.noMembers")}</Text>
                ) : (
                  <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                    <Stack gap={10}>
                      {members.map((entry) => (
                        <Group key={entry.user.id} gap={10} style={{ padding: "8px", borderRadius: "6px", background: "color-mix(in srgb, var(--color-text) 8%, transparent)" }}>
                          <Avatar size="md" color={EVENT_TYPE_COLORS[event.type] ?? "gray"} radius="xl">
                            {entry.user.username.slice(0, 1).toUpperCase()}
                          </Avatar>
                          <div style={{ flex: 1 }}>
                            <Text size="md" fw={600}>{entry.user.username}</Text>
                            <Group gap={6}>
                              <Text size="sm" c="dimmed">{entry.profile.classes[0] ?? "—"}</Text>
                              <Text size="sm" c="dimmed">·</Text>
                              <Text size="sm" c="dimmed">{t("detail.power", { value: entry.profile.power ?? "—" })}</Text>
                            </Group>
                          </div>
                          {canManage ? (
                            <DepthButton
                              type="danger"
                              size="sm"
                              onClick={() => {
                                modals.openConfirmModal({
                                  title: t("detail.confirm.removeMember.title"),
                                  children: (
                                    <Text size="sm">
                                      {t("detail.confirm.removeMember.description", { username: entry.user.username })}
                                    </Text>
                                  ),
                                  labels: { confirm: t("detail.removeMember"), cancel: t("button.cancel") },
                                  confirmProps: { color: "red" },
                                  onConfirm: () => onRemoveParticipant(event.id, entry.user.id),
                                  centered: true,
                                });
                              }}
                            >
                              <IconUserMinus size={14} style={{ marginRight: 4 }} />
                              {t("detail.removeMember")}
                            </DepthButton>
                          ) : null}
                        </Group>
                      ))}
                    </Stack>
                  </div>
                )}
              </div>
            </Stack>
          </Grid.Col>

          {event.attachments && event.attachments.length > 0 ? (
            <Grid.Col span={7}>
              <MediaGallery images={event.attachments} resolveMediaUrl={resolveEventAttachmentUrl} labels={mediaLabels} />
            </Grid.Col>
          ) : null}
        </Grid>
      ) : null}
    </Modal>
  );
}
