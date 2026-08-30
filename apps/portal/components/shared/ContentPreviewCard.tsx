import { EyeIcon, PinIcon } from "@portal/components/icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../providers/ThemeProvider";
import { ACTIVE_VISUAL_THEME, resolveVisualThemeAssetSource } from "../../visual/themes";
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
  compact?: boolean;
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
  compact = false,
  ariaLabel,
  onOpen,
  domain,
}: ContentPreviewCardProps) {
  const { t } = useTranslation("common");
  const { theme } = useTheme();
  const fallbackAsset = ACTIVE_VISUAL_THEME.scenes.routes[
    domain === "wiki" ? "wiki" : "announcements"
  ];
  const resolvedImageUrl = imageUrl
    ?? resolveVisualThemeAssetSource(fallbackAsset, theme).src;

  return (
    <button
      type="button"
      className={`content-preview-card content-preview-card--${domain}${compact ? " content-preview-card--compact" : ""}`}
      aria-label={ariaLabel}
      onClick={onOpen}
    >
      <span className="content-preview-card__media" aria-hidden="true">
        <RecoverableImage
          className="content-preview-card__image"
          source={resolvedImageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          fallbackClassName="content-preview-card__media-fallback"
          failureLabel={t("media.imageUnavailable")}
        />
        <span className="content-preview-card__scrim" />
        <span className="content-preview-card__badges">
          {pinned ? <span className="content-preview-card__badge"><PinIcon size={13} /> {pinnedLabel}</span> : null}
          {archived ? <span className="content-preview-card__badge content-preview-card__badge--muted">{archivedLabel}</span> : null}
        </span>
      </span>
      <span className="content-preview-card__copy">
        <span className="content-preview-card__eyebrow">{category}</span>
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
