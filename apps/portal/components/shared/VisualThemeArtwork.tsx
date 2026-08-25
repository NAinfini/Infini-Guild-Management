import {
  ACTIVE_VISUAL_THEME,
  type VisualPageSceneId,
  type VisualThemeAsset,
} from "../../visual/themes";
import "./VisualThemeArtwork.css";

type VisualThemeSceneProps = {
  className?: string;
  variant?: "landing" | "access" | "status" | "navigation" | VisualPageSceneId;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
};

function resolveThemeAsset(
  variant: NonNullable<VisualThemeSceneProps["variant"]>,
): VisualThemeAsset {
  if (variant === "landing") return ACTIVE_VISUAL_THEME.scenes.landing;
  if (variant === "access") return ACTIVE_VISUAL_THEME.scenes.access.desktop;
  if (variant === "status") return ACTIVE_VISUAL_THEME.scenes.status;
  if (variant === "navigation") return ACTIVE_VISUAL_THEME.scenes.navigation;
  return ACTIVE_VISUAL_THEME.scenes.routes[variant];
}

export function VisualThemeScene({
  className,
  variant = "landing",
  loading = "lazy",
  fetchPriority = "auto",
}: VisualThemeSceneProps) {
  const asset = resolveThemeAsset(variant);

  return (
    <div
      className={`visual-theme-scene ${className ?? ""}`.trim()}
      aria-hidden="true"
      data-visual-theme={ACTIVE_VISUAL_THEME.id}
    >
      {variant === "access" ? (
        <picture className="visual-theme-scene__picture">
          <source
            media="(max-width: 767px)"
            srcSet={ACTIVE_VISUAL_THEME.scenes.access.mobile.src}
          />
          <img
            key={asset.src}
            src={asset.src}
            width={asset.width}
            height={asset.height}
            alt=""
            className="visual-theme-scene__environment"
            loading={loading}
            fetchPriority={fetchPriority}
            draggable={false}
            style={{ objectPosition: asset.objectPosition }}
          />
        </picture>
      ) : (
        <img
          key={asset.src}
          src={asset.src}
          width={asset.width}
          height={asset.height}
          alt=""
          className="visual-theme-scene__environment"
          loading={loading}
          fetchPriority={fetchPriority}
          draggable={false}
          style={{ objectPosition: asset.objectPosition }}
        />
      )}
    </div>
  );
}
