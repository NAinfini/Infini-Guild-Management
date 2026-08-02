import type { MemberProfile, User } from "@guild/shared";
import { Text } from "@mantine/core";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { UsersIcon } from "@portal/components/icons";
import React from "react";

type MemberEntry = { user: User; profile: MemberProfile };

/*
 * 卡片只露五个人，多的收进 "+N"。
 *
 * 以前这里按容器宽度算能塞几个、头像还会从 36px 缩到 24px，为的是把所有报名的人都
 * 摆出来。现在「谁来了」不再由头像承担——缺什么职业由下面那行配额筹码讲，人数由右上
 * 角的容量数字讲，头像只剩「有人来了」这一个作用。于是尺寸固定、数量固定，layout
 * 不再依赖测量，ResizeObserver 也就没有存在的理由了。
 */
const MAX_VISIBLE_AVATARS = 5;
const AVATAR_SIZE = 34;

type EventCardAvatarStripProps = {
  members: MemberEntry[];
};

export function EventCardAvatarStrip({ members }: EventCardAvatarStripProps) {
  const displayMembers = members.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = members.length - displayMembers.length;

  return (
    <div
      className="event-card__avatar-grid"
      style={{ "--event-card-avatar-size": `${AVATAR_SIZE}px` } as React.CSSProperties}
    >
      {members.length === 0 ? (
        <span className="event-card__avatar-placeholder" aria-hidden="true">
          <UsersIcon size={Math.round(AVATAR_SIZE * 0.5)} />
        </span>
      ) : null}
      {displayMembers.map((member, index) => (
        <span
          key={member.user.id}
          className="event-card__avatar-slot"
          /* 越靠左越在前，叠出一摞牌的样子；悬停时那一个提到最前面（见 CSS）。 */
          style={{ zIndex: MAX_VISIBLE_AVATARS - index }}
        >
          <MemberRoleAvatar
            user={member.user}
            profile={member.profile}
            size={AVATAR_SIZE}
            withClassCircles={false}
          />
        </span>
      ))}
      {overflowCount > 0 ? (
        <Text size="xs" c="dimmed" fw={700} className="event-card__avatar-overflow">+{overflowCount}</Text>
      ) : null}
    </div>
  );
}
