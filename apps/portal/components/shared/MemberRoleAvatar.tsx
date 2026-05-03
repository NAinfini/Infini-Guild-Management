import type { MemberProfile, User } from "@guild/shared";
import { Avatar, Group, HoverCard, Stack, Text } from "@mantine/core";
import { IconShield, IconSword, IconHeartbeat } from "@tabler/icons-react";
import { resolveProfileMediaUrl } from "../../utils/media";

type ClassRole = "healer" | "tank" | "dps";

const ROLE_CONFIG: Record<ClassRole, { color: string; avatarColor: string; icon: typeof IconSword; label: string }> = {
  healer: { color: "#10b981", avatarColor: "green", icon: IconHeartbeat, label: "治疗" },
  tank:   { color: "#d97706", avatarColor: "yellow", icon: IconShield, label: "防御" },
  dps:    { color: "#3b82f6", avatarColor: "blue", icon: IconSword, label: "输出" },
};

function getClassRole(classes: string[]): ClassRole {
  for (const cls of classes) {
    if (cls === "牵丝霖") return "healer";
    if (cls === "裂石威") return "tank";
  }
  return "dps";
}

type MemberRoleAvatarProps = {
  user: User;
  profile: MemberProfile;
  size?: number;
  withTooltip?: boolean;
};

export function MemberRoleAvatar({ user, profile, size = 36, withTooltip = true }: MemberRoleAvatarProps) {
  const role = getClassRole(profile.classes);
  const config = ROLE_CONFIG[role];
  const RoleIcon = config.icon;
  const avatarSrc = profile.avatar_key ? resolveProfileMediaUrl(profile.avatar_key) : undefined;
  const iconSize = Math.max(10, Math.round(size * 0.38));
  const badgeSize = iconSize + 6;

  const avatar = (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <Avatar size={size} radius="xl" color={config.avatarColor} src={avatarSrc}>
        {user.username.slice(0, 1).toUpperCase()}
      </Avatar>
      <div
        style={{
          position: "absolute",
          bottom: -2,
          right: -2,
          width: badgeSize,
          height: badgeSize,
          borderRadius: "50%",
          background: config.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "2px solid var(--color-surface, #ffffff)",
          boxShadow: `0 0 4px ${config.color}66`,
        }}
      >
        <RoleIcon size={iconSize} color="#fff" stroke={2.5} />
      </div>
    </div>
  );

  if (!withTooltip) return avatar;

  return (
    <HoverCard width={220} shadow="md" position="top" withArrow openDelay={200} closeDelay={100}>
      <HoverCard.Target>{avatar}</HoverCard.Target>
      <HoverCard.Dropdown style={{ padding: "12px" }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <Avatar size={40} radius="xl" color={config.avatarColor} src={avatarSrc}>
            {user.username.slice(0, 1).toUpperCase()}
          </Avatar>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={700} truncate>{user.username}</Text>
            {profile.classes.length > 0 ? (
              <Text size="xs" c="dimmed" truncate>{profile.classes.join(" · ")}</Text>
            ) : null}
          </Stack>
        </Group>
        <Group gap={12} mt={10}>
          <Group gap={4}>
            <RoleIcon size={14} color={config.color} />
            <Text size="xs" fw={600} style={{ color: config.color }}>{config.label}</Text>
          </Group>
          {profile.power > 0 ? (
            <Text size="xs" c="dimmed">⚡ {profile.power.toLocaleString()}</Text>
          ) : null}
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export { getClassRole, ROLE_CONFIG };
