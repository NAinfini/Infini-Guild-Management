import type { MemberProfile, User } from "@guild/shared";
import { Text } from "@mantine/core";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { UsersIcon } from "@portal/components/icons";
import React, { useEffect, useRef, useState } from "react";

type MemberEntry = { user: User; profile: MemberProfile };

const EVENT_CARD_AVATAR_MAX_SIZE = 36;
const EVENT_CARD_AVATAR_MIN_SIZE = 24;
const EVENT_CARD_AVATAR_GAP = 2;
const EVENT_CARD_AVATAR_BADGE_OVERHANG = 4;

export function calculateEventCardAvatarSize(containerWidth: number, slotCount: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || slotCount <= 0) {
    return EVENT_CARD_AVATAR_MAX_SIZE;
  }

  const gapWidth = Math.max(0, slotCount - 1) * EVENT_CARD_AVATAR_GAP;
  const availableWidth = containerWidth - gapWidth - EVENT_CARD_AVATAR_BADGE_OVERHANG;
  const fittedSize = Math.floor(availableWidth / slotCount);
  return Math.max(EVENT_CARD_AVATAR_MIN_SIZE, Math.min(EVENT_CARD_AVATAR_MAX_SIZE, fittedSize));
}

type EventCardAvatarStripProps = {
  members: MemberEntry[];
  visibleMembers: MemberEntry[];
  hiddenMembersCount: number;
};

export function EventCardAvatarStrip({ members, visibleMembers, hiddenMembersCount }: EventCardAvatarStripProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [avatarSize, setAvatarSize] = useState(EVENT_CARD_AVATAR_MAX_SIZE);
  const slotCount = members.length === 0 ? 1 : visibleMembers.length + (hiddenMembersCount > 0 ? 1 : 0);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    const updateAvatarSize = (width: number) => {
      setAvatarSize(calculateEventCardAvatarSize(width, slotCount));
    };

    updateAvatarSize(grid.clientWidth);

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (entry) {
        updateAvatarSize(entry.contentRect.width);
      }
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [slotCount]);

  return (
    <div
      ref={gridRef}
      className="event-card__avatar-grid"
      style={{ "--event-card-avatar-size": `${avatarSize}px` } as React.CSSProperties}
    >
      {members.length === 0 ? (
        <span className="event-card__avatar-placeholder" aria-hidden="true">
          <UsersIcon size={Math.max(14, Math.round(avatarSize * 0.5))} />
        </span>
      ) : null}
      {visibleMembers.map((member) => (
        <MemberRoleAvatar key={member.user.id} user={member.user} profile={member.profile} size={avatarSize} />
      ))}
      {hiddenMembersCount > 0 ? (
        <Text size="xs" c="dimmed" fw={700} className="event-card__avatar-overflow">+{hiddenMembersCount}</Text>
      ) : null}
    </div>
  );
}
