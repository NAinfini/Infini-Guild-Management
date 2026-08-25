import type { User } from "@guild/shared";
import { UserIcon } from "@portal/components/icons";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/auth";
import { DownOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from "../../utils/icons";
import { resolveMediaUrl } from "../../utils/media";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

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
      <Button size="default" onClick={() => void navigate({ to: "/login" })}>
        {t("action.login")}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={`app-profile-trigger inline-flex items-center gap-2 ${compact ? "app-profile-trigger--compact" : ""}`}
        aria-label={`${user.display_name}: ${t("profile.menu.aria.open")}`}
      >
        <Avatar className="app-profile-avatar" aria-hidden>
          {profile?.avatar_media_id ? (
            <AvatarImage src={resolveMediaUrl(profile.avatar_media_id)} alt="" />
          ) : null}
          <AvatarFallback className="bg-transparent text-[var(--accent-on-fill)]">
            <UserIcon size={18} />
          </AvatarFallback>
        </Avatar>
        <span className="app-profile-meta">
          <span className="app-profile-name font-semibold">{user.display_name}</span>
          {!compact ? (
            <span
              className="app-profile-role text-[var(--text-muted)]"
              style={user.role_color ? { color: user.role_color } : undefined}
            >
              {user.role_name}
            </span>
          ) : null}
        </span>
        <DownOutlined className="app-profile-chevron" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuItem onClick={() => void navigate({ to: "/profile" })}>
          <UserOutlined />
          {t("profile.menu.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void navigate({ to: "/settings" })}>
          <SettingOutlined />
          {t("profile.menu.settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void onLogout()}>
          <LogoutOutlined />
          {t("action.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

