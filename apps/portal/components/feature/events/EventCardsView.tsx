import type { Event, MemberProfile, User } from "@guild/shared";
import { Avatar, Badge, Button, Group, Modal, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { InfiniMenu } from "@portal/components/shared/InfiniMenu";
import { PortalCard } from "../../shared/PortalCard";
import {
  IconArchive,
  IconArchiveOff,
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
  IconSparkles2,
  IconSwords,
  IconTargetArrow,
  IconTrash,
  IconUserMinus,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { type EventTypeFilter } from "../../../utils/event-navigation";
import { EmptyState } from "../../shared/EmptyState";
import { EventDetailModal } from "./EventDetailModal";
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
  currentUserId: string | null;
  eventType: EventTypeFilter | undefined;
  archivedOnly: boolean;
  pinnedOnly: boolean;
  lockedOnly: boolean;
  focusedEventId: string | null;
  eventFlags: Map<string, "NEW" | "UPDATED">;
  eventMembersMap: Map<string, MemberEntry[]>;
  allUsers: MemberEntry[];
  createPending: boolean;
  updatePending: boolean;
  archivePending: boolean;
  joinPending: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  leavePending: boolean;
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
  onUnarchiveEvent: (eventId: string) => void;
  onDeleteEvent: (event: Event) => void;
  onAddParticipant: (eventId: string, userId: string) => void;
  onRemoveParticipant: (eventId: string, userId: string) => void;
};

export function EventCardsView({
  events,
  cardsEmptyDescription,
  canManage,
  canInteract,
  currentUserId,
  eventType,
  archivedOnly,
  pinnedOnly,
  lockedOnly,
  focusedEventId,
  eventFlags,
  eventMembersMap,
  allUsers,
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
  onUnarchiveEvent,
  onDeleteEvent,
  onAddParticipant,
  onRemoveParticipant,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: EventCardsViewProps) {
  const { t, i18n } = useTranslation("events");
  const [detailModalEvent, setDetailModalEvent] = useState<Event | null>(null);
  const [archiveConfirmEvent, setArchiveConfirmEvent] = useState<Event | null>(null);
  const detailModalMembers = detailModalEvent ? (eventMembersMap.get(detailModalEvent.id) ?? []) : [];

  if (events.length === 0) {
    return (
      <PortalCard interactive={false}>
        <EmptyState
          title={cardsEmptyDescription}
          actions={
            <Group gap={8}>
              <Button onClick={onResetFilters} disabled={!eventType && !archivedOnly && !pinnedOnly && !lockedOnly}>
                {t("card.resetFilters")}
              </Button>
              {canManage ? (
                <DepthButton type="primary" onClick={onCreateEvent}>
                  {t("button.create")}
                </DepthButton>
              ) : null}
            </Group>
          }
        />
      </PortalCard>
    );
  }

  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing={12}>
        {events.map((event) => {
          const members = eventMembersMap.get(event.id) ?? [];
          const joinedCount = members.length;
          const flag = eventFlags.get(event.id);
          const typeColor = EVENT_TYPE_COLORS[event.type] ?? "gray";
          const isFull = event.capacity !== null && joinedCount >= event.capacity;
          const isJoined = currentUserId ? members.some((m) => m.user.id === currentUserId) : false;
          const isFocused = focusedEventId === event.id;

          return (
              <PortalCard key={event.id} className={`event-card${isFocused ? " event-card--focused" : ""}`} onClick={() => setDetailModalEvent(event)} style={{ cursor: "pointer" }} role="button" tabIndex={0} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailModalEvent(event); } }} aria-label={event.title}>
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
                    {t(`common:eventType.${event.type}`)}
                  </Badge>
                  {event.recurrence_rule && event.series_id ? (
                    <Tooltip label={t("card.recurring")}>
                      <IconRefresh size={14} className="event-card__recurring-icon" />
                    </Tooltip>
                  ) : null}
                  {event.pinned ? (
                    <Tooltip label={t("card.pinned")}>
                      <IconPin size={16} style={{ color: "var(--mantine-color-yellow-6)" }} />
                    </Tooltip>
                  ) : null}
                  {event.signup_locked ? (
                    <Tooltip label={t("card.locked")}>
                      <IconLock size={16} style={{ color: "var(--mantine-color-red-6)" }} />
                    </Tooltip>
                  ) : null}
                  {event.archived_at ? (
                    <Tooltip label={t("card.archived")}>
                      <IconArchive size={16} style={{ opacity: 0.5 }} />
                    </Tooltip>
                  ) : null}
                  {flag === "NEW" ? (
                    <Tooltip label={t("card.new")}>
                      <IconSparkles size={16} style={{ color: "var(--mantine-color-green-6)" }} />
                    </Tooltip>
                  ) : null}
                  {flag === "UPDATED" ? (
                    <Tooltip label={t("card.updated")}>
                      <IconSparkles2 size={16} style={{ color: "var(--mantine-color-blue-6)" }} />
                    </Tooltip>
                  ) : null}
                </div>
                {canManage ? (
                  <InfiniMenu position="bottom-end">
                    <InfiniMenu.Target>
                      <button type="button" className="event-card__menu-btn" aria-label={t("menu.actions")} onClick={(e) => e.stopPropagation()}>
                        <IconDots size={16} />
                      </button>
                    </InfiniMenu.Target>
                    <InfiniMenu.Dropdown onClick={(e) => e.stopPropagation()}>
                      <InfiniMenu.Item leftSection={<IconPencil size={14} />} onClick={() => onEditEvent(event)}>
                        {t("menu.edit")}
                      </InfiniMenu.Item>
                      <InfiniMenu.Item leftSection={<IconCopy size={14} />} onClick={() => onDuplicateEvent(event)}>
                        {t("menu.duplicate")}
                      </InfiniMenu.Item>
                      <InfiniMenu.Item
                        leftSection={event.pinned ? <IconPinnedOff size={14} /> : <IconPin size={14} />}
                        onClick={() => onTogglePinEvent(event)}
                      >
                        {event.pinned ? t("menu.unpin") : t("menu.pin")}
                      </InfiniMenu.Item>
                      <InfiniMenu.Item
                        leftSection={event.signup_locked ? <IconLockOpen size={14} /> : <IconLock size={14} />}
                        onClick={() => onToggleLockEvent(event)}
                      >
                        {event.signup_locked ? t("menu.unlockSignup") : t("menu.lockSignup")}
                      </InfiniMenu.Item>
                      <InfiniMenu.Divider />
                      <InfiniMenu.Item
                        leftSection={event.archived_at ? <IconArchiveOff size={14} /> : <IconArchive size={14} />}
                        onClick={() => event.archived_at ? onUnarchiveEvent(event.id) : setArchiveConfirmEvent(event)}
                      >
                        {event.archived_at ? t("menu.unarchive") : t("menu.archive")}
                      </InfiniMenu.Item>
                      <InfiniMenu.Item
                        className="infini-menu-item--danger"
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => onDeleteEvent(event)}
                      >
                        {t("menu.delete")}
                      </InfiniMenu.Item>
                    </InfiniMenu.Dropdown>
                  </InfiniMenu>
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
                      {formatLocalDate(event.start_at, i18n.language)}
                    </Text>
                    <Text size="sm" c="dimmed">·</Text>
                    <IconClock size={15} className="event-card__icon-muted" />
                    <Text size="sm" className="event-card__time-text">
                      {formatLocalTime(event.start_at, event.end_at, i18n.language)}
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
                          {joinedCount} / {event.capacity ?? "∞"}
                        </Text>
                      </div>
                    </div>
                  </div>

                  {/* ── Progress bar ── */}
                  {event.capacity ? (
                  <div className="event-card__progress-wrap">
                    <div className="event-card__progress-track">
                        <div
                          className="event-card__progress-fill event-card__progress-fill--capped"
                          style={{
                            width: `${Math.min(100, (joinedCount / event.capacity) * 100)}%`,
                            "--progress-hue": `${capacityHue(joinedCount, event.capacity)}`,
                          } as React.CSSProperties}
                        />
                    </div>
                    <Text size="xs" c="dimmed" className="event-card__progress-label">
                      {`${Math.round((joinedCount / event.capacity) * 100)}%`}
                    </Text>
                  </div>
                  ) : null}

                  {/* ── Actions ── */}
                  {canInteract ? (
                  <div className="event-card__actions" onClick={(e) => e.stopPropagation()}>
                    <DepthToggle
                      pressed={isJoined}
                      onToggle={(joined) => {
                        if (joined) {
                          onJoinEvent(event.id);
                        } else {
                          onLeaveEvent(event.id);
                        }
                      }}
                      type="primary"
                      size="xs"
                      disabled={joinPending || leavePending || (!isJoined && (event.signup_locked || Boolean(event.archived_at) || isFull || (event.end_at != null && new Date(event.end_at) < new Date())))}
                      tooltip={isJoined ? t("button.leave") : t("button.join")}
                    >
                      {isJoined ? <IconUserMinus size={14} /> : <IconUserPlus size={14} />}
                      {isJoined ? t("button.leave") : t("button.join")}
                    </DepthToggle>
                    <DepthButton
                      onClick={() => onCopyMentions(event)}
                      type="secondary"
                      size="sm"
                      disabled={members.length === 0}
                      tooltip={t("card.copyMentions")}
                    >
                      <IconCopy size={14} />
                    </DepthButton>
                  </div>
                  ) : null}
                </Stack>
              </div>
            </PortalCard>
          );
        })}
      </SimpleGrid>

      {hasMore && onLoadMore ? (
        <Group justify="center" mt={8}>
          <Button
            variant="subtle"
            loading={isLoadingMore}
            onClick={onLoadMore}
          >
            {t("action.loadMore")}
          </Button>
        </Group>
      ) : null}

      {/* ── Event Detail Modal ── */}
      <EventDetailModal
        event={detailModalEvent}
        members={detailModalMembers}
        allUsers={allUsers}
        canManage={canManage}
        currentUserId={currentUserId ?? undefined}
        joinPending={joinPending}
        leavePending={leavePending}
        onClose={() => setDetailModalEvent(null)}
        onJoin={onJoinEvent}
        onLeave={onLeaveEvent}
        onAddParticipant={onAddParticipant}
        onRemoveParticipant={onRemoveParticipant}
      />

      {/* ── Archive Confirmation Modal ── */}
      <Modal
        opened={archiveConfirmEvent !== null}
        onClose={() => setArchiveConfirmEvent(null)}
        title={t("archive.confirmTitle")}
        centered
        size="sm"
      >
        <Stack gap={12}>
          <Text size="sm">
            {t("archive.confirmDescription", { title: archiveConfirmEvent?.title ?? "" })}
          </Text>
          <Group justify="flex-end" gap={8}>
            <Button variant="default" onClick={() => setArchiveConfirmEvent(null)}>
              {t("archive.cancel")}
            </Button>
            <Button
              color="yellow"
              onClick={() => {
                if (archiveConfirmEvent) {
                  onArchiveEvent(archiveConfirmEvent.id);
                  setArchiveConfirmEvent(null);
                }
              }}
            >
              {t("archive.confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

