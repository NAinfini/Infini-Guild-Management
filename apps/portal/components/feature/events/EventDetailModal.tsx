import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Grid, Group, Modal, Progress, Select, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { MediaGallery, buildMediaGalleryLabels } from "@portal/components/shared/MediaGallery";
import { resolveEventMediaUrl } from "@portal/utils/media";
import {
  CalendarEventIcon,
  ChartBarIcon,
  CheckIcon,
  ClockIcon,
  GiftIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "@portal/components/icons";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { getParticipantActionDisabledReasonKey } from "./participant-action";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
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

function resolveVoterEntries(voterIds: string[], allUsers: MemberEntry[]): MemberEntry[] {
  return voterIds
    .map((userId) => allUsers.find((entry) => entry.user.id === userId))
    .filter((entry): entry is MemberEntry => Boolean(entry));
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
  const classCatalog = useClassCatalogStore((state) => state.items);
  const confirm = useConfirmDialog();
  const mediaLabels = useMemo(() => buildMediaGalleryLabels(tc), [tc]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [localHasVoted, setLocalHasVoted] = useState(false);
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
  const raffleWinners = event?.raffle_winners ?? [];
  const raffleHasDrawn = raffleWinners.length > 0;
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
  const pollTotalVotes = event?.poll?.options.reduce((total, option) => total + option.vote_count, 0) ?? 0;

  useEffect(() => {
    if (!event) {
      return;
    }
    const serverHasVoted = event.poll?.has_voted ?? false;
    setSelectedOptionIds(event.poll?.options.filter((option) => option.voted_by_me).map((option) => option.id) ?? []);
    setLocalHasVoted(serverHasVoted);
    setAddMemberSearch("");
  }, [event]);

  const togglePollOption = (optionId: string, disabled: boolean) => {
    if (disabled) {
      return;
    }
    setSelectedOptionIds((current) =>
      current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
    );
  };

  const handleDrawRaffle = async () => {
    if (!event || !onDrawRaffle) {
      return;
    }
    const eventId = event.id;
    const confirmed = await confirm({
      title: t("raffle.confirm.draw.title"),
      description: (
        <Text size="sm">
          {t("raffle.confirm.draw.description", {
            count: event.winner_count ?? 0,
            pool: members.length,
          })}
        </Text>
      ),
      confirmLabel: t("raffle.detail.drawNow"),
      cancelLabel: t("button.cancel"),
      intent: "warning",
    });
    if (confirmed) {
      onDrawRaffle(eventId);
    }
  };

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

  const handlePollOptionKeyDown = (optionId: string, disabled: boolean, keyEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyEvent.key !== "Enter" && keyEvent.key !== " ") {
      return;
    }
    keyEvent.preventDefault();
    togglePollOption(optionId, disabled);
  };

  return (
    <Modal
      opened={event !== null}
      onClose={onClose}
      title={event?.title}
      size={event?.attachments && event.attachments.length > 0 ? "calc(100vw - 80px)" : "min(820px, calc(100vw - 32px))"}
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
        <Grid gap={16} className="event-detail-modal__grid">
          <Grid.Col span={event.attachments && event.attachments.length > 0 ? { base: 12, md: 5 } : 12}>
            <Stack gap={14}>
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

              {isPoll && event.poll ? (
                <section className="event-detail-modal__section event-detail-modal__section--poll">
                  <Group justify="space-between" gap={12} mb={12} wrap="nowrap" className="event-detail-modal__poll-header">
                    <Group gap={8}>
                      <ChartBarIcon size={20} />
                      <Text size="md" fw={800}>{t("poll.detail.title")}</Text>
                    </Group>
                    <Text size="xs" fw={700} className="event-detail-modal__poll-total">
                      {t("poll.detail.votes", { count: pollTotalVotes })}
                    </Text>
                  </Group>
                  <Stack gap={12}>
                    <div className="event-detail-modal__poll-result-board">
                      {event.poll.options.map((option) => {
                        const percent = pollTotalVotes > 0 ? Math.round((option.vote_count / pollTotalVotes) * 100) : 0;
                        const voterEntries = resolveVoterEntries(option.voter_ids, allUsers);
                        const missingVoterIds = option.voter_ids.filter((userId) => !voterEntries.some((entry) => entry.user.id === userId));
                        const visibleVoters = voterEntries.slice(0, 10);
                        const hiddenVoterCount = Math.max(0, voterEntries.length - visibleVoters.length);
                        const isSelectedOption = selectedOptionIds.includes(option.id);
                        const optionDisabled = event === null || !event.poll?.can_vote || !onVotePoll || hasEnded || Boolean(event.archived_at) || Boolean(votePending);
                        return (
                          <div
                            key={option.id}
                            role="checkbox"
                            aria-checked={isSelectedOption}
                            aria-disabled={optionDisabled}
                            tabIndex={optionDisabled ? -1 : 0}
                            className={`event-detail-modal__poll-result-row${isSelectedOption ? " event-detail-modal__poll-result-row--selected" : ""}${optionDisabled ? " event-detail-modal__poll-result-row--disabled" : ""}`}
                            onClick={() => togglePollOption(option.id, optionDisabled)}
                            onKeyDown={(keyEvent) => handlePollOptionKeyDown(option.id, optionDisabled, keyEvent)}
                          >
                            <div className="event-detail-modal__poll-result-main">
                              <div className="event-detail-modal__poll-result-top">
                                <Group gap={9} wrap="nowrap" className="event-detail-modal__poll-choice">
                                  <span className="event-detail-modal__poll-choice-indicator" aria-hidden="true">
                                    {isSelectedOption ? <CheckIcon size={14} /> : null}
                                  </span>
                                  <Text size="sm" fw={800}>{option.label}</Text>
                                </Group>
                                <Group gap={8} wrap="nowrap" className="event-detail-modal__poll-result-stats">
                                  <Text size="xs" fw={700} className="event-detail-modal__poll-option-votes">
                                    {t("poll.detail.votes", { count: option.vote_count })}
                                  </Text>
                                  <Text size="xs" fw={900} className="event-detail-modal__poll-percent">{percent}%</Text>
                                </Group>
                              </div>
                              <Progress value={percent} color="portal-brand" size="md" className="event-detail-modal__poll-progress" />
                              {option.voter_ids.length > 0 ? (
                                <div className="event-detail-modal__poll-voters">
                                  {visibleVoters.map((entry) => (
                                    <div key={entry.user.id} className="event-detail-modal__poll-voter-chip">
                                      <MemberRoleAvatar user={entry.user} profile={entry.profile} size={28} />
                                      <Text size="xs" fw={700} truncate>{entry.user.username}</Text>
                                    </div>
                                  ))}
                                  {hiddenVoterCount > 0 ? (
                                    <Text size="xs" fw={700} c="dimmed" className="event-detail-modal__poll-voter-overflow">
                                      +{hiddenVoterCount}
                                    </Text>
                                  ) : null}
                                  {missingVoterIds.map((userId) => (
                                    <Text key={userId} size="xs" c="dimmed" className="event-detail-modal__poll-voter-missing">
                                      {userId}
                                    </Text>
                                  ))}
                                </div>
                              ) : (
                                <Text size="xs" c="dimmed" className="event-detail-modal__poll-empty-voters">
                                  {t("poll.detail.noVotes")}
                                </Text>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="event-detail-modal__poll-actions">
                      {!event.poll.can_vote || hasEnded || event.archived_at ? (
                        <Text size="xs" c="dimmed">{hasEnded ? t("poll.status.closed") : t("poll.status.readOnly")}</Text>
                      ) : null}
                      {/* Voting is an authenticated interaction. Guests can read poll results but get no vote action. */}
                      {onVotePoll ? (
                        <Button
                          color="portal-brand"
                          size="sm"
                          loading={votePending}
                          disabled={event === null || !event.poll.can_vote || hasEnded || Boolean(event.archived_at) || selectedOptionIds.length === 0}
                          onClick={() => {
                            onVotePoll(event.id, selectedOptionIds);
                            setLocalHasVoted(true);
                          }}
                        >
                          {localHasVoted ? t("poll.update") : t("poll.vote")}
                        </Button>
                      ) : null}
                    </div>
                  </Stack>
                </section>
              ) : null}

              {isRaffle ? (
                <section className="event-detail-modal__section event-detail-modal__section--raffle">
                  <Group justify="space-between" gap={12} mb={12} wrap="nowrap">
                    <Group gap={8}>
                      <GiftIcon size={20} />
                      <Text size="md" fw={800}>{t("raffle.detail.title")}</Text>
                    </Group>
                    {raffleHasDrawn ? (
                      <Text size="xs" fw={700} c="dimmed">{t("raffle.status.drawn")}</Text>
                    ) : canManage && onDrawRaffle && members.length > 0 ? (
                      <Button
                        variant="light"
                        color="pink"
                        size="xs"
                        loading={drawRafflePending}
                        disabled={event === null || Boolean(event.archived_at)}
                        leftSection={<GiftIcon size={14} />}
                        onClick={() => void handleDrawRaffle()}
                      >
                        {t("raffle.detail.drawNow")}
                      </Button>
                    ) : (
                      <Text size="xs" fw={700} c="dimmed">{t("raffle.status.pendingDraw")}</Text>
                    )}
                  </Group>
                  {raffleHasDrawn ? (
                    <Stack gap={8}>
                      <Text size="sm" fw={600} c="dimmed">{t("raffle.detail.winnersLabel")}</Text>
                      {raffleWinners.map((winner) => {
                        const entry = allUsers.find((e) => e.user.id === winner.user_id);
                        return (
                          <Group key={winner.id} gap={10} wrap="nowrap">
                            {entry ? (
                              <>
                                <MemberRoleAvatar user={entry.user} profile={entry.profile} size={36} withTooltip={false} />
                                <Text size="sm" fw={700}>{entry.user.username}</Text>
                              </>
                            ) : (
                              <Text size="sm" c="dimmed">{winner.user_id}</Text>
                            )}
                          </Group>
                        );
                      })}
                    </Stack>
                  ) : (
                    <Stack gap={4}>
                      <Text size="sm" c="dimmed">
                        {t("raffle.detail.winnerCount", { count: event.winner_count ?? 0 })}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {t("raffle.detail.pool", { count: members.length })}
                      </Text>
                      {!canManage ? (
                        <Text size="xs" c="dimmed">{t("raffle.detail.pendingDraw")}</Text>
                      ) : null}
                    </Stack>
                  )}
                </section>
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
                        <span data-disabled-tooltip-target style={{ display: "inline-flex" }}>
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

                  {members.length === 0 ? (
                    <Text c="dimmed" size="sm">{t("detail.noMembers")}</Text>
                  ) : (
                    <div className="event-detail-modal__member-list">
                      <Stack gap={8}>
                        {members.map((entry) => (
                          <Group key={entry.user.id} gap={10} className="event-detail-modal__member-row" wrap="nowrap">
                            <MemberRoleAvatar user={entry.user} profile={entry.profile} size={40} withTooltip={false} />
                            <div className="event-detail-modal__member-info">
                              <Text size="sm" fw={700}>{entry.user.username}</Text>
                              <Group gap={6}>
                                <Text size="xs" c="dimmed">
                                  {entry.profile.classes[0]
                                    ? resolveClassCatalogItem(entry.profile.classes[0], classCatalog).label
                                    : "-"}
                                </Text>
                                <Text size="xs" c="dimmed">-</Text>
                                <Text size="xs" c="dimmed">{t("detail.power", { value: entry.profile.power ?? "-" })}</Text>
                              </Group>
                            </div>
                            {canManage ? (
                              <Button
                                color="red"
                                variant="light"
                                size="sm"
                                leftSection={<UserMinusIcon size={14} />}
                                onClick={() => void handleRemoveParticipant(entry.user.id, entry.user.username)}
                                disabled={event === null}
                              >
                                {t("detail.removeMember")}
                              </Button>
                            ) : null}
                          </Group>
                        ))}
                      </Stack>
                    </div>
                  )}
                </section>
              ) : null}
            </Stack>
          </Grid.Col>

          {event.attachments && event.attachments.length > 0 ? (
            <Grid.Col span={{ base: 12, md: 7 }}>
              <MediaGallery images={event.attachments} resolveMediaUrl={resolveEventMediaUrl} labels={mediaLabels} />
            </Grid.Col>
          ) : null}
        </Grid>
      ) : null}
    </Modal>
  );
}
