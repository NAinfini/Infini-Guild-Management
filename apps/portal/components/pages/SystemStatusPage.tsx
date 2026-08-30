import { Button, buttonVariants } from "@portal/components/ui/button";
import { cn } from "@portal/lib/utils";
import { Card } from "@portal/components/ui/card";
import type { ReactNode } from "react";
import { ACTIVE_VISUAL_THEME } from "../../visual/themes";
import { VisualThemeScene } from "../shared/VisualThemeArtwork";
import "./SystemStatusPage.css";

type SystemStatusAction =
  | { label: ReactNode; href: string }
  | { label: ReactNode; onClick: () => void };

type SystemStatusPageProps = {
  kind: "not-found" | "error" | "forbidden" | "maintenance";
  code: string;
  title: ReactNode;
  description: ReactNode;
  action: SystemStatusAction;
};

export function SystemStatusPage({
  kind,
  code,
  title,
  description,
  action,
}: SystemStatusPageProps) {
  return (
    <section
      className={`system-status-page system-status-page--${kind}`}
      aria-labelledby="system-status-title"
    >
      <VisualThemeScene
        className="system-status-page__scene"
        variant={`status-${kind}`}
        loading="eager"
        fetchPriority="high"
      />

      <Card className="system-status-page__panel">
        <img
          src={ACTIVE_VISUAL_THEME.mark.src}
          alt=""
          aria-hidden="true"
          className="system-status-page__emblem"
        />
        <p className="system-status-page__code">{code}</p>
        <h1 id="system-status-title" className="system-status-page__title">
          {title}
        </h1>
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
