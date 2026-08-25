import type { Event, MemberProfile, User } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { MediaGallery, buildMediaGalleryLabels } from "@portal/components/shared/MediaGallery";
import { formatEventTime, formatLocaleParts } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import {
  CalendarEventIcon,
  ClockIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "@portal/components/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { eventHasBehavior, getEventTypeLabel } from "@portal/utils/game-rules";
import { getParticipantActionDisabledReasonKey } from "./participant-action";
import { EventDetailMemberRoster } from "./EventDetailMemberRoster";
import { EventDetailPoll } from "./EventDetailPoll";
import { EventDetailRaffle } from "./EventDetailRaffle";
import "./EventDetailContent.css";

export type MemberEntry = { user: User; profile: MemberProfile };

function formatLocalDate(startAt: string, locale: string): string {
  return formatLocaleParts(startAt, locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type EventDetailContentProps = {
  event: Event;
  members: MemberEntry[];
  allUsers: MemberEntry[];
  canManage: boolean;
  currentUserId?: string;
  joinPending?: boolean;
  leavePending?: boolean;
  onJoin?: (eventId: string) => void;
  onLeave?: (eventId: string) => void;
  onAddParticipant: (eventId: string, userId: string) => void;
  onRemoveParticipant: (eventId: string, userId: string) => void;
  onVotePoll?: (eventId: string, optionIds: string[]) => void;
  votePending?: boolean;
  onDrawRaffle?: (eventId: string) => void;
  drawRafflePending?: boolean;
};

/*
 * Event information and participation use separate columns. Only the roster
 * body scrolls so its heading and actions remain available.
 */
export function EventDetailContent({
  event,
  members,
  allUsers,
  canManage,
  currentUserId,
  joinPending,
  leavePending,
  onJoin,
  onLeave,
  onAddParticipant,
  onRemoveParticipant,
  onVotePoll,
  votePending,
  onDrawRaffle,
  drawRafflePending,
}: EventDetailContentProps) {
  const { t, i18n } = useTranslation("events");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const mediaLabels = useMemo(() => buildMediaGalleryLabels(tc), [tc]);
  /*
   * 加人下拉的搜索词必须自己拿着：它是「选一个人就把他加进去」的动作触发器，
   * 不是会保留选中值的普通选择框。选中后立即清空搜索词，才能连续添加多人。
   */
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const isJoined = currentUserId ? members.some((entry) => entry.user.id === currentUserId) : false;
  const isFull = event.capacity != null ? members.length >= event.capacity : false;
  const hasEnded = Boolean(event.end_at && new Date(event.end_at) <= new Date());
  const isPoll = eventHasBehavior(event.type, "poll");
  const isRaffle = eventHasBehavior(event.type, "raffle");
  const showMemberAction = Boolean(currentUserId && (isJoined ? onLeave : onJoin));
  const memberActionDisabledReasonKey = getParticipantActionDisabledReasonKey({
    isArchived: Boolean(event.archived_at),
    hasEnded,
    signupLocked: event.signup_locked,
    isFull,
    isJoined,
    pending: Boolean(joinPending || leavePending),
  });
  const memberActionDisabled = memberActionDisabledReasonKey !== null;
  const memberActionLabel = isJoined
    ? t("button.leave")
    : isFull
      ? t("button.full")
      : t("button.join");
  /* 投票活动没有名单，没有 poll 数据时右栏就整个不存在——那时左栏铺满，不留半幅空白。 */
  const hasParticipationPane = isPoll ? Boolean(event.poll) : true;

  useEffect(() => {
    setAddMemberSearch("");
  }, [event]);

  const handleRemoveParticipant = async (userId: string, display_name: string) => {
    const eventId = event.id;
    const confirmed = await confirm({
      title: t("detail.confirm.removeMember.title"),
      description: <p>{t("detail.confirm.removeMember.description", { display_name })}</p>,
      confirmLabel: t("detail.removeMember"),
      cancelLabel: t("button.cancel"),
      intent: "danger",
    });
    if (confirmed) {
      onRemoveParticipant(eventId, userId);
    }
  };

  return (
    <div className="event-detail-content__layout" data-single={hasParticipationPane ? undefined : "true"}>
          <div className="event-detail-content__pane event-detail-content__pane--info">
            <div className="event-detail-content__meta-grid">
              <section className="event-detail-content__meta-card event-detail-content__meta-card--type">
                <div className="event-detail-content__meta-heading">
                  <CalendarEventIcon size={20} />
                  <span className="event-detail-content__meta-label">{t("detail.eventType")}</span>
                </div>
                <strong className="event-detail-content__meta-value">
                  {getEventTypeLabel(event.type, i18n.language)}
                </strong>
              </section>
              <section className="event-detail-content__meta-card event-detail-content__meta-card--time" data-time="start">
                <div className="event-detail-content__meta-heading">
                  <ClockIcon size={20} />
                  <span className="event-detail-content__meta-label">{t("field.startsAt")}</span>
                </div>
                <time dateTime={event.start_at} className="event-detail-content__time-value">
                  <strong className="event-detail-content__time-date">
                    {formatLocalDate(event.start_at, i18n.language)}
                  </strong>
                  <span className="event-detail-content__time-clock">
                    {formatEventTime(event.start_at, i18n.language)}
                  </span>
                </time>
              </section>
              <section className="event-detail-content__meta-card event-detail-content__meta-card--time" data-time="end">
                <div className="event-detail-content__meta-heading">
                  <ClockIcon size={20} />
                  <span className="event-detail-content__meta-label">{t("field.endsAt")}</span>
                </div>
                {event.end_at ? (
                  <time dateTime={event.end_at} className="event-detail-content__time-value">
                    <strong className="event-detail-content__time-date">
                      {formatLocalDate(event.end_at, i18n.language)}
                    </strong>
                    <span className="event-detail-content__time-clock">
                      {formatEventTime(event.end_at, i18n.language)}
                    </span>
                  </time>
                ) : (
                  <span className="event-detail-content__time-empty">
                    {t("detail.noEnd")}
                  </span>
                )}
              </section>
            </div>

            {event.description ? (
              <section className="event-detail-content__section">
                <h2 className="event-detail-content__section-title">{t("detail.description")}</h2>
                <p className="event-detail-content__description">{event.description}</p>
              </section>
            ) : null}

            {event.attachments && event.attachments.length > 0 ? (
              <MediaGallery
                className="event-detail-content__media"
                images={event.attachments}
                resolveMediaUrl={resolveMediaUrl}
                labels={mediaLabels}
              />
            ) : null}
          </div>

          {hasParticipationPane ? (
            <div className="event-detail-content__pane event-detail-content__pane--participation">
              {isPoll && event.poll ? (
                <EventDetailPoll
                  event={event}
                  poll={event.poll}
                  allUsers={allUsers}
                  hasEnded={hasEnded}
                  onVotePoll={onVotePoll}
                  votePending={votePending}
                />
              ) : null}

              {isRaffle ? (
                <EventDetailRaffle
                  event={event}
                  members={members}
                  allUsers={allUsers}
                  canManage={canManage}
                  onDrawRaffle={onDrawRaffle}
                  drawRafflePending={drawRafflePending}
                />
              ) : null}

              {!isPoll ? (
                <section className="event-detail-content__section event-detail-content__section--members">
                  <div className="event-detail-content__members-header">
                    <div className="event-detail-content__members-heading">
                      <UsersIcon size={20} />
                      <h2>
                        {event.capacity ? t("detail.membersWithCap", { count: members.length, capacity: event.capacity }) : t("detail.members", { count: members.length })}
                      </h2>
                    </div>
                    {showMemberAction ? (
                      <Tooltip>
                        <TooltipTrigger render={<span data-disabled-tooltip-target className="event-detail-content__member-action" />}>
                          <Button
                            size="sm"
                            variant={isJoined ? "destructive" : "default"}
                            onClick={() => {
                              if (isJoined) {
                                onLeave?.(event.id);
                                return;
                              }
                              onJoin?.(event.id);
                            }}
                            disabled={memberActionDisabled}
                            loading={joinPending || leavePending}
                          >
                            {isJoined ? <UserMinusIcon size={14} /> : <UserPlusIcon size={14} />}
                            {memberActionLabel}
                          </Button>
                        </TooltipTrigger>
                        {memberActionDisabledReasonKey ? <TooltipContent>{t(memberActionDisabledReasonKey)}</TooltipContent> : null}
                      </Tooltip>
                    ) : null}
                  </div>

                  {canManage ? (
                    <div className="event-detail-content__add-member">
                      <UserPlusIcon size={16} aria-hidden="true" />
                      <Input
                        list={`event-${event.id}-members`}
                        placeholder={t("detail.addMemberPlaceholder")}
                        value={addMemberSearch}
                        onChange={(inputEvent) => {
                          const next = inputEvent.currentTarget.value;
                          setAddMemberSearch(next);
                          const member = allUsers.find((entry) => entry.user.display_name === next && entry.user.is_active && !entry.user.deleted_at && !members.some((current) => current.user.id === entry.user.id));
                          if (member) {
                            onAddParticipant(event.id, member.user.id);
                            setAddMemberSearch("");
                          }
                        }}
                        aria-label={t("detail.addMemberPlaceholder")}
                      />
                      <datalist id={`event-${event.id}-members`}>
                        {allUsers
                        .filter((entry) => entry.user.is_active && !entry.user.deleted_at && !members.some((m) => m.user.id === entry.user.id))
                        .map((entry) => <option key={entry.user.id} value={entry.user.display_name} />)}
                      </datalist>
                    </div>
                  ) : null}

                  <EventDetailMemberRoster
                    event={event}
                    members={members}
                    canManage={canManage}
                    onRemoveMember={(userId, display_name) => void handleRemoveParticipant(userId, display_name)}
                  />
                </section>
              ) : null}
            </div>
          ) : null}
    </div>
  );
}
