import type { Event, MemberProfile, User } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
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
import { eventHasBehavior } from "@portal/utils/game-rules";

type MemberEntry = { user: User; profile: MemberProfile };

type EventCardProps = {
  event: Event;
  now: Date;
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canInteract: boolean;
  currentUserId: string | null;
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
  onUnarchiveEvent: (event: Event) => void;
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
  canCreate,
  canEdit,
  canArchive,
  canDelete,
  canInteract,
  currentUserId,
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
  const isPoll = eventHasBehavior(event.type, "poll");
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
  // Poll cards open the detail voting flow; signup constraints do not apply.
  const pollActionDisabledReasonKey = isArchived
    ? "button.disabled.archived"
    : hasEnded
      ? "button.disabled.ended"
      : null;

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
      <Tooltip>
        <TooltipTrigger render={<span data-disabled-tooltip-target />}>
          <Button
            onClick={() => onCopyMentions(event)}
            variant="outline"
            size="icon-sm"
            disabled={members.length === 0}
            aria-label={t("card.copyMentions")}
          >
            <CopyIcon size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("card.copyMentions")}</TooltipContent>
      </Tooltip>
    </div>
  ) : null;

  const canChangeArchiveState = event.archived_at ? canEdit : canArchive;
  const hasPrimaryActions = canEdit || canCreate;
  const hasLifecycleActions = canChangeArchiveState || canDelete;
  const menu = hasPrimaryActions || hasLifecycleActions ? (
    <DropdownMenu>
      <DropdownMenuTrigger render={(
        <Button variant="ghost" size="icon-sm" className="event-card__menu-btn" aria-label={t("menu.actions")} onClick={(clickEvent) => clickEvent.stopPropagation()} />
      )}>
          <DotsIcon size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        {canEdit ? (
          <DropdownMenuItem onClick={() => onEditEvent(event)}>
            <PencilIcon size={14} />
            {t("menu.edit")}
          </DropdownMenuItem>
        ) : null}
        {canCreate ? (
          <DropdownMenuItem onClick={() => onDuplicateEvent(event)}>
            <CopyIcon size={14} />
            {t("menu.duplicate")}
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <>
            <DropdownMenuItem onClick={() => onTogglePinEvent(event)}>
              {event.pinned ? <PinnedOffIcon size={14} /> : <PinIcon size={14} />}
              {event.pinned ? t("menu.unpin") : t("menu.pin")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleLockEvent(event)}>
              {event.signup_locked ? <LockOpenIcon size={14} /> : <LockIcon size={14} />}
              {event.signup_locked ? t("menu.unlockSignup") : t("menu.lockSignup")}
            </DropdownMenuItem>
          </>
        ) : null}
        {hasPrimaryActions && hasLifecycleActions ? <DropdownMenuSeparator /> : null}
        {canChangeArchiveState ? (
          <DropdownMenuItem
            onClick={() => {
              if (event.archived_at) {
                onUnarchiveEvent(event);
                return;
              }
              void requestArchiveEvent();
            }}
          >
            {event.archived_at ? <ArchiveOffIcon size={14} /> : <ArchiveIcon size={14} />}
            {event.archived_at ? t("menu.unarchive") : t("menu.archive")}
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDeleteEvent(event)}
          >
            <TrashIcon size={14} />
            {t("menu.delete")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const participantAction = canInteract ? (
    <div onClick={(clickEvent) => clickEvent.stopPropagation()}>
      {isPoll ? (
        <Tooltip>
          <TooltipTrigger render={<span data-disabled-tooltip-target />}>
            <Button
              onClick={() => onOpenDetail(event)}
              variant={isJoined ? "secondary" : "default"}
              size="sm"
              disabled={pollActionDisabledReasonKey !== null}
            >
              {isJoined ? t("poll.update") : t("poll.vote")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(pollActionDisabledReasonKey ?? (isJoined ? "poll.update" : "poll.vote"))}</TooltipContent>
        </Tooltip>
      ) : (
      <Tooltip>
        <TooltipTrigger render={<span data-disabled-tooltip-target />}>
          <Button
            aria-pressed={isJoined}
            onClick={() => {
              if (!isJoined) {
                onJoinEvent(event.id);
              } else {
                onLeaveEvent(event.id);
              }
            }}
            variant={isJoined ? "destructive" : "default"}
            size="sm"
            disabled={participantActionDisabled}
          >
            {isJoined ? <UserMinusIcon size={14} /> : <UserPlusIcon size={14} />}
            {isJoined ? t("button.leave") : t("button.join")}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t(participantActionDisabledReasonKey ?? (isJoined ? "button.leave" : "button.join"))}</TooltipContent>
      </Tooltip>
      )}
    </div>
  ) : null;

  return (
    <EventCardView
      event={event}
      now={now}
      members={members}
      flag={eventFlags.get(event.id)}
      onOpenDetail={() => onOpenDetail(event)}
      headerActions={headerActions}
      menu={menu}
      participantAction={participantAction}
    />
  );
}
