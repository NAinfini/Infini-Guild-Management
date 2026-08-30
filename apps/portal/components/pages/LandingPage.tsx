import { buttonVariants } from "@portal/components/ui/button";
import { cn } from "@portal/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSiteConfigStore } from "../../stores/site-config";
import { PublicSiteHeader } from "../layout/PublicSiteHeader";
import { VisualThemeScene } from "../shared/VisualThemeArtwork";
import {
  ArrowRightIcon,
  BookTextIcon,
  CalendarDaysIcon,
  UsersIcon,
} from "../icons";
import "./LandingPage.css";

export function LandingPage() {
  const { t } = useTranslation("common");
  const siteName = useSiteConfigStore((state) => state.siteName);
  const siteLogoUrl = useSiteConfigStore((state) => state.siteLogoUrl);

  return (
    <div className="landing-page">
      <a href="#landing-main" className="app-skip-link">{t("nav.skipToContent")}</a>
      <VisualThemeScene
        className="landing-page__backdrop"
        loading="eager"
        fetchPriority="high"
      />
      <PublicSiteHeader showNavigation={false} />

      <main id="landing-main" tabIndex={-1} className="landing-page__main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero__copy">
            <div className="landing-hero__identity">
              {siteLogoUrl ? (
                <img className="landing-hero__logo" src={siteLogoUrl} alt="" aria-hidden="true" />
              ) : null}
              <h1 id="landing-title" className="landing-hero__title">
                {siteName}
              </h1>
            </div>
            <Link
              to="/dashboard"
              className={cn(buttonVariants({ size: "lg" }), "landing-hero__action")}
            >
              {t("landing.action.signIn")}
              <ArrowRightIcon size={17} aria-hidden="true" />
            </Link>

            <div className="landing-values" aria-label={t("landing.values.label")}>
              <LandingValue
                icon={<UsersIcon size={19} aria-hidden="true" />}
                title={t("landing.values.people.title")}
                description={t("landing.values.people.description")}
              />
              <LandingValue
                icon={<CalendarDaysIcon size={19} aria-hidden="true" />}
                title={t("landing.values.coordinate.title")}
                description={t("landing.values.coordinate.description")}
              />
              <LandingValue
                icon={<BookTextIcon size={19} aria-hidden="true" />}
                title={t("landing.values.memory.title")}
                description={t("landing.values.memory.description")}
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function LandingValue({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="landing-value">
      <span className="landing-value__icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </div>
  );
}
