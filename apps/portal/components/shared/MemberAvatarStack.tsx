import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { UsersIcon } from "@portal/components/icons";
import React from "react";
import "./MemberAvatarStack.css";

/*
 * 只要 MemberRoleAvatar 画得出来的最小形状，外加一个 id 当 key。刻意不写成
 * User / MemberProfile：仪表盘接口只返回 { id, display_name } 和三个 profile 字段，
 * 要求完整实体会把这一摞头像锁死在活动页，仪表盘就用不了。
 */
type MemberEntry = {
  user: { id: string; display_name: string };
  profile: { classes: readonly string[]; power: number; avatar_media_id: string | null };
};

// Keep the stack stable at five fixed-size avatars; capacity and quota controls
// carry the numeric detail, and overlapping avatars omit unreadable class rings.
const MAX_VISIBLE_AVATARS = 5;
const AVATAR_SIZE = 34;

type MemberAvatarStackProps = {
  members: readonly MemberEntry[];
  totalCount?: number;
};

export function MemberAvatarStack({ members, totalCount = members.length }: MemberAvatarStackProps) {
  const displayMembers = members.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = Math.max(0, totalCount - displayMembers.length);

  return (
    <div
      className="member-avatar-stack"
      style={{ "--member-avatar-stack-size": `${AVATAR_SIZE}px` } as React.CSSProperties}
    >
      {members.length === 0 ? (
        <span className="member-avatar-stack__placeholder" aria-hidden="true">
          <UsersIcon size={Math.round(AVATAR_SIZE * 0.5)} />
        </span>
      ) : null}
      {displayMembers.map((member, index) => (
        <span
          key={member.user.id}
          className="member-avatar-stack__slot"
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
        <span className="member-avatar-stack__overflow">+{overflowCount}</span>
      ) : null}
    </div>
  );
}
