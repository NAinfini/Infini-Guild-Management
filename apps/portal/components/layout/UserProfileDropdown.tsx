import type { User } from "@guild/shared";
import { Avatar, Button, Group, Text, UnstyledButton } from "@mantine/core";
import { InfiniMenu } from "@portal/components/shared/InfiniMenu";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DownOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from "../../utils/icons";

type UserProfileDropdownProps = {
  user: User | null;
  onLogout: () => void | Promise<void>;
  compact?: boolean;
};

export function UserProfileDropdown({ user, onLogout, compact = false }: UserProfileDropdownProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  if (!user) {
    return (
      <Button size="sm" onClick={() => void navigate({ to: "/login" })}>
        {t("action.login")}
      </Button>
    );
  }

  return (
    <InfiniMenu width={220} position="bottom-end">
      <InfiniMenu.Target>
        <UnstyledButton
          type="button"
          className={`app-profile-trigger ${compact ? "app-profile-trigger--compact" : ""}`}
          aria-label={t("profile.menu.aria.open")}
        >
          <Group gap={8} wrap="nowrap" align="center">
            <Avatar size={32} radius="xl" className="app-profile-avatar">
              {user.username.slice(0, 1).toUpperCase()}
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
      </InfiniMenu.Target>

      <InfiniMenu.Dropdown>
        <InfiniMenu.Item leftSection={<UserOutlined />} onClick={() => void navigate({ to: "/profile" })}>
          {t("profile.menu.profile")}
        </InfiniMenu.Item>
        <InfiniMenu.Item leftSection={<SettingOutlined />} onClick={() => void navigate({ to: "/settings" })}>
          {t("profile.menu.settings")}
        </InfiniMenu.Item>
        <InfiniMenu.Divider />
        <InfiniMenu.Item className="infini-menu-item--danger" color="infini-danger" leftSection={<LogoutOutlined />} onClick={() => void onLogout()}>
          {t("action.logout")}
        </InfiniMenu.Item>
      </InfiniMenu.Dropdown>
    </InfiniMenu>
  );
}

