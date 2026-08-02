import { Avatar, Group, HoverCard, Stack, Text, UnstyledButton } from "@mantine/core";
import { BoltIcon } from "@portal/components/icons";
import { resolveProfileMediaUrl } from "../../utils/media";
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
    avatar_key: string | null;
  };
  size?: number;
  withTooltip?: boolean;
};

export function MemberRoleAvatar({
  user,
  profile,
  size = 36,
  withTooltip = true,
}: MemberRoleAvatarProps) {
  const catalog = useClassCatalogStore((state) => state.items);
  const classItems = getUniqueClassIds(profile.classes).map((id) =>
    resolveClassCatalogItem(id, catalog)
  );
  const visibleClassItems = classItems.slice(0, 3);
  const hiddenCount = Math.max(0, classItems.length - visibleClassItems.length);
  const avatarSrc = profile.avatar_key ? resolveProfileMediaUrl(profile.avatar_key) : undefined;
  const circleSize = Math.max(18, Math.min(24, Math.round(size * 0.52)));

  const avatar = (
    <div className="member-role-avatar">
      <Avatar size={size} radius="xl" color="portal-brand" src={avatarSrc}>
        {user.username.slice(0, 1).toUpperCase()}
      </Avatar>
      {visibleClassItems.length > 0 ? (
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
