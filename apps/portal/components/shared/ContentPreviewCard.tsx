import { EyeIcon, PinIcon } from "@portal/components/icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RecoverableImage } from "./RecoverableImage";
import "./ContentPreviewCard.css";

type ContentPreviewCardProps = {
  title: string;
  excerpt: ReactNode;
  category: ReactNode;
  author: ReactNode;
  timestamp: ReactNode;
  viewLabel: ReactNode;
  imageUrl?: string | null;
  pinned?: boolean;
  pinnedLabel?: ReactNode;
  archived?: boolean;
  archivedLabel?: ReactNode;
  ariaLabel: string;
  onOpen: () => void;
  domain: "announcements" | "wiki";
};

export function ContentPreviewCard({
  title,
  excerpt,
  category,
  author,
  timestamp,
  viewLabel,
  imageUrl,
  pinned = false,
  pinnedLabel,
  archived = false,
  archivedLabel,
  ariaLabel,
  onOpen,
  domain,
}: ContentPreviewCardProps) {
  const { t } = useTranslation("common");

  return (
    <button
      type="button"
      className={`content-preview-card content-preview-card--${domain}`}
      data-has-media={imageUrl ? true : undefined}
      aria-label={ariaLabel}
      onClick={onOpen}
    >
      {imageUrl ? (
        <span className="content-preview-card__media" aria-hidden="true">
          <RecoverableImage
            className="content-preview-card__image"
            source={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            fallbackClassName="content-preview-card__media-fallback"
            failureLabel={t("media.imageUnavailable")}
          />
        </span>
      ) : null}
      <span className="content-preview-card__copy">
        <span className="content-preview-card__context">
          <span className="content-preview-card__category">{category}</span>
          {pinned ? <span className="content-preview-card__badge"><PinIcon size={13} /> {pinnedLabel}</span> : null}
          {archived ? <span className="content-preview-card__badge content-preview-card__badge--muted">{archivedLabel}</span> : null}
        </span>
        <span className="content-preview-card__title">{title}</span>
        <span className="content-preview-card__excerpt">{excerpt}</span>
        <span className="content-preview-card__meta">
          <span>{author}</span>
          <span aria-hidden="true">·</span>
          <span>{timestamp}</span>
          <span className="content-preview-card__views">
            <EyeIcon size={14} aria-hidden="true" />
            <span>{viewLabel}</span>
          </span>
        </span>
      </span>
    </button>
  );
}
