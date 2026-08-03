import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Group, Modal, Select, SimpleGrid, Text, Tooltip } from "@mantine/core";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { MediaGallery, buildMediaGalleryLabels } from "@portal/components/shared/MediaGallery";
import { resolveEventMediaUrl } from "@portal/utils/media";
import {
  CalendarEventIcon,
  ClockIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "@portal/components/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getParticipantActionDisabledReasonKey } from "./participant-action";
import { EventDetailMemberRoster } from "./EventDetailMemberRoster";
import { EventDetailPoll } from "./EventDetailPoll";
import { EventDetailRaffle } from "./EventDetailRaffle";
import "./EventDetailModal.css";

export type MemberEntry = { user: User; profile: MemberProfile };

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
  onVotePoll?: (eventId: string, optionIds: string[]) => void;
  votePending?: boolean;
  onDrawRaffle?: (eventId: string) => void;
  drawRafflePending?: boolean;
};

/*
 * 详情弹窗分两栏：左边是「这是什么活动」（类型、时间、说明、图），右边是「谁参与了」
 * （投票 / 抽奖 / 报名名单）。以前是一栏到底，有图才劈成两栏，于是同一个弹窗宽度会
 * 随附件有无在 820px 和满屏之间跳；现在宽度固定，图并进左栏。
 *
 * 弹窗整体不滚——右栏那份名单在读左栏说明的时候一直钉在眼前。滚的是名单本身，
 * 右栏的标题、报名按钮和加人下拉留在原地。
 */
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
  onVotePoll,
  votePending,
  onDrawRaffle,
  drawRafflePending,
}: EventDetailModalProps) {
  const { t, i18n } = useTranslation("events");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const mediaLabels = useMemo(() => buildMediaGalleryLabels(tc), [tc]);
  /*
   * 加人下拉的搜索词必须自己拿着。
   * 这个 Select 的 value 恒为 null——它不是一个选值控件，而是「选一个人就把他加进去」的动作触发器。
   * 但 value 一旦受控，Mantine 就不再在选中后回填搜索框（Select.mjs:205 的 !controlled 分支被跳过），
   * 而 value 又永远是 null，那条「value === null 就清空」的 effect（Select.mjs:154）也只在挂载时跑过一次。
   * 结果是：搜谁加谁之后，输入框里还留着刚才敲的名字，而这个人已经从候选里被过滤掉了，
   * 再点开就是一句 Nothing found——想连着加第二个人，得先手动把字删干净。
   */
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const isJoined = currentUserId ? members.some((entry) => entry.user.id === currentUserId) : false;
  const isFull = event?.capacity != null ? members.length >= event.capacity : false;
  const hasEnded = Boolean(event?.end_at && new Date(event.end_at) <= new Date());
  const isPoll = event?.type === "poll";
  const isRaffle = event?.type === "raffle";
  const showMemberAction = Boolean(currentUserId && (isJoined ? onLeave : onJoin));
  const memberActionDisabledReasonKey = event
    ? getParticipantActionDisabledReasonKey({
        isArchived: Boolean(event.archived_at),
        hasEnded,
        signupLocked: event.signup_locked,
        isFull,
        isJoined,
        pending: Boolean(joinPending || leavePending),
      })
    : null;
  const memberActionDisabled = event === null || memberActionDisabledReasonKey !== null;
  const memberActionLabel = isJoined
    ? t("button.leave")
    : isFull
      ? t("button.full")
      : t("button.join");
  /* 投票活动没有名单，没有 poll 数据时右栏就整个不存在——那时左栏铺满，不留半幅空白。 */
  const hasParticipationPane = isPoll ? Boolean(event?.poll) : true;

  useEffect(() => {
    setAddMemberSearch("");
  }, [event]);

  const handleRemoveParticipant = async (userId: string, username: string) => {
    if (!event) {
      return;
    }
    const eventId = event.id;
    const confirmed = await confirm({
      title: t("detail.confirm.removeMember.title"),
      description: (
        <Text size="sm">
          {t("detail.confirm.removeMember.description", { username })}
        </Text>
      ),
      confirmLabel: t("detail.removeMember"),
      cancelLabel: t("button.cancel"),
      intent: "danger",
    });
    if (confirmed) {
      onRemoveParticipant(eventId, userId);
    }
  };

  return (
    <Modal
      opened={event !== null}
      onClose={onClose}
      title={event?.title}
      size="min(980px, calc(100vw - 32px))"
      centered
      keepMounted={false}
      classNames={{
        body: "event-detail-modal__body",
        content: "event-detail-modal__content",
        header: "event-detail-modal__header",
        title: "event-detail-modal__title",
      }}
    >
      {event ? (
        <div className="event-detail-modal__layout" data-single={hasParticipationPane ? undefined : "true"}>
          <div className="event-detail-modal__pane event-detail-modal__pane--info">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={10}>
              <section className="event-detail-modal__meta-card event-detail-modal__meta-card--type">
                <CalendarEventIcon size={20} />
                <div>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">{t("detail.eventType")}</Text>
                  <Text size="sm" fw={700}>{t(`common:eventType.${event.type}`)}</Text>
                </div>
              </section>
              <section className="event-detail-modal__meta-card event-detail-modal__meta-card--time">
                <ClockIcon size={20} />
                <div>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">{t("detail.time")}</Text>
                  <Text size="sm" fw={600}>
                    {formatLocalDate(event.start_at, i18n.language)} - {formatLocalTime(event.start_at, event.end_at, i18n.language)}
                  </Text>
                </div>
              </section>
            </SimpleGrid>

            {event.description ? (
              <section className="event-detail-modal__section">
                <Text size="sm" fw={700} mb={4}>{t("detail.description")}</Text>
                <Text size="sm" c="dimmed" lh={1.55}>{event.description}</Text>
              </section>
            ) : null}

            {event.attachments && event.attachments.length > 0 ? (
              <MediaGallery images={event.attachments} resolveMediaUrl={resolveEventMediaUrl} labels={mediaLabels} />
            ) : null}
          </div>

          {hasParticipationPane ? (
            <div className="event-detail-modal__pane event-detail-modal__pane--participation">
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
                <section className="event-detail-modal__section event-detail-modal__section--members">
                  <Group justify="space-between" gap={12} mb={12} wrap="wrap">
                    <Group gap={8}>
                      <UsersIcon size={20} />
                      <Text size="md" fw={800}>
                        {event.capacity ? t("detail.membersWithCap", { count: members.length, capacity: event.capacity }) : t("detail.members", { count: members.length })}
                      </Text>
                    </Group>
                    {showMemberAction ? (
                      <Tooltip
                        label={memberActionDisabledReasonKey ? t(memberActionDisabledReasonKey) : ""}
                        disabled={!memberActionDisabledReasonKey}
                      >
                        <span data-disabled-tooltip-target className="event-detail-modal__member-action">
                          <Button
                            color={isJoined ? "red" : undefined}
                            size="sm"
                            leftSection={isJoined ? <UserMinusIcon size={14} /> : <UserPlusIcon size={14} />}
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
                            {memberActionLabel}
                          </Button>
                        </span>
                      </Tooltip>
                    ) : null}
                  </Group>

                  {canManage ? (
                    <Select
                      placeholder={t("detail.addMemberPlaceholder")}
                      searchable
                      clearable
                      mb={12}
                      value={null}
                      searchValue={addMemberSearch}
                      onSearchChange={setAddMemberSearch}
                      onChange={(userId) => {
                        if (userId) {
                          onAddParticipant(event.id, userId);
                        }
                        setAddMemberSearch("");
                      }}
                      disabled={event === null}
                      data={allUsers
                        .filter((entry) => entry.user.is_active && !entry.user.deleted_at && !members.some((m) => m.user.id === entry.user.id))
                        .map((entry) => ({ value: entry.user.id, label: entry.user.username }))
                      }
                      leftSection={<UserPlusIcon size={16} />}
                    />
                  ) : null}

                  <EventDetailMemberRoster
                    event={event}
                    members={members}
                    canManage={canManage}
                    onRemoveMember={(userId, username) => void handleRemoveParticipant(userId, username)}
                  />
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
