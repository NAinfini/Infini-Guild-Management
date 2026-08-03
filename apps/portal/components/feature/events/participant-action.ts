type ParticipantActionState = {
  isArchived: boolean;
  hasEnded: boolean;
  signupLocked: boolean;
  isFull: boolean;
  isJoined: boolean;
  pending: boolean;
};

/*
 * 投票活动不走这里：它的页脚给的是「投票」，不是一颗按不动的「报名」，
 * 能不能投由 EventCard 自己按归档／已结束判断。
 */
export function getParticipantActionDisabledReasonKey({
  isArchived,
  hasEnded,
  signupLocked,
  isFull,
  isJoined,
  pending,
}: ParticipantActionState): string | null {
  if (isArchived) return "button.disabled.archived";
  if (hasEnded) return "button.disabled.ended";
  if (signupLocked) return "button.disabled.locked";
  if (!isJoined && isFull) return "button.disabled.full";
  if (pending) return "button.disabled.pending";
  return null;
}
