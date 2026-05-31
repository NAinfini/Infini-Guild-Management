import {
  MoonOutlined,
  SunOutlined,
  TranslationOutlined,
} from "../../utils/icons";
import type { User } from "@guild/shared";
import { InfiniMenu } from "@portal/components/shared/InfiniMenu";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { useTheme } from "../../providers/ThemeProvider";
import {
  ActionIcon,
  AppShell as MantineAppShell,
  Title,
} from "@mantine/core";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "../../stores/preferences";
import { buildLocaleOptions } from "../../utils/locales";
import { CmdKSearch } from "./CmdKSearch";
import { UserProfileDropdown } from "./UserProfileDropdown";
import { NotificationPopover } from "./NotificationPopover";

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
  activePageTitle: string;
  headerActions: ReactNode;
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
  activePageTitle,
  headerActions,
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
  const locale = usePreferencesStore((s) => s.locale);
  const setLocale = usePreferencesStore((s) => s.setLocale);
  const localeOptions = useMemo(() => buildLocaleOptions((key) => t(key)), [t]);

  return (
    <MantineAppShell.Header className="app-header">
      <div className="app-header__left">
        <Title order={1} className="app-header__page-title">
          {activePageTitle}
        </Title>
      </div>

      <div className="app-header__center">{headerActions}</div>

      <div className="app-header__right">
        <div className="app-header-tools">
          {!isMobile ? <CmdKSearch /> : <CmdKSearch asIcon />}
          <NotificationPopover
            user={user}
            pushHasUnread={pushHasUnread}
            notificationAnnouncementsHasNew={notificationAnnouncementsHasNew}
            displayPushEntries={displayPushEntries}
            onClose={onNotificationClose}
            onClearHistory={onClearPushHistory}
            onEntryClick={onPushEntryClick}
          />

          <ActionIcon variant="subtle" className="app-header-icon-btn" aria-label={t("label.theme")} onClick={toggleTheme}>
            {currentTheme === "dark" ? <SunOutlined /> : <MoonOutlined />}
          </ActionIcon>

          <InfiniMenu width={160} position="bottom-end">
            <InfiniMenu.Target>
              <ActionIcon variant="subtle" className="app-header-icon-btn" aria-label={t("label.locale")}>
                <TranslationOutlined />
              </ActionIcon>
            </InfiniMenu.Target>
            <InfiniMenu.Dropdown>
              {localeOptions.map((option) => (
                <InfiniMenu.Item
                  key={option.value}
                  className={locale === option.value ? "infini-menu-item--active" : undefined}
                  onClick={() => setLocale(option.value)}
                >
                  {option.label}
                </InfiniMenu.Item>
              ))}
            </InfiniMenu.Dropdown>
          </InfiniMenu>
        </div>

        {user ? (
          <UserProfileDropdown user={user} onLogout={onLogout} compact />
        ) : (
          <DepthButton onClick={onLoginClick}>
            {t("action.login")}
          </DepthButton>
        )}
      </div>
    </MantineAppShell.Header>
  );
}
