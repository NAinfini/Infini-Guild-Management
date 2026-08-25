import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSiteConfigStore } from "../../stores/site-config";
import { ExperienceControls } from "../shared/ExperienceControls";
import { Button } from "../ui/button";
import "./PublicSiteHeader.css";

type PublicSiteHeaderProps = {
  actions?: ReactNode;
  showNavigation?: boolean;
};

export function PublicSiteHeader({ actions, showNavigation = true }: PublicSiteHeaderProps) {
  const { t } = useTranslation("common");
  const siteName = useSiteConfigStore((state) => state.siteName);
  const siteLogoUrl = useSiteConfigStore((state) => state.siteLogoUrl);
  const features = useSiteConfigStore((state) => state.features);

  return (
    <header className={`public-site-header${showNavigation ? "" : " public-site-header--compact"}`}>
      <Link to="/" className="public-site-header__brand" aria-label={siteName}>
        {siteLogoUrl ? (
          <img src={siteLogoUrl} alt="" aria-hidden className="public-site-header__logo" />
        ) : null}
        <span className="public-site-header__name">{siteName}</span>
      </Link>

      {showNavigation ? (
        <nav className="public-site-header__nav" aria-label={t("landing.navLabel")}>
          {features.announcements ? <Link to="/announcements">{t("nav.announcements")}</Link> : null}
          {features.events ? <Link to="/events">{t("nav.events")}</Link> : null}
          <Link to="/roster">{t("nav.roster")}</Link>
          {features.guildWar ? <Link to="/guild-war">{t("nav.guild-war")}</Link> : null}
          {features.wiki ? <Link to="/wiki">{t("nav.wiki")}</Link> : null}
        </nav>
      ) : null}

      <div className="public-site-header__actions flex items-center gap-2">
        <ExperienceControls />
        {actions ?? (
          <Button render={<Link to="/login" />} nativeButton={false} size="default">
            {t("action.login")}
          </Button>
        )}
      </div>
    </header>
  );
}
