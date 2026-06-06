import type { Event, MemberProfile, User } from "@guild/shared";
import { Badge, Button, Group, HoverCard, Modal, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { InfiniMenu } from "@portal/components/shared/InfiniMenu";
import { PortalCard } from "../../shared/PortalCard";
import {
  ArchiveIcon,
  ArchiveOffIcon,
  CalendarEventIcon,
  ChartBarIcon,
  ClockIcon,
  CopyIcon,
  DotsIcon,
  FriendsIcon,
  GiftIcon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  PinIcon,
  PinnedOffIcon,
  RefreshCwIcon,
  Sparkles2Icon,
  SparklesIcon,
  SwordsIcon,
  TargetArrowIcon,
  TrashIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "@portal/components/icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { type EventTypeFilter } from "../../../utils/event-navigation";
import { EmptyState } from "../../shared/EmptyState";
import { EventCardAvatarStrip } from "./EventCardAvatarStrip";
import { EventDetailModal } from "./EventDetailModal";
import "./EventCardsView.css";

const EVENT_TYPE_COLORS: Record<string, string> = {
  weekly_mission: "blue",
  guild_war: "red",
  social: "grape",
  poll: "teal",
  raffle: "pink",
  other: "gray",
};

const EVENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  weekly_mission: <TargetArrowIcon size={12} />,
  guild_war: <SwordsIcon size={12} />,
  social: <FriendsIcon size={12} />,
  poll: <ChartBarIcon size={12} />,
  raffle: <GiftIcon size={12} />,
  other: <CalendarEventIcon size={12} />,
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
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true };
  const startTime = start.toLocaleTimeString(locale, timeOpts);
  if (!endAt) return startTime;
  const end = new Date(endAt);
  const endTime = end.toLocaleTimeString(locale, timeOpts);
  return `${startTime} - ${endTime}`;
}

type MemberEntry = { user: User; profile: MemberProfile };

type EventStatusIndicatorProps = {
  children: React.ReactNode;
  color: string;
  icon: React.ReactNode;
  title: string;
  description: string;
};

function EventStatusIndicator({ children, color, icon, title, description }: EventStatusIndicatorProps) {
  return (
    <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
      <HoverCard.Target>
        <span className="event-card__status-icon" data-animate-icon-trigger>{children}</span>
      </HoverCard.Target>
      <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color={color} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
            {icon}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={700} lh={1.3} mb={4}>{title}</Text>
            <Text size="xs" c="dimmed" lh={1.5}>{description}</Text>
          </div>
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

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
  hasAnyFilter?: boolean;
  focusedEventId: string | null;
  eventFlags: Map<string, "NEW" | "UPDATED">;
  eventMembersMap: Map<string, MemberEntry[]>;
  allUsers: MemberEntry[];
  createPending: boolean;
  updatePending: boolean;
  archivePending: boolean;
  joinPending: boolean;
  votePending?: boolean;
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
  onVotePoll?: (eventId: string, optionIds: string[]) => void;
  onDrawRaffle?: (eventId: string) => void;
  drawRafflePending?: boolean;
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
  hasAnyFilter,
  focusedEventId,
  eventFlags,
  eventMembersMap,
  allUsers,
  joinPending,
  votePending,
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
  onVotePoll,
  onDrawRaffle,
  drawRafflePending,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: EventCardsViewProps) {
  const { t, i18n } = useTranslation("events");
  const [detailModalEvent, setDetailModalEvent] = useState<Event | null>(null);
  const [archiveConfirmEvent, setArchiveConfirmEvent] = useState<Event | null>(null);
  const detailModalMembers = detailModalEvent ? (eventMembersMap.get(detailModalEvent.id) ?? []) : [];
  const now = new Date();

  if (events.length === 0) {
    return (
      <PortalCard interactive={false}>
        <EmptyState
          title={cardsEmptyDescription}
          actions={
            <Group gap={8}>
              <Button onClick={onResetFilters} disabled={hasAnyFilter === undefined ? !eventType && !archivedOnly && !pinnedOnly && !lockedOnly : !hasAnyFilter}>
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
          const participantMembers = eventMembersMap.get(event.id) ?? [];
          const isPoll = event.type === "poll";
          const isRaffle = event.type === "raffle";
          const hasEnded = event.end_at != null && new Date(event.end_at) < now;
          const raffleHasDrawn = isRaffle && (event.raffle_winners?.length ?? 0) > 0;
          const pollVoterMembers = isPoll && event.poll
            ? (() => {
                const voterIds = new Set(event.poll.options.flatMap((o) => o.voter_ids));
                return allUsers.filter((e) => voterIds.has(e.user.id));
              })()
            : [];
          const members = isPoll ? pollVoterMembers : participantMembers;
          const joinedCount = members.length;
          const flag = eventFlags.get(event.id);
          const typeColor = EVENT_TYPE_COLORS[event.type] ?? "gray";
          const isFull = event.capacity !== null && joinedCount >= event.capacity;
          const isJoined = currentUserId ? members.some((m) => m.user.id === currentUserId) : false;
          const isFocused = focusedEventId === event.id;
          const isArchived = Boolean(event.archived_at);
          const visibleMembers = members;
          const hiddenMembersCount = 0;
          const participantActionDisabled = joinPending || leavePending || isArchived || (!isJoined && (event.signup_locked || isFull || hasEnded));
          const statusIndicators = (
            <>
              {event.series_id ? (
                <EventStatusIndicator
                  color="teal"
                  icon={<RefreshCwIcon size={16} />}
                  title={t("tooltip.recurring.title")}
                  description={t("tooltip.recurring.desc")}
                >
                  <RefreshCwIcon size={14} />
                </EventStatusIndicator>
              ) : null}
              {event.pinned ? (
                <EventStatusIndicator
                  color="orange"
                  icon={<PinIcon size={16} />}
                  title={t("tooltip.pinned.title")}
                  description={t("tooltip.pinned.desc")}
                >
                  <PinIcon size={16} style={{ color: "var(--mantine-color-yellow-6)" }} />
                </EventStatusIndicator>
              ) : null}
              {event.signup_locked ? (
                <EventStatusIndicator
                  color="red"
                  icon={<LockIcon size={16} />}
                  title={t("tooltip.locked.title")}
                  description={t("tooltip.locked.desc")}
                >
                  <LockIcon size={16} style={{ color: "var(--mantine-color-red-6)" }} />
                </EventStatusIndicator>
              ) : null}
              {event.archived_at ? (
                <EventStatusIndicator
                  color="gray"
                  icon={<ArchiveIcon size={16} />}
                  title={t("tooltip.archived.title")}
                  description={t("tooltip.archived.desc")}
                >
                  <ArchiveIcon size={16} style={{ opacity: 0.5 }} />
                </EventStatusIndicator>
              ) : null}
              {flag === "NEW" ? (
                <EventStatusIndicator
                  color="green"
                  icon={<SparklesIcon size={16} />}
                  title={t("tooltip.new.title")}
                  description={t("tooltip.new.desc")}
                >
                  <SparklesIcon size={16} style={{ color: "var(--mantine-color-green-6)" }} />
                </EventStatusIndicator>
              ) : null}
              {flag === "UPDATED" ? (
                <EventStatusIndicator
                  color="blue"
                  icon={<Sparkles2Icon size={16} />}
                  title={t("tooltip.updated.title")}
                  description={t("tooltip.updated.desc")}
                >
                  <Sparkles2Icon size={16} style={{ color: "var(--mantine-color-blue-6)" }} />
                </EventStatusIndicator>
              ) : null}
            </>
          );

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
                </div>
                <div className="event-card__header-right">
                  {canInteract && !isPoll ? (
                    <div className="event-card__header-actions" onClick={(e) => e.stopPropagation()}>
                      <DepthButton
                        onClick={() => onCopyMentions(event)}
                        type="secondary"
                        size="sm"
                        disabled={members.length === 0}
                        tooltip={t("card.copyMentions")}
                        iconOnly
                        before={<CopyIcon size={14} />}
                      />
                      <div className="event-card__capacity">
                        <UsersIcon size={13} />
                        <span>{joinedCount}/{event.capacity ?? "∞"}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="event-card__capacity">
                      <UsersIcon size={13} />
                      <span>{joinedCount}/{event.capacity ?? "∞"}</span>
                    </div>
                  )}
                  {canManage ? (
                    <InfiniMenu position="bottom-end">
                      <InfiniMenu.Target>
                        <button type="button" className="event-card__menu-btn" aria-label={t("menu.actions")} onClick={(e) => e.stopPropagation()}>
                          <DotsIcon size={16} />
                        </button>
                      </InfiniMenu.Target>
                      <InfiniMenu.Dropdown onClick={(e) => e.stopPropagation()}>
                        <InfiniMenu.Item leftSection={<PencilIcon size={14} />} onClick={() => onEditEvent(event)}>
                          {t("menu.edit")}
                        </InfiniMenu.Item>
                        <InfiniMenu.Item leftSection={<CopyIcon size={14} />} onClick={() => onDuplicateEvent(event)}>
                          {t("menu.duplicate")}
                        </InfiniMenu.Item>
                        <InfiniMenu.Item
                          leftSection={event.pinned ? <PinnedOffIcon size={14} /> : <PinIcon size={14} />}
                          onClick={() => onTogglePinEvent(event)}
                        >
                          {event.pinned ? t("menu.unpin") : t("menu.pin")}
                        </InfiniMenu.Item>
                        <InfiniMenu.Item
                          leftSection={event.signup_locked ? <LockOpenIcon size={14} /> : <LockIcon size={14} />}
                          onClick={() => onToggleLockEvent(event)}
                        >
                          {event.signup_locked ? t("menu.unlockSignup") : t("menu.lockSignup")}
                        </InfiniMenu.Item>
                        <InfiniMenu.Divider />
                        <InfiniMenu.Item
                          leftSection={event.archived_at ? <ArchiveOffIcon size={14} /> : <ArchiveIcon size={14} />}
                          onClick={() => event.archived_at ? onUnarchiveEvent(event.id) : setArchiveConfirmEvent(event)}
                        >
                          {event.archived_at ? t("menu.unarchive") : t("menu.archive")}
                        </InfiniMenu.Item>
                        <InfiniMenu.Item
                          className="infini-menu-item--danger"
                          color="red"
                          leftSection={<TrashIcon size={14} />}
                          onClick={() => onDeleteEvent(event)}
                        >
                          {t("menu.delete")}
                        </InfiniMenu.Item>
                      </InfiniMenu.Dropdown>
                    </InfiniMenu>
                  ) : null}
                </div>
              </div>

              {/* ── Body ── */}
              <div className="event-card__body">
                <Stack gap={8}>
                  <div className="event-card__title-row">
                    <Text fw={700} size="md" className="event-card__title">{event.title}</Text>
                    <div className="event-card__status-rail">{statusIndicators}</div>
                  </div>

                  {/* Description preview */}
                  <Text size="xs" c="dimmed" lineClamp={1} className="event-card__description">
                    {event.description || t("card.noDescription")}
                  </Text>

                  {/* Date & Time */}
                  <Group gap={6} align="center" wrap="nowrap">
                    <CalendarEventIcon size={14} className="event-card__icon-muted" />
                    <Text size="xs" className="event-card__date-text">
                      {formatLocalDate(event.start_at, i18n.language)}
                    </Text>
                    <Text size="xs" c="dimmed">·</Text>
                    <ClockIcon size={14} className="event-card__icon-muted" />
                    <Text size="xs" className="event-card__time-text">
                      {formatLocalTime(event.start_at, event.end_at, i18n.language)}
                    </Text>
                  </Group>

                  {/* ── Members ── */}
                  {raffleHasDrawn ? (
                    <div className="event-card__raffle-winners">
                      <div className="event-card__raffle-winners-badge">
                        <GiftIcon size={14} />
                        <span>{t("raffle.detail.winnersLabel")}</span>
                      </div>
                      <div className="event-card__members-left">
                        <EventCardAvatarStrip
                          members={members}
                          visibleMembers={visibleMembers}
                          hiddenMembersCount={hiddenMembersCount}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="event-card__members-bar">
                      <div className="event-card__members-left">
                        <EventCardAvatarStrip
                          members={members}
                          visibleMembers={visibleMembers}
                          hiddenMembersCount={hiddenMembersCount}
                        />
                      </div>
                    </div>
                  )}

                  {/* ── Footer: Sign-up button ── */}
                  {canInteract && !isPoll ? (
                    <div className="event-card__footer" onClick={(e) => e.stopPropagation()}>
                      <DepthToggle
                        pressed={isJoined}
                        onToggle={(joined) => {
                          if (joined) {
                            onJoinEvent(event.id);
                          } else {
                            onLeaveEvent(event.id);
                          }
                        }}
                        type={isJoined ? "danger" : "success"}
                        size="xs"
                        disabled={participantActionDisabled}
                        tooltip={isJoined ? t("button.leave") : t("button.join")}
                      >
                        {isJoined ? <UserMinusIcon size={14} /> : <UserPlusIcon size={14} />}
                        {isJoined ? t("button.leave") : t("button.join")}
                      </DepthToggle>
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
        onVotePoll={onVotePoll}
        votePending={votePending}
        onDrawRaffle={onDrawRaffle}
        drawRafflePending={drawRafflePending}
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

