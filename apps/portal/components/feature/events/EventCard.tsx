import type { Event, MemberProfile, User } from "@guild/shared";
import { ActionIcon, Button, Menu, Tooltip } from "@mantine/core";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import {
  ArchiveIcon,
  ArchiveOffIcon,
  CopyIcon,
  DotsIcon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  PinIcon,
  PinnedOffIcon,
  TrashIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { EventCardView } from "./EventCardView";
import { getParticipantActionDisabledReasonKey } from "./participant-action";

type MemberEntry = { user: User; profile: MemberProfile };

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

/*
 * 活动卡的容器：算出「这张卡该显示谁、当前用户能不能操作」，再把交互件塞进
 * EventCardView 的插槽。版式一概不在这里，全在展示层——周期模板编辑器的预览卡
 * 复用的就是那一层。
 */
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
  const { t } = useTranslation("events");
  const confirm = useConfirmDialog();
  const participantMembers = eventMembersMap.get(event.id) ?? [];
  const isPoll = event.type === "poll";
  const hasEnded = event.end_at != null && new Date(event.end_at) <= now;
  const pollVoterMembers = isPoll && event.poll
    ? (() => {
        const voterIds = new Set(event.poll.options.flatMap((option) => option.voter_ids));
        return allUsers.filter((entry) => voterIds.has(entry.user.id));
      })()
    : [];
  const members = isPoll ? pollVoterMembers : participantMembers;
  const joinedCount = members.length;
  const isFull = event.capacity !== null && joinedCount >= event.capacity;
  const isJoined = currentUserId ? members.some((member) => member.user.id === currentUserId) : false;
  const isArchived = Boolean(event.archived_at);
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

  const headerActions = canInteract && !isPoll ? (
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
    </div>
  ) : null;

  const menu = canManage ? (
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
  ) : null;

  const footer = canInteract && !isPoll ? (
    <div onClick={(clickEvent) => clickEvent.stopPropagation()}>
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
  ) : null;

  return (
    <EventCardView
      event={event}
      now={now}
      members={members}
      flag={eventFlags.get(event.id)}
      isFocused={focusedEventId === event.id}
      onOpenDetail={() => onOpenDetail(event)}
      headerActions={headerActions}
      menu={menu}
      footer={footer}
    />
  );
}
