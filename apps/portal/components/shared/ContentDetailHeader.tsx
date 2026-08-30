import { ClockIcon, EyeIcon } from "@portal/components/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@portal/components/ui/avatar";
import { Badge } from "@portal/components/ui/badge";
import { cn } from "@portal/lib/utils";
import type { ReactNode } from "react";
import "./ContentDetailHeader.css";

type ContentDetailHeaderProps = {
  domain: "announce" | "wiki";
  navigation: ReactNode;
  category: ReactNode;
  states?: ReactNode;
  title: string;
  titleClassName?: string;
  authorLabel: ReactNode;
  authorName: string;
  authorAvatarUrl?: string | null;
  authorAvatarClassName?: string;
  timestampLabel: ReactNode;
  timestamp: string;
  timestampDateTime: string;
  viewsLabel: ReactNode;
  viewCount: number;
  actions?: ReactNode;
};

export function ContentDetailHeader({
  domain,
  navigation,
  category,
  states,
  title,
  titleClassName,
  authorLabel,
  authorName,
  authorAvatarUrl,
  authorAvatarClassName,
  timestampLabel,
  timestamp,
  timestampDateTime,
  viewsLabel,
  viewCount,
  actions,
}: ContentDetailHeaderProps) {
  const authorInitial = authorName.trim().charAt(0).toLocaleUpperCase() || "?";

  return (
    <header className="content-detail-header" data-domain={domain}>
      <div className="content-detail-header__utility-row">
        <div className="content-detail-header__navigation">{navigation}</div>
        {actions ? <div className="content-detail-header__actions">{actions}</div> : null}
      </div>

      <div className="content-detail-header__copy">
        <h2 className={cn("content-detail-header__title", titleClassName)}>{title}</h2>

        <div className="content-detail-header__taxonomy">
          <Badge variant="secondary" className="content-detail-header__category">
            <span className="content-detail-header__category-label">{category}</span>
          </Badge>
          {states}
        </div>

        <div className="content-detail-header__metadata">
          <div className="content-detail-header__author">
            <Avatar size="lg" className={cn("content-detail-header__avatar", authorAvatarClassName)}>
              {authorAvatarUrl ? <AvatarImage src={authorAvatarUrl} alt="" /> : null}
              <AvatarFallback>{authorInitial}</AvatarFallback>
            </Avatar>
            <span className="content-detail-header__identity">
              <span className="content-detail-header__meta-label">{authorLabel}</span>
              <strong className="content-detail-header__author-name">{authorName}</strong>
            </span>
          </div>

          <div className="content-detail-header__stat">
            <ClockIcon size={17} aria-hidden="true" />
            <span className="content-detail-header__stat-copy">
              <span className="content-detail-header__meta-label">{timestampLabel}</span>
              <time dateTime={timestampDateTime}>{timestamp}</time>
            </span>
          </div>

          <div className="content-detail-header__stat">
            <EyeIcon size={17} aria-hidden="true" />
            <span className="content-detail-header__stat-copy">
              <span className="content-detail-header__meta-label">{viewsLabel}</span>
              <data value={viewCount}>{viewCount.toLocaleString()}</data>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
