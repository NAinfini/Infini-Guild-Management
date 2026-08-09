import { Avatar, Group, HoverCard, Stack, Text, UnstyledButton } from "@mantine/core";
import { BoltIcon } from "@portal/components/icons";
import { resolveMediaUrl } from "../../utils/media";
import {
  resolveClassCatalogItem,
  useClassCatalogStore,
} from "../../stores/class-catalog";
import { ClassIcon } from "./ClassIcon";
import "./MemberCard.css";

function getUniqueClassIds(classes: readonly string[]): string[] {
  return [...new Set(classes.filter(Boolean))];
}

type MemberRoleAvatarProps = {
  user: {
    username: string;
  };
  profile: {
    classes: readonly string[];
    power: number;
    avatar_media_id: string | null;
  };
  size?: number;
  withTooltip?: boolean;
  /*
   * 头像右下角那一圈职业图标。花名册要它——那里一个人就是一行，图标是主要信息。
   * 活动卡不要：卡片已经用职业配额筹码在讲「缺什么职业」，每个头像再挂三个小圈
   * 就是同一件事说两遍，而且头像本身要叠在一起，圈圈会互相压。
   */
  withClassCircles?: boolean;
};

export function MemberRoleAvatar({
  user,
  profile,
  size = 36,
  withTooltip = true,
  withClassCircles = true,
}: MemberRoleAvatarProps) {
  const catalog = useClassCatalogStore((state) => state.items);
  const classItems = getUniqueClassIds(profile.classes).map((id) =>
    resolveClassCatalogItem(id, catalog)
  );
  const visibleClassItems = classItems.slice(0, 3);
  const hiddenCount = Math.max(0, classItems.length - visibleClassItems.length);
  const avatarSrc = profile.avatar_media_id ? resolveMediaUrl(profile.avatar_media_id) : undefined;
  const circleSize = Math.max(18, Math.min(24, Math.round(size * 0.52)));

  const avatar = (
    <div className="member-role-avatar">
      <Avatar size={size} radius="xl" color="portal-brand" src={avatarSrc}>
        {user.username.slice(0, 1).toUpperCase()}
      </Avatar>
      {withClassCircles && visibleClassItems.length > 0 ? (
        <div className="member-role-avatar__roles" aria-hidden="true">
          {hiddenCount > 0 ? (
            <span
              className="member-role-avatar__overflow"
              style={{ width: circleSize, height: circleSize }}
            >
              +{hiddenCount}
            </span>
          ) : null}
          {visibleClassItems.map((item) => (
            <ClassIcon
              key={item.id}
              item={item}
              size={circleSize}
              className="member-role-avatar__role-circle"
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  if (!withTooltip) return avatar;

  return (
    <HoverCard width={236} shadow="md" position="top" withArrow openDelay={200} closeDelay={100}>
      <HoverCard.Target>
        <UnstyledButton aria-label={user.username}>
          {avatar}
        </UnstyledButton>
      </HoverCard.Target>
      <HoverCard.Dropdown className="member-role-avatar__popover">
        <Group gap={10} wrap="nowrap" align="flex-start">
          <Avatar size={40} radius="xl" color="portal-brand" src={avatarSrc}>
            {user.username.slice(0, 1).toUpperCase()}
          </Avatar>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={700} truncate>{user.username}</Text>
            {classItems.length > 0 ? (
              <Text size="xs" c="dimmed" truncate>
                {classItems.map((item) => item.label).join(" · ")}
              </Text>
            ) : null}
          </Stack>
        </Group>
        <Group gap={8} mt={10} wrap="wrap">
          {classItems.map((item) => (
            <Group key={item.id} gap={5} wrap="nowrap">
              <ClassIcon item={item} size={20} />
              <Text size="xs" fw={600}>{item.label}</Text>
            </Group>
          ))}
          {profile.power > 0 ? (
            <Text component="span" size="xs" c="dimmed">
              <BoltIcon size={13} className="member-role-avatar__power-icon" />{" "}
              {profile.power.toLocaleString()}
            </Text>
          ) : null}
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export { getUniqueClassIds };
