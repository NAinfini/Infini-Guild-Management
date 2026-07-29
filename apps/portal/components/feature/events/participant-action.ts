type ParticipantActionState = {
  isArchived: boolean;
  hasEnded: boolean;
  signupLocked: boolean;
  isFull: boolean;
  isJoined: boolean;
  pending: boolean;
};

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
