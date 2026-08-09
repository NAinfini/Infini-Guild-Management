import type { User } from "@guild/shared";
import {
  ActionIcon,
  AppShell as MantineAppShell,
  Button,
  Group,
  Menu,
  Title,
} from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../providers/ThemeProvider";
import { usePreferencesStore } from "../../stores/preferences";
import { buildLocaleOptions } from "../../utils/locales";
import {
  EllipsisOutlined,
  MoonOutlined,
  SunOutlined,
  TranslationOutlined,
} from "../../utils/icons";
import { CmdKSearch } from "./CmdKSearch";
import { NotificationPopover } from "./NotificationPopover";
import { UserProfileDropdown } from "./UserProfileDropdown";

type PushEntry = {
  id: string;
  title: string;
  message: string;
  type: string;
  readAt: string | null;
  occurredAt: string;
};

type AppHeaderProps = {
  isMobile: boolean;
  isHeaderCompact: boolean;
  activePageTitle: string;
  user: User | null;
  pushHasUnread: boolean;
  notificationAnnouncementsHasNew: boolean;
  displayPushEntries: PushEntry[];
  onNotificationClose: () => void;
  onClearPushHistory: () => void;
  onPushEntryClick: (entryId: string, type: string) => void;
  onLogout: () => void;
  onLoginClick: () => void;
};

export function AppHeader({
  isMobile,
  isHeaderCompact,
  activePageTitle,
  user,
  pushHasUnread,
  notificationAnnouncementsHasNew,
  displayPushEntries,
  onNotificationClose,
  onClearPushHistory,
  onPushEntryClick,
  onLogout,
  onLoginClick,
}: AppHeaderProps) {
  const { t } = useTranslation("common");
  const { theme: currentTheme, toggleTheme } = useTheme();
  const locale = usePreferencesStore((state) => state.locale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const localeOptions = useMemo(() => buildLocaleOptions((key) => t(key)), [t]);
  const ThemeIcon = currentTheme === "dark" ? SunOutlined : MoonOutlined;

  const localeItems = localeOptions.map((option) => (
    <Menu.Item
      key={option.value}
      className={locale === option.value ? "app-menu-item--active" : undefined}
      onClick={() => setLocale(option.value)}
    >
      {option.label}
    </Menu.Item>
  ));

  return (
    <MantineAppShell.Header className="app-header">
      <Title order={1} className="app-header__page-title">
        {activePageTitle}
      </Title>

      <Group className="app-header__right" gap="sm" wrap="nowrap">
        <CmdKSearch asIcon={isMobile || isHeaderCompact} />
        <NotificationPopover
          user={user}
          pushHasUnread={pushHasUnread}
          notificationAnnouncementsHasNew={notificationAnnouncementsHasNew}
          displayPushEntries={displayPushEntries}
          onClose={onNotificationClose}
          onClearHistory={onClearPushHistory}
          onEntryClick={onPushEntryClick}
        />

        {isMobile ? (
          <Menu width={220} position="bottom-end">
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                className="app-header-icon-btn"
                aria-label={t("nav.openGlobalTools")}
              >
                <EllipsisOutlined />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<ThemeIcon />} onClick={toggleTheme}>
                {t("label.theme")}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>{t("label.locale")}</Menu.Label>
              {localeItems}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <>
            <ActionIcon
              variant="subtle"
              className="app-header-icon-btn"
              aria-label={t("label.theme")}
              onClick={toggleTheme}
            >
              <ThemeIcon />
            </ActionIcon>

            <Menu width={180} position="bottom-end">
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  className="app-header-icon-btn"
                  aria-label={t("label.locale")}
                >
                  <TranslationOutlined />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>{localeItems}</Menu.Dropdown>
            </Menu>
          </>
        )}

        {user ? (
          <UserProfileDropdown user={user} onLogout={onLogout} compact />
        ) : (
          <Button size="sm" onClick={onLoginClick}>
            {t("action.login")}
          </Button>
        )}
      </Group>
    </MantineAppShell.Header>
  );
}
