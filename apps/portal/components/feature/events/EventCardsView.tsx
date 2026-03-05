import type { Event, MemberProfile, User } from "@guild/shared";
import { Avatar, Badge, Button, Group, Menu, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { MotionButton, StaggerList } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import {
  IconArchive,
  IconCalendarEvent,
  IconClock,
  IconCopy,
  IconDots,
  IconFriends,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconRefresh,
  IconSparkles,
  IconSwords,
  IconTargetArrow,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { format } from "date-fns";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import "./EventCardsView.css";

const EVENT_TYPE_COLORS: Record<string, string> = {
  weekly_mission: "blue",
  guild_war: "red",
  social: "grape",
  other: "gray",
};

const EVENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  weekly_mission: <IconTargetArrow size={12} />,
  guild_war: <IconSwords size={12} />,
  social: <IconFriends size={12} />,
  other: <IconCalendarEvent size={12} />,
};

function getTypeGradientClass(type: string): string {
  return `event-card__header--${type in EVENT_TYPE_COLORS ? type : "other"}`;
}

function formatLocalDate(startAt: string): string {
  const d = new Date(startAt);
  return format(d, "EEE, MMM d, yyyy");
}

function formatLocalTime(startAt: string, endAt: string | null): string {
  const start = new Date(startAt);
  const startTime = format(start, "h:mm a");
  if (!endAt) return startTime;
  const end = new Date(endAt);
  const endTime = format(end, "h:mm a");
  return `${startTime} - ${endTime}`;
}

function formatTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}

/** Returns HSL hue: 210 (blue) → 120 (green) → 60 (yellow) → 30 (orange) → 0 (red) based on fill ratio. */
function capacityHue(joined: number, capacity: number): number {
  const ratio = Math.min(1, joined / capacity);
  if (ratio <= 0.4) return 210 - ratio * (90 / 0.4);       // blue(210) → green(120)
  if (ratio <= 0.6) return 120 - (ratio - 0.4) * (60 / 0.2); // green(120) → yellow(60)
  if (ratio <= 0.8) return 60 - (ratio - 0.6) * (30 / 0.2);  // yellow(60) → orange(30)
  return 30 - (ratio - 0.8) * (30 / 0.2);                     // orange(30) → red(0)
}

type MemberEntry = { user: User; profile: MemberProfile };

type EventCardsViewProps = {
  events: Event[];
  cardsEmptyDescription: string;
  canManage: boolean;
  canInteract: boolean;
  eventType: string | undefined;
  archivedOnly: boolean;
  eventFlags: Map<string, "NEW" | "UPDATED">;
  eventMembersMap: Map<string, MemberEntry[]>;
  joinPending: boolean;
  leavePending: boolean;
  createPending: boolean;
  updatePending: boolean;
  archivePending: boolean;
  onResetFilters: () => void;
  onCreateEvent: () => void;
  onJoinEvent: (eventId: string) => void;
  onLeaveEvent: (eventId: string) => void;
  onCopyMentions: (event: Event) => void;
  onEditEvent: (event: Event) => void;
  onDuplicateEvent: (event: Event) => void;
  onTogglePinEvent: (event: Event) => void;
  onToggleLockEvent: (event: Event) => void;
  onArchiveEvent: (eventId: string) => void;
};

export function EventCardsView({
  events,
  cardsEmptyDescription,
  canManage,
  canInteract,
  eventType,
  archivedOnly,
  eventFlags,
  eventMembersMap,
  joinPending,
  leavePending,
  onResetFilters,
  onCreateEvent,
  onJoinEvent,
  onLeaveEvent,
  onCopyMentions,
  onEditEvent,
  onDuplicateEvent,
  onTogglePinEvent,
  onToggleLockEvent,
  onArchiveEvent,
}: EventCardsViewProps) {
  const { t } = useTranslation("events");
  const [detailModalEvent, setDetailModalEvent] = useState<Event | null>(null);
  const detailModalMembers = detailModalEvent ? (eventMembersMap.get(detailModalEvent.id) ?? []) : [];

  if (events.length === 0) {
    return (
      <InfiniCard interactive={false}>
        <EmptyState
          title={cardsEmptyDescription}
          actions={
            <Group gap={8}>
              <Button onClick={onResetFilters} disabled={!eventType && !archivedOnly}>
                Reset filters
              </Button>
              {canManage ? (
                <MotionButton type="primary" onClick={onCreateEvent}>
                  {t("button.create")}
                </MotionButton>
              ) : null}
            </Group>
          }
        />
      </InfiniCard>
    );
  }

  return (
    <>
      <StaggerList className="events-card-grid" staggerMs={22}>
        {events.map((event) => {
          const members = eventMembersMap.get(event.id) ?? [];
          const joinedCount = members.length;
          const flag = eventFlags.get(event.id);
          const typeColor = EVENT_TYPE_COLORS[event.type] ?? "gray";
          const isFull = event.capacity !== null && joinedCount >= event.capacity;

          return (
              <InfiniCard key={event.id} className="event-card" onClick={() => setDetailModalEvent(event)} style={{ cursor: "pointer" }}>
              {/* ── Header ── */}
              <div className={`event-card__header ${getTypeGradientClass(event.type)}`}>
                <div className="event-card__header-left">
                  <Badge
                    size="sm"
                    variant="light"
                    color={typeColor}
                    className="event-card__type-badge"
                    leftSection={EVENT_TYPE_ICONS[event.type] ?? EVENT_TYPE_ICONS.other}
                  >
                    {formatTypeLabel(event.type)}
                  </Badge>
                  {event.recurrence_rule && event.series_id ? (
                    <Tooltip label="Recurring event">
                      <IconRefresh size={14} className="event-card__recurring-icon" />
                    </Tooltip>
                  ) : null}
                  {event.pinned ? (
                    <Tooltip label="Pinned">
                      <IconPin size={16} style={{ color: "var(--mantine-color-yellow-6)" }} />
                    </Tooltip>
                  ) : null}
                  {event.signup_locked ? (
                    <Tooltip label="Locked">
                      <IconLock size={16} style={{ color: "var(--mantine-color-red-6)" }} />
                    </Tooltip>
                  ) : null}
                  {event.archived_at ? (
                    <Tooltip label="Archived">
                      <IconArchive size={16} style={{ opacity: 0.5 }} />
                    </Tooltip>
                  ) : null}
                  {flag === "NEW" ? (
                    <Tooltip label="New">
                      <IconSparkles size={16} style={{ color: "var(--mantine-color-green-6)" }} />
                    </Tooltip>
                  ) : null}
                  {flag === "UPDATED" ? (
                    <Tooltip label="Updated">
                      <IconRefresh size={16} style={{ color: "var(--mantine-color-blue-6)" }} />
                    </Tooltip>
                  ) : null}
                </div>
                {canManage ? (
                  <Menu withinPortal position="bottom-end">
                    <Menu.Target>
                      <button type="button" className="event-card__menu-btn" aria-label="Event actions" onClick={(e) => e.stopPropagation()}>
                        <IconDots size={16} />
                      </button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEditEvent(event)}>
                        Edit
                      </Menu.Item>
                      <Menu.Item leftSection={<IconRefresh size={14} />} onClick={() => onDuplicateEvent(event)}>
                        Duplicate
                      </Menu.Item>
                      <Menu.Item
                        leftSection={event.pinned ? <IconPinnedOff size={14} /> : <IconPin size={14} />}
                        onClick={() => onTogglePinEvent(event)}
                      >
                        {event.pinned ? "Unpin" : "Pin"}
                      </Menu.Item>
                      <Menu.Item
                        leftSection={event.signup_locked ? <IconLockOpen size={14} /> : <IconLock size={14} />}
                        onClick={() => onToggleLockEvent(event)}
                      >
                        {event.signup_locked ? "Unlock Signup" : "Lock Signup"}
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconCopy size={14} />}
                        onClick={() => onCopyMentions(event)}
                        disabled={members.length === 0}
                      >
                        Copy Mentions
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        color="infini-danger"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => onArchiveEvent(event.id)}
                        disabled={Boolean(event.archived_at)}
                      >
                        Archive
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                ) : null}
              </div>

              {/* ── Body ── */}
              <div className="event-card__body">
                <Stack gap={12}>
                  {/* Title */}
                  <Text fw={700} size="lg" className="event-card__title">{event.title}</Text>

                  {/* Description preview */}
                  {event.description ? (
                    <Text size="sm" c="dimmed" lineClamp={2} className="event-card__description">
                      {event.description}
                    </Text>
                  ) : null}

                  {/* Date & Time */}
                  <Group gap={6} align="center" wrap="nowrap">
                    <IconCalendarEvent size={15} className="event-card__icon-muted" />
                    <Text size="sm" className="event-card__date-text">
                      {formatLocalDate(event.start_at)}
                    </Text>
                    <Text size="sm" c="dimmed">·</Text>
                    <IconClock size={15} className="event-card__icon-muted" />
                    <Text size="sm" className="event-card__time-text">
                      {formatLocalTime(event.start_at, event.end_at)}
                    </Text>
                  </Group>

                  {/* ── Members & Capacity ── */}
                  <div className="event-card__members-bar">
                    <div className="event-card__members-left">
                      <Avatar.Group spacing="sm">
                        {members.slice(0, 3).map((member) => (
                          <Tooltip key={member.user.id} label={member.user.username}>
                            <Avatar size="md" color={typeColor} radius="xl">
                              {member.user.username.slice(0, 1).toUpperCase()}
                            </Avatar>
                          </Tooltip>
                        ))}
                        {members.length > 3 ? (
                          <Avatar size="md" color="gray" radius="xl">+{members.length - 3}</Avatar>
                        ) : null}
                      </Avatar.Group>
                      <div className="event-card__capacity">
                        <IconUsers
                          size={15}
                          style={{ color: event.capacity ? `hsl(${capacityHue(joinedCount, event.capacity)}, 70%, 50%)` : undefined }}
                          className={event.capacity ? undefined : "event-card__icon-muted"}
                        />
                        <Text
                          size="sm"
                          fw={600}
                          className="event-card__capacity-text"
                          style={{ color: event.capacity ? `hsl(${capacityHue(joinedCount, event.capacity)}, 70%, 50%)` : undefined }}
                        >
                          {joinedCount}{event.capacity ? ` / ${event.capacity}` : ""}
                        </Text>
                      </div>
                    </div>
                  </div>

                  {/* ── Progress bar ── */}
                  <div className="event-card__progress-wrap">
                    <div className="event-card__progress-track">
                      {event.capacity ? (
                        <div
                          className="event-card__progress-fill event-card__progress-fill--capped"
                          style={{
                            width: `${Math.min(100, (joinedCount / event.capacity) * 100)}%`,
                            "--progress-hue": `${capacityHue(joinedCount, event.capacity)}`,
                          } as React.CSSProperties}
                        />
                      ) : (
                        <div className="event-card__progress-fill event-card__progress-fill--uncapped" />
                      )}
                    </div>
                    {event.capacity ? (
                      <Text size="xs" c="dimmed" className="event-card__progress-label">
                        {Math.round((joinedCount / event.capacity) * 100)}%
                      </Text>
                    ) : null}
                  </div>

                  {/* ── Actions ── */}
                  {canInteract ? (
                  <div className="event-card__actions" onClick={(e) => e.stopPropagation()}>
                    <MotionButton
                      type="primary"
                      size="small"
                      onClick={() => onJoinEvent(event.id)}
                      loading={joinPending}
                      disabled={event.signup_locked || Boolean(event.archived_at) || isFull}
                      className="event-card__join-btn"
                    >
                      {t("button.join")}
                    </MotionButton>
                    <Button
                      variant="default"
                      size="compact-sm"
                      onClick={() => onLeaveEvent(event.id)}
                      loading={leavePending}
                    >
                      {t("button.leave")}
                    </Button>
                    {!canManage ? (
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={() => onCopyMentions(event)}
                        disabled={members.length === 0}
                      >
                        Copy
                      </Button>
                    ) : null}
                  </div>
                  ) : null}
                </Stack>
              </div>
            </InfiniCard>
          );
        })}
      </StaggerList>

      {/* ── Event Detail Modal ── */}
      <Modal
        opened={detailModalEvent !== null}
        onClose={() => setDetailModalEvent(null)}
        title={detailModalEvent?.title ?? "Event Details"}
        size="lg"
        centered
      >
        {detailModalEvent ? (
          <Stack gap={20}>
            <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.2)" }}>
              <Group gap={8} mb={8}>
                <IconCalendarEvent size={20} style={{ color: "#3b82f6" }} />
                <Text size="md" fw={600}>Event Type</Text>
              </Group>
              <Text size="md" tt="capitalize">{formatTypeLabel(detailModalEvent.type)}</Text>
            </div>

            <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(17, 24, 39, 0.03)", border: "1px solid rgba(17, 24, 39, 0.1)" }}>
              <Group gap={8} mb={8}>
                <IconClock size={20} style={{ color: "#8b5cf6" }} />
                <Text size="md" fw={600}>Time</Text>
              </Group>
              <Group gap={8}>
                <Text size="md">{formatLocalDate(detailModalEvent.start_at)}</Text>
                <Text size="md" c="dimmed">·</Text>
                <Text size="md">{formatLocalTime(detailModalEvent.start_at, detailModalEvent.end_at)}</Text>
              </Group>
            </div>

            {detailModalEvent.description ? (
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(17, 24, 39, 0.03)", border: "1px solid rgba(17, 24, 39, 0.1)" }}>
                <Text size="md" fw={600} mb={8}>Description</Text>
                <Text size="md" c="dimmed">{detailModalEvent.description}</Text>
              </div>
            ) : null}

            <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
              <Group gap={8} mb={12}>
                <IconUsers size={20} style={{ color: "#10b981" }} />
                <Text size="md" fw={600}>Members ({detailModalMembers.length}{detailModalEvent.capacity ? ` / ${detailModalEvent.capacity}` : ""})</Text>
              </Group>
              {detailModalMembers.length === 0 ? (
                <Text c="dimmed" size="md">No members have joined yet.</Text>
              ) : (
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                  <Stack gap={10}>
                    {detailModalMembers.map((entry) => (
                      <Group key={entry.user.id} gap={10} style={{ padding: "8px", borderRadius: "6px", background: "rgba(255, 255, 255, 0.5)" }}>
                        <Avatar size="md" color={EVENT_TYPE_COLORS[detailModalEvent.type] ?? "gray"} radius="xl">
                          {entry.user.username.slice(0, 1).toUpperCase()}
                        </Avatar>
                        <div style={{ flex: 1 }}>
                          <Text size="md" fw={600}>{entry.user.username}</Text>
                          <Group gap={6}>
                            <Text size="sm" c="dimmed">{entry.profile.classes[0] ?? "—"}</Text>
                            <Text size="sm" c="dimmed">·</Text>
                            <Text size="sm" c="dimmed">Power: {entry.profile.power ?? "—"}</Text>
                          </Group>
                        </div>
                      </Group>
                    ))}
                  </Stack>
                </div>
              )}
            </div>
          </Stack>
        ) : null}
      </Modal>
    </>
  );
}

