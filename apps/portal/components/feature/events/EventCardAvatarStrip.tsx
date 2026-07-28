import type { MemberProfile, User } from "@guild/shared";
import { Text } from "@mantine/core";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { UsersIcon } from "@portal/components/icons";
import React, { useEffect, useRef, useState } from "react";

type MemberEntry = { user: User; profile: MemberProfile };

const AVATAR_MAX_SIZE = 36;
const AVATAR_MIN_SIZE = 24;
const AVATAR_GAP = 2;
const OVERFLOW_BADGE_WIDTH = 28;

function calculateLayout(containerWidth: number, totalMembers: number): { size: number; count: number } {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || totalMembers <= 0) {
    return { size: AVATAR_MAX_SIZE, count: totalMembers };
  }

  for (let size = AVATAR_MAX_SIZE; size >= AVATAR_MIN_SIZE; size--) {
    const slotWidth = size + AVATAR_GAP;
    const allFit = totalMembers * slotWidth - AVATAR_GAP;
    if (allFit <= containerWidth) {
      return { size, count: totalMembers };
    }
  }

  const slotWidth = AVATAR_MIN_SIZE + AVATAR_GAP;
  const maxSlots = Math.max(1, Math.floor((containerWidth - OVERFLOW_BADGE_WIDTH) / slotWidth));
  return { size: AVATAR_MIN_SIZE, count: Math.min(maxSlots, totalMembers) };
}

type EventCardAvatarStripProps = {
  members: MemberEntry[];
  visibleMembers: MemberEntry[];
  hiddenMembersCount: number;
};

export function EventCardAvatarStrip({ members, visibleMembers, hiddenMembersCount }: EventCardAvatarStripProps) {
  const sizerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ size: number; count: number } | null>(null);

  const totalCount = visibleMembers.length + hiddenMembersCount;

  useEffect(() => {
    const sizer = sizerRef.current;
    if (!sizer) return;

    const measure = () => {
      setLayout(calculateLayout(sizer.offsetWidth, totalCount));
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(sizer);
    return () => observer.disconnect();
  }, [totalCount]);

  const avatarSize = layout?.size ?? AVATAR_MAX_SIZE;
  const showCount = layout !== null ? Math.min(layout.count, visibleMembers.length) : visibleMembers.length;
  const displayMembers = visibleMembers.slice(0, showCount);
  const overflowCount = totalCount - showCount;

  return (
    <>
      <div ref={sizerRef} className="event-card__avatar-strip-sizer" />
      <div
        className="event-card__avatar-grid"
        style={{ "--event-card-avatar-size": `${avatarSize}px` } as React.CSSProperties}
      >
        {members.length === 0 ? (
          <span className="event-card__avatar-placeholder" aria-hidden="true">
            <UsersIcon size={Math.max(14, Math.round(avatarSize * 0.5))} />
          </span>
        ) : null}
        {displayMembers.map((member) => (
          <MemberRoleAvatar key={member.user.id} user={member.user} profile={member.profile} size={avatarSize} />
        ))}
        {overflowCount > 0 ? (
          <Text size="xs" c="dimmed" fw={700} className="event-card__avatar-overflow">+{overflowCount}</Text>
        ) : null}
      </div>
    </>
  );
}
