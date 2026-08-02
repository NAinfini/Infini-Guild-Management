import { Text } from "@mantine/core";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { UsersIcon } from "@portal/components/icons";
import React from "react";
import "./MemberAvatarStack.css";

/*
 * 只要 MemberRoleAvatar 画得出来的最小形状，外加一个 id 当 key。刻意不写成
 * User / MemberProfile：仪表盘接口只返回 { id, username } 和三个 profile 字段，
 * 要求完整实体会把这一摞头像锁死在活动页，仪表盘就用不了。
 */
type MemberEntry = {
  user: { id: string; username: string };
  profile: { classes: readonly string[]; power: number; avatar_key: string | null };
};

/*
 * 一摞头像：只露五个人，多的收进 "+N"，一张压一张。
 *
 * 以前活动卡那版按容器宽度算能塞几个、头像还会从 36px 缩到 24px，为的是把所有报名
 * 的人都摆出来。现在「谁来了」不再由头像承担——缺什么职业由配额筹码行讲，人数由容量
 * 数字讲，头像只剩「有人来了」这一个作用。于是尺寸固定、数量固定，layout 不再依赖
 * 测量，ResizeObserver 也就没有存在的理由了。
 *
 * 每个人的职业圈一律不画：这一摞是叠着的，圈会互相压住，谁的圈都看不全。
 */
const MAX_VISIBLE_AVATARS = 5;
const AVATAR_SIZE = 34;

type MemberAvatarStackProps = {
  members: readonly MemberEntry[];
};

export function MemberAvatarStack({ members }: MemberAvatarStackProps) {
  const displayMembers = members.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = members.length - displayMembers.length;

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
        <Text size="xs" c="dimmed" fw={700} className="member-avatar-stack__overflow">+{overflowCount}</Text>
      ) : null}
    </div>
  );
}
