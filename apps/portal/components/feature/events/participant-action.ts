type ParticipantActionState = {
  /** 投票活动没有报名这回事，参与方式是在详情里投票。 */
  isPoll?: boolean;
  isArchived: boolean;
  hasEnded: boolean;
  signupLocked: boolean;
  isFull: boolean;
  isJoined: boolean;
  pending: boolean;
};

export function getParticipantActionDisabledReasonKey({
  isPoll = false,
  isArchived,
  hasEnded,
  signupLocked,
  isFull,
  isJoined,
  pending,
}: ParticipantActionState): string | null {
  /* 排在最前面：投票活动无论归档没归档、满没满，报名这件事都不成立。 */
  if (isPoll) return "button.disabled.poll";
  if (isArchived) return "button.disabled.archived";
  if (hasEnded) return "button.disabled.ended";
  if (signupLocked) return "button.disabled.locked";
  if (!isJoined && isFull) return "button.disabled.full";
  if (pending) return "button.disabled.pending";
  return null;
}
