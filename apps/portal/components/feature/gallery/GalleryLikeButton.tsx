import { HeartIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { cn } from "@portal/lib/utils";
import { useTranslation } from "react-i18next";

type GalleryLikeButtonProps = {
  liked: boolean;
  likeCount: number;
  canLike: boolean;
  loading?: boolean;
  className?: string;
  onToggle: () => void;
};

export function GalleryLikeButton({
  liked,
  likeCount,
  canLike,
  loading = false,
  className,
  onToggle,
}: GalleryLikeButtonProps) {
  const { t } = useTranslation("gallery");
  const label = canLike
    ? t(liked ? "aria.unlike" : "aria.like", { count: likeCount })
    : t("aria.likeCount", { count: likeCount });
  const content = (
    <>
      <HeartIcon size={16} aria-hidden="true" />
      <span className="gallery-like-count">{likeCount}</span>
    </>
  );

  if (!canLike) {
    return (
      <span
        className={cn("gallery-like-button gallery-like-button--readonly", className)}
        aria-label={label}
        data-liked={liked ? "true" : "false"}
      >
        {content}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("gallery-like-button", className)}
      aria-label={label}
      aria-pressed={liked}
      data-liked={liked ? "true" : "false"}
      loading={loading}
      onClick={onToggle}
    >
      {content}
    </Button>
  );
}
