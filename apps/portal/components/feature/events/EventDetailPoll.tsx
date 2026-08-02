import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { ChartBarIcon, CheckIcon } from "@portal/components/icons";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

type MemberEntry = { user: User; profile: MemberProfile };

type EventDetailPollProps = {
  event: Event;
  poll: NonNullable<Event["poll"]>;
  allUsers: MemberEntry[];
  hasEnded: boolean;
  onVotePoll?: (eventId: string, optionIds: string[]) => void;
  votePending?: boolean;
};

function resolveVoterEntries(voterIds: string[], allUsers: MemberEntry[]): MemberEntry[] {
  return voterIds
    .map((userId) => allUsers.find((entry) => entry.user.id === userId))
    .filter((entry): entry is MemberEntry => Boolean(entry));
}

/*
 * 详情弹窗右栏的投票区。拆出来是因为它自己带着「勾了哪些选项、投过没有」这两份状态，
 * 留在弹窗里会跟报名那一路的状态混在同一个组件里读。
 */
export function EventDetailPoll({
  event,
  poll,
  allUsers,
  hasEnded,
  onVotePoll,
  votePending,
}: EventDetailPollProps) {
  const { t } = useTranslation("events");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [localHasVoted, setLocalHasVoted] = useState(false);
  const totalVotes = poll.options.reduce((total, option) => total + option.vote_count, 0);
  const readOnly = !poll.can_vote || hasEnded || Boolean(event.archived_at);

  /* 弹窗开着的时候换一个活动看，勾选必须跟着换回服务端那一份。 */
  useEffect(() => {
    setSelectedOptionIds(event.poll?.options.filter((option) => option.voted_by_me).map((option) => option.id) ?? []);
    setLocalHasVoted(event.poll?.has_voted ?? false);
  }, [event]);

  const toggleOption = (optionId: string, disabled: boolean) => {
    if (disabled) {
      return;
    }
    setSelectedOptionIds((current) =>
      current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
    );
  };

  const handleOptionKeyDown = (optionId: string, disabled: boolean, keyEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyEvent.key !== "Enter" && keyEvent.key !== " ") {
      return;
    }
    keyEvent.preventDefault();
    toggleOption(optionId, disabled);
  };

  const renderVoters = (voterIds: string[]) => {
    if (voterIds.length === 0) {
      return (
        <Text size="xs" c="dimmed" className="event-detail-modal__poll-empty-voters">
          {t("poll.detail.noVotes")}
        </Text>
      );
    }
    const voterEntries = resolveVoterEntries(voterIds, allUsers);
    const missingVoterIds = voterIds.filter((userId) => !voterEntries.some((entry) => entry.user.id === userId));
    const visibleVoters = voterEntries.slice(0, 10);
    const hiddenVoterCount = Math.max(0, voterEntries.length - visibleVoters.length);
    return (
      <div className="event-detail-modal__poll-voters">
        {/*
         * 一排光头像，名字和职业交给悬停卡（跟活动卡上那一排是同一个组件、同一张卡）。
         * 名字原来写在头像旁边，一个选项十个人就是十枚长条，占掉的宽度比选项本身还多；
         * 而投票这件事只需要认出「谁投的」，认脸就够了。
         */}
        {visibleVoters.map((entry) => (
          <MemberRoleAvatar
            key={entry.user.id}
            user={entry.user}
            profile={entry.profile}
            size={28}
            withClassCircles={false}
          />
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
    );
  };

  return (
    <section className="event-detail-modal__section event-detail-modal__section--poll">
      <Group justify="space-between" gap={12} mb={12} wrap="nowrap" className="event-detail-modal__poll-header">
        <Group gap={8}>
          <ChartBarIcon size={20} />
          <Text size="md" fw={800}>{t("poll.detail.title")}</Text>
        </Group>
        <Text size="xs" fw={700} className="event-detail-modal__poll-total">
          {t("poll.detail.votes", { count: totalVotes })}
        </Text>
      </Group>
      <Stack gap={12}>
        <div className="event-detail-modal__poll-result-board">
          {poll.options.map((option) => {
            const percent = totalVotes > 0 ? Math.round((option.vote_count / totalVotes) * 100) : 0;
            const isSelectedOption = selectedOptionIds.includes(option.id);
            const optionDisabled = readOnly || !onVotePoll || Boolean(votePending);
            return (
              <div
                key={option.id}
                role="checkbox"
                aria-checked={isSelectedOption}
                aria-disabled={optionDisabled}
                tabIndex={optionDisabled ? -1 : 0}
                className={`event-detail-modal__poll-result-row${isSelectedOption ? " event-detail-modal__poll-result-row--selected" : ""}${optionDisabled ? " event-detail-modal__poll-result-row--disabled" : ""}`}
                onClick={() => toggleOption(option.id, optionDisabled)}
                onKeyDown={(keyEvent) => handleOptionKeyDown(option.id, optionDisabled, keyEvent)}
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
                  {renderVoters(option.voter_ids)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="event-detail-modal__poll-actions">
          {readOnly ? (
            <Text size="xs" c="dimmed">{hasEnded ? t("poll.status.closed") : t("poll.status.readOnly")}</Text>
          ) : null}
          {/* Voting is an authenticated interaction. Guests can read poll results but get no vote action. */}
          {onVotePoll ? (
            <Button
              color="portal-brand"
              size="sm"
              loading={votePending}
              disabled={readOnly || selectedOptionIds.length === 0}
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
  );
}
