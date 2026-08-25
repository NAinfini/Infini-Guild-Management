import { buttonVariants } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSiteConfigStore } from "../../stores/site-config";
import { ACTIVE_VISUAL_THEME } from "../../visual/themes";
import { PublicSiteHeader } from "../layout/PublicSiteHeader";
import { VisualThemeScene } from "../shared/VisualThemeArtwork";

type AuthPageFrameProps = {
  mode: "login" | "register" | "reset" | "verify";
  children: ReactNode;
};

const MODE_COPY = {
  login: {
    title: "title.login",
    description: "login.form.description",
  },
  register: {
    title: "title.register",
    description: "register.form.description",
  },
  reset: {
    title: "reset.title",
    description: "reset.description",
  },
  verify: {
    title: "verify.title",
    description: "verify.description",
  },
} as const;

export function AuthPageFrame({ mode, children }: AuthPageFrameProps) {
  const { t } = useTranslation("auth");
  const siteName = useSiteConfigStore((state) => state.siteName);
  const copy = MODE_COPY[mode];
  const offersVisitorAccess = mode === "login" || mode === "register";

  return (
    <div className="login-page">
      <VisualThemeScene
        className="login-page__scene"
        variant="access"
        loading="eager"
        fetchPriority="high"
      />
      <PublicSiteHeader
        showNavigation={false}
        actions={offersVisitorAccess ? (
          <Link to="/dashboard" className={buttonVariants({ size: "sm" })}>
            {t("button.visitorAccess")}
          </Link>
        ) : undefined}
      />

      <div className="login-page__stage">
        <Card className="login-page__card">
          <header className="login-page__form-heading">
            <div className="login-page__card-brand">
              <img
                src={ACTIVE_VISUAL_THEME.mark.src}
                alt=""
                aria-hidden="true"
                className="login-page__card-emblem"
              />
              <span className="login-page__card-site-name" title={siteName}>{siteName}</span>
            </div>
            <h1>
              {t(copy.title)}
            </h1>
            <p className="login-page__form-description">
              {t(copy.description)}
            </p>
          </header>
          {children}
        </Card>
      </div>
    </div>
  );
}
