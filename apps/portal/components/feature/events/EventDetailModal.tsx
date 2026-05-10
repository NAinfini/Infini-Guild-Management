import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Grid, Group, Modal, Progress, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { MediaGallery, buildMediaGalleryLabels } from "@portal/components/shared/MediaGallery";
import {
  IconCalendarEvent,
  IconChartBar,
  IconClock,
  IconCheck,
  IconUserMinus,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import "./EventDetailModal.css";

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
}: EventDetailModalProps) {
  const { t, i18n } = useTranslation("events");
  const { t: tc } = useTranslation("common");
  const mediaLabels = useMemo(() => buildMediaGalleryLabels(tc), [tc]);
  const [renderedEvent, setRenderedEvent] = useState<Event | null>(event);
  const [renderedMembers, setRenderedMembers] = useState<MemberEntry[]>(members);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const modalEvent = event ?? renderedEvent;
  const modalMembers = event ? members : renderedMembers;
  const isJoined = currentUserId ? modalMembers.some((entry) => entry.user.id === currentUserId) : false;
  const isFull = modalEvent?.capacity != null ? modalMembers.length >= modalEvent.capacity : false;
  const hasEnded = Boolean(modalEvent?.end_at && new Date(modalEvent.end_at) < new Date());
  const isPoll = modalEvent?.type === "poll";
  const showMemberAction = Boolean(currentUserId && (isJoined ? onLeave : onJoin));
  const memberActionDisabled = modalEvent
    ? event === null || modalEvent.signup_locked || Boolean(modalEvent.archived_at) || hasEnded || (!isJoined && isFull)
    : true;
  const memberActionLabel = isJoined
    ? t("button.leave")
    : isFull
      ? t("button.full")
      : t("button.join");
  const pollTotalVotes = modalEvent?.poll?.options.reduce((total, option) => total + option.vote_count, 0) ?? 0;

  useEffect(() => {
    if (event) {
      setRenderedEvent(event);
      setRenderedMembers(members);
    }
  }, [event, members]);

  useEffect(() => {
    if (!event) {
      return;
    }
    setSelectedOptionIds(event.poll?.options.filter((option) => option.voted_by_me).map((option) => option.id) ?? []);
  }, [event]);

  const togglePollOption = (optionId: string, disabled: boolean) => {
    if (disabled) {
      return;
    }
    setSelectedOptionIds((current) =>
      current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
    );
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
      title={modalEvent?.title}
      size={modalEvent?.attachments && modalEvent.attachments.length > 0 ? "calc(100vw - 80px)" : "min(820px, calc(100vw - 32px))"}
      centered
      transitionProps={{ onExited: () => { setRenderedEvent(null); setRenderedMembers([]); } }}
      classNames={{
        body: "event-detail-modal__body",
        content: "event-detail-modal__content",
        header: "event-detail-modal__header",
        title: "event-detail-modal__title",
      }}
    >
      {modalEvent ? (
        <Grid gutter={16} className="event-detail-modal__grid">
          <Grid.Col span={modalEvent.attachments && modalEvent.attachments.length > 0 ? { base: 12, md: 5 } : 12}>
            <Stack gap={14}>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={10}>
                <section className="event-detail-modal__meta-card event-detail-modal__meta-card--type">
                  <IconCalendarEvent size={20} />
                  <div>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">{t("detail.eventType")}</Text>
                    <Text size="sm" fw={700}>{t(`common:eventType.${modalEvent.type}`)}</Text>
                  </div>
                </section>
                <section className="event-detail-modal__meta-card event-detail-modal__meta-card--time">
                  <IconClock size={20} />
                  <div>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">{t("detail.time")}</Text>
                    <Text size="sm" fw={600}>
                      {formatLocalDate(modalEvent.start_at, i18n.language)} - {formatLocalTime(modalEvent.start_at, modalEvent.end_at, i18n.language)}
                    </Text>
                  </div>
                </section>
              </SimpleGrid>

              {modalEvent.description ? (
                <section className="event-detail-modal__section">
                  <Text size="sm" fw={700} mb={4}>{t("detail.description")}</Text>
                  <Text size="sm" c="dimmed" lh={1.55}>{modalEvent.description}</Text>
                </section>
              ) : null}

              {isPoll && modalEvent.poll ? (
                <section className="event-detail-modal__section event-detail-modal__section--poll">
                  <Group justify="space-between" gap={12} mb={12} wrap="nowrap" className="event-detail-modal__poll-header">
                    <Group gap={8}>
                      <IconChartBar size={20} />
                      <Text size="md" fw={800}>{t("poll.detail.title")}</Text>
                    </Group>
                    <Text size="xs" fw={700} className="event-detail-modal__poll-total">
                      {t("poll.detail.votes", { count: pollTotalVotes })}
                    </Text>
                  </Group>
                  <Stack gap={12}>
                    <div className="event-detail-modal__poll-result-board">
                      {modalEvent.poll.options.map((option) => {
                        const percent = pollTotalVotes > 0 ? Math.round((option.vote_count / pollTotalVotes) * 100) : 0;
                        const voterEntries = resolveVoterEntries(option.voter_ids, allUsers);
                        const missingVoterIds = option.voter_ids.filter((userId) => !voterEntries.some((entry) => entry.user.id === userId));
                        const visibleVoters = voterEntries.slice(0, 10);
                        const hiddenVoterCount = Math.max(0, voterEntries.length - visibleVoters.length);
                        const isSelectedOption = selectedOptionIds.includes(option.id);
                        const optionDisabled = event === null || !modalEvent.poll?.can_vote || !onVotePoll || hasEnded || Boolean(modalEvent.archived_at) || Boolean(votePending);
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
                                    {isSelectedOption ? <IconCheck size={14} stroke={3} /> : null}
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
                              <Progress value={percent} color="teal" size="md" className="event-detail-modal__poll-progress" />
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
                      {!modalEvent.poll.can_vote || hasEnded || modalEvent.archived_at ? (
                        <Text size="xs" c="dimmed">{hasEnded ? t("poll.status.closed") : t("poll.status.readOnly")}</Text>
                      ) : null}
                      <Button
                        color="teal"
                        size="sm"
                        loading={votePending}
                        disabled={event === null || !modalEvent.poll.can_vote || !onVotePoll || hasEnded || Boolean(modalEvent.archived_at) || selectedOptionIds.length === 0}
                        onClick={() => onVotePoll?.(modalEvent.id, selectedOptionIds)}
                      >
                        {modalEvent.poll.has_voted ? t("poll.update") : t("poll.vote")}
                      </Button>
                    </div>
                  </Stack>
                </section>
              ) : null}

              {!isPoll ? (
                <section className="event-detail-modal__section event-detail-modal__section--members">
                  <Group justify="space-between" gap={12} mb={12} wrap="wrap">
                    <Group gap={8}>
                      <IconUsers size={20} />
                      <Text size="md" fw={800}>
                        {modalEvent.capacity ? t("detail.membersWithCap", { count: modalMembers.length, capacity: modalEvent.capacity }) : t("detail.members", { count: modalMembers.length })}
                      </Text>
                    </Group>
                    {showMemberAction ? (
                      <DepthButton
                        type={isJoined ? "danger" : "primary"}
                        size="sm"
                        onClick={() => {
                          if (isJoined) {
                            onLeave?.(modalEvent.id);
                            return;
                          }
                          onJoin?.(modalEvent.id);
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
                        if (userId) {
                          onAddParticipant(modalEvent.id, userId);
                        }
                      }}
                      disabled={event === null}
                      data={allUsers
                        .filter((entry) => entry.user.is_active && !entry.user.deleted_at && !modalMembers.some((m) => m.user.id === entry.user.id))
                        .map((entry) => ({ value: entry.user.id, label: entry.user.username }))
                      }
                      leftSection={<IconUserPlus size={16} />}
                    />
                  ) : null}

                  {modalMembers.length === 0 ? (
                    <Text c="dimmed" size="sm">{t("detail.noMembers")}</Text>
                  ) : (
                    <div className="event-detail-modal__member-list">
                      <Stack gap={8}>
                        {modalMembers.map((entry) => (
                          <Group key={entry.user.id} gap={10} className="event-detail-modal__member-row" wrap="nowrap">
                            <MemberRoleAvatar user={entry.user} profile={entry.profile} size={40} withTooltip={false} />
                            <div className="event-detail-modal__member-info">
                              <Text size="sm" fw={700}>{entry.user.username}</Text>
                              <Group gap={6}>
                                <Text size="xs" c="dimmed">{entry.profile.classes[0] ?? "-"}</Text>
                                <Text size="xs" c="dimmed">-</Text>
                                <Text size="xs" c="dimmed">{t("detail.power", { value: entry.profile.power ?? "-" })}</Text>
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
                                    onConfirm: () => onRemoveParticipant(modalEvent.id, entry.user.id),
                                    centered: true,
                                  });
                                }}
                                disabled={event === null}
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
                </section>
              ) : null}
            </Stack>
          </Grid.Col>

          {modalEvent.attachments && modalEvent.attachments.length > 0 ? (
            <Grid.Col span={{ base: 12, md: 7 }}>
              <MediaGallery images={modalEvent.attachments} resolveMediaUrl={resolveEventAttachmentUrl} labels={mediaLabels} />
            </Grid.Col>
          ) : null}
        </Grid>
      ) : null}
    </Modal>
  );
}
