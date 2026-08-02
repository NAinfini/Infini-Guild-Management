import type { User } from "@guild/shared";
import { Avatar, Button, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import { UserIcon } from "@portal/components/icons";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DownOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from "../../utils/icons";
import { useAuthStore } from "../../stores/auth";
import { resolveProfileMediaUrl } from "../../utils/media";

type UserProfileDropdownProps = {
  user: User | null;
  onLogout: () => void | Promise<void>;
  compact?: boolean;
};

export function UserProfileDropdown({ user, onLogout, compact = false }: UserProfileDropdownProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);

  if (!user) {
    return (
      <Button size="sm" onClick={() => void navigate({ to: "/login" })}>
        {t("action.login")}
      </Button>
    );
  }

  return (
    <Menu width={220} position="bottom-end">
      <Menu.Target>
        <UnstyledButton
          type="button"
          className={`app-profile-trigger ${compact ? "app-profile-trigger--compact" : ""}`}
          aria-label={`${user.username}: ${t("profile.menu.aria.open")}`}
        >
          <Group gap={8} wrap="nowrap" align="center">
            <Avatar size={32} radius="xl" className="app-profile-avatar" src={profile?.avatar_key ? resolveProfileMediaUrl(profile.avatar_key) : undefined}>
              <UserIcon size={18} />
            </Avatar>
            <div className="app-profile-meta">
              <Text fw={600} className="app-profile-name">
                {user.username}
              </Text>
              {!compact ? (
                <Text c="dimmed" size="xs" className="app-profile-role">
                  {user.role}
                </Text>
              ) : null}
            </div>
            <DownOutlined className="app-profile-chevron" />
          </Group>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item leftSection={<UserOutlined />} onClick={() => void navigate({ to: "/profile" })}>
          {t("profile.menu.profile")}
        </Menu.Item>
        <Menu.Item leftSection={<SettingOutlined />} onClick={() => void navigate({ to: "/settings" })}>
          {t("profile.menu.settings")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<LogoutOutlined />} onClick={() => void onLogout()}>
          {t("action.logout")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

