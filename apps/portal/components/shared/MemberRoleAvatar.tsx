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

function classToRole(cls: string): ClassRole {
  if (cls === "牵丝霖") return "healer";
  if (cls === "裂石威") return "tank";
  return "dps";
}

function getUniqueRoles(classes: string[]): ClassRole[] {
  if (classes.length === 0) return ["dps"];
  const seen = new Set<ClassRole>();
  const roles: ClassRole[] = [];
  for (const cls of classes) {
    const role = classToRole(cls);
    if (!seen.has(role)) {
      seen.add(role);
      roles.push(role);
    }
  }
  return roles;
}

function getPrimaryAvatarColor(roles: ClassRole[]): string {
  if (roles.includes("healer")) return "green";
  if (roles.includes("tank")) return "yellow";
  return "blue";
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
  const badgePad = 2;
  const badgeGap = 1;
  const badgeH = iconSize + badgePad * 2;
  const badgeW = roles.length * iconSize + (roles.length - 1) * badgeGap + badgePad * 2;

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
          height: badgeH,
          width: badgeW,
          borderRadius: badgeH / 2,
          background: roles.length === 1 ? ROLE_CONFIG[roles[0]].color : "rgba(30,41,59,0.85)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: badgeGap,
          padding: `0 ${badgePad}px`,
          border: "2px solid var(--color-surface, #ffffff)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        }}
      >
        {roles.map((role) => {
          const cfg = ROLE_CONFIG[role];
          const Icon = cfg.icon;
          return <Icon key={role} size={iconSize} color={roles.length === 1 ? "#fff" : cfg.color} stroke={2.5} />;
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
        <Group gap={8} mt={10} wrap="wrap">
          {roles.map((role) => {
            const cfg = ROLE_CONFIG[role];
            const Icon = cfg.icon;
            return (
              <Group key={role} gap={4}>
                <Icon size={14} color={cfg.color} />
                <Text size="xs" fw={600} style={{ color: cfg.color }}>{cfg.label}</Text>
              </Group>
            );
          })}
          {profile.power > 0 ? (
            <Text size="xs" c="dimmed">⚡ {profile.power.toLocaleString()}</Text>
          ) : null}
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export { getUniqueRoles, ROLE_CONFIG };
