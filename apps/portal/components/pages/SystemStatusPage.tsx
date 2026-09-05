import { Button, buttonVariants } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { cn } from "@portal/lib/utils";
import type { ReactNode } from "react";
import { useSiteConfigStore } from "../../stores/site-config";
import { VisualThemeScene } from "../shared/VisualThemeArtwork";
import "./SystemStatusPage.css";

type SystemStatusAction =
  | { label: ReactNode; href: string }
  | { label: ReactNode; onClick: () => void };

type SystemStatusPageProps = {
  kind: "not-found" | "error" | "unauthorized" | "forbidden" | "maintenance";
  code: string;
  title: ReactNode;
  description: ReactNode;
  action: SystemStatusAction;
};

const STATUS_SCENES = {
  "not-found": "status-not-found",
  error: "status-error",
  unauthorized: "status-forbidden",
  forbidden: "status-forbidden",
  maintenance: "status-maintenance",
} as const;

export function SystemStatusPage({
  kind,
  code,
  title,
  description,
  action,
}: SystemStatusPageProps) {
  const siteName = useSiteConfigStore((state) => state.siteName).trim();
  const siteLogoUrl = useSiteConfigStore((state) => state.siteLogoUrl);

  return (
    <section
      className={`system-status-page system-status-page--${kind}`}
      aria-labelledby="system-status-title"
    >
      <VisualThemeScene
        className="system-status-page__scene"
        variant={STATUS_SCENES[kind]}
        loading="eager"
        fetchPriority="high"
      />

      <Card className="system-status-page__panel">
        {siteLogoUrl || siteName ? (
          <div className="system-status-page__brand">
            {siteLogoUrl ? (
              <img
                src={siteLogoUrl}
                alt=""
                aria-hidden="true"
                className="system-status-page__emblem"
              />
            ) : null}
            {siteName ? <span className="system-status-page__site-name">{siteName}</span> : null}
          </div>
        ) : null}
        <div className="system-status-page__heading">
          <h1 id="system-status-title" className="system-status-page__title">
            {title}
          </h1>
          <p className="system-status-page__code">{code}</p>
        </div>
        <p className="system-status-page__description">{description}</p>
        {"href" in action ? (
          <a
            href={action.href}
            className={cn(buttonVariants(), "system-status-page__action")}
          >
            {action.label}
          </a>
        ) : (
          <Button onClick={action.onClick} className="system-status-page__action">
            {action.label}
          </Button>
        )}
      </Card>
    </section>
  );
}
