import type { MemberProfile, User } from "@guild/shared";
import { activeGame } from "@guild/shared/games";
import { Avatar, Group, HoverCard, Stack, Text } from "@mantine/core";
import { ShieldIcon, SwordIcon, HeartbeatIcon, BoltIcon } from "@portal/components/icons";
import { resolveProfileMediaUrl } from "../../utils/media";

const ICON_MAP: Record<string, typeof SwordIcon> = {
  IconSword: SwordIcon,
  IconShield: ShieldIcon,
  IconHeartbeat: HeartbeatIcon,
};

type RoleConfigResolved = {
  id: string;
  color: string;
  avatarColor: string;
  icon: typeof SwordIcon;
  label: string;
};

const ROLE_CONFIG: Record<string, RoleConfigResolved> = Object.fromEntries(
  activeGame.roles.map((r) => [
    r.id,
    { id: r.id, color: r.color, avatarColor: r.avatarColor, icon: ICON_MAP[r.icon] ?? SwordIcon, label: r.label },
  ]),
);

const CLASS_TO_ROLE: Record<string, string> = Object.fromEntries(
  activeGame.classes.filter((c) => c.role).map((c) => [c.id, c.role!]),
);

function classToRole(cls: string): string {
  return CLASS_TO_ROLE[cls] ?? activeGame.defaultRole;
}

function getUniqueRoles(classes: string[]): string[] {
  if (classes.length === 0) return [activeGame.defaultRole];
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const cls of classes) {
    const role = classToRole(cls);
    if (!seen.has(role)) {
      seen.add(role);
      roles.push(role);
    }
  }
  return roles;
}

function getPrimaryAvatarColor(roles: string[]): string {
  for (const roleId of activeGame.roles.map((r) => r.id)) {
    if (roles.includes(roleId) && roleId !== activeGame.defaultRole) {
      return ROLE_CONFIG[roleId]?.avatarColor ?? "blue";
    }
  }
  return ROLE_CONFIG[activeGame.defaultRole]?.avatarColor ?? "blue";
}

type MemberRoleAvatarProps = {
  user: User;
  profile: MemberProfile;
  size?: number;
  withTooltip?: boolean;
};

export function MemberRoleAvatar({ user, profile, size = 36, withTooltip = true }: MemberRoleAvatarProps) {
  const roles = getUniqueRoles(profile.classes);
  const avatarColor = getPrimaryAvatarColor(roles);
  const avatarSrc = profile.avatar_key ? resolveProfileMediaUrl(profile.avatar_key) : undefined;
  const iconSize = Math.max(8, Math.round(size * 0.28));
  const circleSize = iconSize + 6;
  const circleGap = 2;

  const avatar = (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <Avatar size={size} radius="xl" color={avatarColor} src={avatarSrc}>
        {user.username.slice(0, 1).toUpperCase()}
      </Avatar>
      <div
        style={{
          position: "absolute",
          bottom: -3,
          right: -3,
          display: "flex",
          alignItems: "center",
          gap: circleGap,
        }}
      >
        {roles.map((roleId) => {
          const cfg = ROLE_CONFIG[roleId] ?? ROLE_CONFIG[activeGame.defaultRole];
          if (!cfg) return null;
          const Icon = cfg.icon;
          return (
            <div
              key={roleId}
              style={{
                width: circleSize,
                height: circleSize,
                borderRadius: "50%",
                background: cfg.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid var(--color-surface, #ffffff)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
              }}
            >
              <Icon size={iconSize} style={{ color: "#fff", display: "inline-flex", lineHeight: 0 }} />
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!withTooltip) return avatar;

  return (
    <HoverCard width={220} shadow="md" position="top" withArrow openDelay={200} closeDelay={100}>
      <HoverCard.Target>{avatar}</HoverCard.Target>
      <HoverCard.Dropdown style={{ padding: "12px" }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <Avatar size={40} radius="xl" color={avatarColor} src={avatarSrc}>
            {user.username.slice(0, 1).toUpperCase()}
          </Avatar>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={700} truncate>{user.username}</Text>
            {profile.classes.length > 0 ? (
              <Text size="xs" c="dimmed" truncate>{profile.classes.join(" · ")}</Text>
            ) : null}
          </Stack>
        </Group>
        <Group gap={6} mt={10} wrap="wrap">
          {profile.classes.map((cls) => {
            const roleId = classToRole(cls);
            const cfg = ROLE_CONFIG[roleId] ?? ROLE_CONFIG[activeGame.defaultRole];
            if (!cfg) return null;
            const Icon = cfg.icon;
            return (
              <Group key={cls} gap={4}>
                <Icon size={14} style={{ color: cfg.color, display: "inline-flex", lineHeight: 0 }} />
                <Text size="xs" fw={600}>{cls}</Text>
              </Group>
            );
          })}
          {profile.power > 0 ? (
            <Text component="span" size="xs" c="dimmed"><BoltIcon size={13} style={{ display: "inline-block", verticalAlign: "-2px" }} /> {profile.power.toLocaleString()}</Text>
          ) : null}
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export { getUniqueRoles, ROLE_CONFIG };
