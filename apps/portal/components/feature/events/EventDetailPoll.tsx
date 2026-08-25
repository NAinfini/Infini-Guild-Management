import type { Event, MemberProfile, User } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Progress } from "@portal/components/ui/progress";
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
        <span className="event-detail-content__poll-empty-voters">
          {t("poll.detail.noVotes")}
        </span>
      );
    }
    const voterEntries = resolveVoterEntries(voterIds, allUsers);
    const missingVoterIds = voterIds.filter((userId) => !voterEntries.some((entry) => entry.user.id === userId));
    const visibleVoters = voterEntries.slice(0, 10);
    const hiddenVoterCount = Math.max(0, voterEntries.length - visibleVoters.length);
    return (
      <div className="event-detail-content__poll-voters">
        {/* Avatar hover cards expose voter names and classes without expanding each option row. */}
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
          <strong className="event-detail-content__poll-voter-overflow">
            +{hiddenVoterCount}
          </strong>
        ) : null}
        {missingVoterIds.map((userId) => (
          <span key={userId} className="event-detail-content__poll-voter-missing">
            {userId}
          </span>
        ))}
      </div>
    );
  };

  return (
    <section className="event-detail-content__section event-detail-content__section--poll">
      <div className="event-detail-content__poll-header event-detail-content__poll-heading">
        <div className="event-detail-content__poll-heading-main">
          <ChartBarIcon size={20} />
          <h2>{t("poll.detail.title")}</h2>
        </div>
        <strong className="event-detail-content__poll-total">
          {t("poll.detail.votes", { count: totalVotes })}
        </strong>
      </div>
      <div className="event-detail-content__poll-stack">
        <div className="event-detail-content__poll-result-board">
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
                className={`event-detail-content__poll-result-row${isSelectedOption ? " event-detail-content__poll-result-row--selected" : ""}${optionDisabled ? " event-detail-content__poll-result-row--disabled" : ""}`}
                onClick={() => toggleOption(option.id, optionDisabled)}
                onKeyDown={(keyEvent) => handleOptionKeyDown(option.id, optionDisabled, keyEvent)}
              >
                <div className="event-detail-content__poll-result-main">
                  <div className="event-detail-content__poll-result-top">
                    <div className="event-detail-content__poll-choice">
                      <span className="event-detail-content__poll-choice-indicator" aria-hidden="true">
                        {isSelectedOption ? <CheckIcon size={14} /> : null}
                      </span>
                      <strong className="event-detail-content__poll-choice-label">{option.label}</strong>
                    </div>
                    <div className="event-detail-content__poll-result-stats">
                      <span className="event-detail-content__poll-option-votes">
                        {t("poll.detail.votes", { count: option.vote_count })}
                      </span>
                      <strong className="event-detail-content__poll-percent">{percent}%</strong>
                    </div>
                  </div>
                  <Progress value={percent} className="event-detail-content__poll-progress" />
                  {renderVoters(option.voter_ids)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="event-detail-content__poll-actions">
          {readOnly ? (
            <span className="event-detail-content__poll-readonly">{hasEnded ? t("poll.status.closed") : t("poll.status.readOnly")}</span>
          ) : null}
          {/* Voting is an authenticated interaction. Guests can read poll results but get no vote action. */}
          {onVotePoll ? (
            <Button
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
      </div>
    </section>
  );
}
