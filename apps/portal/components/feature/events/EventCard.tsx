import type { Event, MemberProfile, User } from "@guild/shared";
import { EVENT_TYPE_COLORS, UNKNOWN_EVENT_TYPE_COLOR } from "@portal/utils/event-colors";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  HoverCard,
  Menu,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
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
import React from "react";
import { useTranslation } from "react-i18next";
import { EventCardAvatarStrip } from "./EventCardAvatarStrip";
import { EventClassQuotaChips } from "./EventClassQuotaChips";
import { summariseEventClassQuotas } from "./class-quota-view";
import { getParticipantActionDisabledReasonKey } from "./participant-action";

// Icons are not carried in the game config (config stores string identifiers like
// "TargetOutlined", not React nodes). The local map is keyed on event type ids;
// unknown types fall back to CalendarEventIcon via the ?? below.
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

// The card's meta row is one line wide. "2026年7月25日周六" plus "下午5:15 - 下午7:15"
// overflowed it on every card, so the year is only spelled out when the event is
// not in the current year, and the clock format is left to the locale (zh-CN
// resolves to 24h, en-US keeps AM/PM) instead of being forced to 12h.
function formatLocalDate(startAt: string, locale: string, now: Date): string {
  const date = new Date(startAt);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    weekday: "short",
    ...(sameYear ? null : { year: "numeric" }),
    month: "short",
    day: "numeric",
  });
}

function formatLocalTime(startAt: string, endAt: string | null, locale: string): string {
  const start = new Date(startAt);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startTime = start.toLocaleTimeString(locale, timeOpts);
  if (!endAt) return startTime;
  const end = new Date(endAt);
  const endTime = end.toLocaleTimeString(locale, timeOpts);
  return `${startTime}–${endTime}`;
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
        <span
          className="event-card__status-icon"
          data-animate-icon-trigger
          role="img"
          aria-label={title}
          tabIndex={0}
        >
          {children}
        </span>
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

type EventCardProps = {
  event: Event;
  now: Date;
  canManage: boolean;
  canInteract: boolean;
  currentUserId: string | null;
  focusedEventId: string | null;
  eventFlags: Map<string, "NEW" | "UPDATED">;
  eventMembersMap: Map<string, MemberEntry[]>;
  allUsers: MemberEntry[];
  joinPending: boolean;
  leavePending: boolean;
  onOpenDetail: (event: Event) => void;
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
};

export function EventCard({
  event,
  now,
  canManage,
  canInteract,
  currentUserId,
  focusedEventId,
  eventFlags,
  eventMembersMap,
  allUsers,
  joinPending,
  leavePending,
  onOpenDetail,
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
}: EventCardProps) {
  const { t, i18n } = useTranslation("events");
  const confirm = useConfirmDialog();
  const participantMembers = eventMembersMap.get(event.id) ?? [];
  const isPoll = event.type === "poll";
  const isRaffle = event.type === "raffle";
  const hasEnded = event.end_at != null && new Date(event.end_at) <= now;
  const raffleHasDrawn = isRaffle && (event.raffle_winners?.length ?? 0) > 0;
  const pollVoterMembers = isPoll && event.poll
    ? (() => {
        const voterIds = new Set(event.poll.options.flatMap((option) => option.voter_ids));
        return allUsers.filter((entry) => voterIds.has(entry.user.id));
      })()
    : [];
  const members = isPoll ? pollVoterMembers : participantMembers;
  const joinedCount = members.length;
  const flag = eventFlags.get(event.id);
  const typeColor = EVENT_TYPE_COLORS[event.type] ?? UNKNOWN_EVENT_TYPE_COLOR;
  const isFull = event.capacity !== null && joinedCount >= event.capacity;
  const isJoined = currentUserId ? members.some((member) => member.user.id === currentUserId) : false;
  const isFocused = focusedEventId === event.id;
  const isArchived = Boolean(event.archived_at);
  const quotaSummary = summariseEventClassQuotas(event, members);
  /*
   * 进度条读的是容量，跟右上角那个 12/20 是同一个数——两处对不上的话，用户会以为
   * 其中一个在骗人。没设容量就没有分母，画不出进度，整条不渲染。
   */
  const capacityRatio = event.capacity !== null && event.capacity > 0
    ? Math.min(1, joinedCount / event.capacity)
    : null;
  const participantActionDisabledReasonKey = getParticipantActionDisabledReasonKey({
    isArchived,
    hasEnded,
    signupLocked: event.signup_locked,
    isFull,
    isJoined,
    pending: joinPending || leavePending,
  });
  const participantActionDisabled = participantActionDisabledReasonKey !== null;

  const requestArchiveEvent = async () => {
    const confirmed = await confirm({
      title: t("archive.confirmTitle"),
      description: t("archive.confirmDescription", { title: event.title }),
      confirmLabel: t("archive.confirm"),
      cancelLabel: t("archive.cancel"),
      intent: "warning",
    });
    if (confirmed) {
      onArchiveEvent(event.id);
    }
  };

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
          color="portal-brand"
          icon={<PinIcon size={16} />}
          title={t("tooltip.pinned.title")}
          description={t("tooltip.pinned.desc")}
        >
          <PinIcon size={16} className="event-card__status-icon--pinned" />
        </EventStatusIndicator>
      ) : null}
      {event.signup_locked ? (
        <EventStatusIndicator
          color="red"
          icon={<LockIcon size={16} />}
          title={t("tooltip.locked.title")}
          description={t("tooltip.locked.desc")}
        >
          <LockIcon size={16} className="event-card__status-icon--locked" />
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
          <SparklesIcon size={16} className="event-card__status-icon--new" />
        </EventStatusIndicator>
      ) : null}
      {flag === "UPDATED" ? (
        <EventStatusIndicator
          color="orange"
          icon={<Sparkles2Icon size={16} />}
          title={t("tooltip.updated.title")}
          description={t("tooltip.updated.desc")}
        >
          <Sparkles2Icon size={16} className="event-card__status-icon--updated" />
        </EventStatusIndicator>
      ) : null}
    </>
  );

  /*
   * The card used to be role="button" + tabIndex={0}, but it also holds
   * real buttons (copy mentions, the kebab menu, the signup actions), so
   * it was a widget with focusable descendants — unusable by keyboard and
   * screen reader alike. The whole-card click stays as a mouse shortcut;
   * the title below is the focusable affordance that opens the detail.
   */
  return (
    <Paper withBorder className={`event-card${isFocused ? " event-card--focused" : ""}`} onClick={() => onOpenDetail(event)} style={{ cursor: "pointer" }}>
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
            <div className="event-card__header-actions" onClick={(clickEvent) => clickEvent.stopPropagation()}>
              <Tooltip label={t("card.copyMentions")}>
                <span data-disabled-tooltip-target>
                  <ActionIcon
                    onClick={() => onCopyMentions(event)}
                    variant="default"
                    size="sm"
                    disabled={members.length === 0}
                    aria-label={t("card.copyMentions")}
                  >
                    <CopyIcon size={14} />
                  </ActionIcon>
                </span>
              </Tooltip>
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
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" className="event-card__menu-btn" aria-label={t("menu.actions")} onClick={(clickEvent) => clickEvent.stopPropagation()}>
                  <DotsIcon size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown onClick={(clickEvent) => clickEvent.stopPropagation()}>
                <Menu.Item leftSection={<PencilIcon size={14} />} onClick={() => onEditEvent(event)}>
                  {t("menu.edit")}
                </Menu.Item>
                <Menu.Item leftSection={<CopyIcon size={14} />} onClick={() => onDuplicateEvent(event)}>
                  {t("menu.duplicate")}
                </Menu.Item>
                <Menu.Item
                  leftSection={event.pinned ? <PinnedOffIcon size={14} /> : <PinIcon size={14} />}
                  onClick={() => onTogglePinEvent(event)}
                >
                  {event.pinned ? t("menu.unpin") : t("menu.pin")}
                </Menu.Item>
                <Menu.Item
                  leftSection={event.signup_locked ? <LockOpenIcon size={14} /> : <LockIcon size={14} />}
                  onClick={() => onToggleLockEvent(event)}
                >
                  {event.signup_locked ? t("menu.unlockSignup") : t("menu.lockSignup")}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  leftSection={event.archived_at ? <ArchiveOffIcon size={14} /> : <ArchiveIcon size={14} />}
                  onClick={() => {
                    if (event.archived_at) {
                      onUnarchiveEvent(event.id);
                      return;
                    }
                    void requestArchiveEvent();
                  }}
                >
                  {event.archived_at ? t("menu.unarchive") : t("menu.archive")}
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<TrashIcon size={14} />}
                  onClick={() => onDeleteEvent(event)}
                >
                  {t("menu.delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="event-card__body">
        <Stack gap={8}>
          <div className="event-card__title-row">
            <UnstyledButton
              className="event-card__title-btn"
              onClick={() => onOpenDetail(event)}
            >
              <Text component="h2" fw={700} size="md" className="event-card__title">
                {event.title}
              </Text>
            </UnstyledButton>
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
              {formatLocalDate(event.start_at, i18n.language, now)}
            </Text>
            <Text size="xs" c="dimmed">·</Text>
            <ClockIcon size={14} className="event-card__icon-muted" />
            <Text size="xs" className="event-card__time-text">
              {formatLocalTime(event.start_at, event.end_at, i18n.language)}
            </Text>
          </Group>

          {/* ── Members ── */}
          {capacityRatio !== null ? (
            <div
              className="event-card__capacity-bar"
              data-full={isFull ? "true" : undefined}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={event.capacity ?? undefined}
              aria-valuenow={joinedCount}
              aria-label={t("card.capacityProgress", { joined: joinedCount, capacity: event.capacity })}
            >
              <span
                className="event-card__capacity-bar-fill"
                style={{ "--event-card-capacity-ratio": capacityRatio } as React.CSSProperties}
              />
            </div>
          ) : null}
          {raffleHasDrawn ? (
            <div className="event-card__raffle-winners">
              <div className="event-card__raffle-winners-badge">
                <GiftIcon size={14} />
                <span>{t("raffle.detail.winnersLabel")}</span>
              </div>
              <div className="event-card__members-left">
                <EventCardAvatarStrip members={members} />
              </div>
            </div>
          ) : (
            <div className="event-card__members-bar">
              <div className="event-card__members-left">
                <EventCardAvatarStrip members={members} />
              </div>
            </div>
          )}

          {quotaSummary ? <EventClassQuotaChips summary={quotaSummary} /> : null}

          {/* ── Footer: Sign-up button ── */}
          {canInteract && !isPoll ? (
            <div className="event-card__footer" onClick={(clickEvent) => clickEvent.stopPropagation()}>
              <Tooltip label={t(participantActionDisabledReasonKey ?? (isJoined ? "button.leave" : "button.join"))}>
                <span data-disabled-tooltip-target>
                <Button
                aria-pressed={isJoined}
                onClick={() => {
                  if (!isJoined) {
                    onJoinEvent(event.id);
                  } else {
                    onLeaveEvent(event.id);
                  }
                }}
                color={isJoined ? "red" : "portal-brand"}
                variant={isJoined ? "light" : "filled"}
                size="sm"
                disabled={participantActionDisabled}
                leftSection={isJoined ? <UserMinusIcon size={14} /> : <UserPlusIcon size={14} />}
              >
                {isJoined ? t("button.leave") : t("button.join")}
              </Button>
              </span>
              </Tooltip>
            </div>
          ) : null}
        </Stack>
      </div>
    </Paper>
  );
}
