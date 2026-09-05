import type { User } from "@guild/shared";
import type { IconProps } from "@tabler/icons-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { ExperienceControls } from "../shared/ExperienceControls";
import { CmdKSearch } from "./CmdKSearch";
import { NotificationPopover } from "./NotificationPopover";
import { UserProfileDropdown } from "./UserProfileDropdown";

type AppHeaderProps = {
  isMobile: boolean;
  isHeaderCompact: boolean;
  activePageTitle: string;
  /* 当前路由的图标，与侧栏同一份元数据，标题旁做区域标记用。 */
  activePageIcon: ComponentType<IconProps>;
  user: User | null;
  onLogout: () => void;
  onLoginClick: () => void;
};

export function AppHeader({
  isMobile,
  isHeaderCompact,
  activePageTitle,
  activePageIcon: ActivePageIcon,
  user,
  onLogout,
  onLoginClick,
}: AppHeaderProps) {
  const { t } = useTranslation("common");

  return (
    <header className="app-header">
      <h1 className="app-header__page-title" tabIndex={-1}>
        <span className="app-header__page-glyph" aria-hidden>
          <ActivePageIcon />
        </span>
        <span className="app-header__page-text">{activePageTitle}</span>
      </h1>

      <div className="app-header__right flex items-center gap-2">
        <CmdKSearch asIcon={isMobile || isHeaderCompact} />
        {user ? <NotificationPopover user={user} /> : null}

        <ExperienceControls compact={isMobile} />

        {user ? (
          <UserProfileDropdown user={user} onLogout={onLogout} compact />
        ) : (
          <Button size="default" onClick={onLoginClick}>
            {t("action.login")}
          </Button>
        )}
      </div>
    </header>
  );
}
