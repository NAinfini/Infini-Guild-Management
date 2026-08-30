import {
  ACTIVE_VISUAL_THEME,
  resolveVisualThemeAssetSource,
  type VisualPageSceneId,
  type VisualStatusSceneId,
  type VisualThemeAsset,
} from "../../visual/themes";
import type { CSSProperties } from "react";
import { useTheme } from "../../providers/ThemeProvider";
import "./VisualThemeArtwork.css";

type VisualThemePublicSceneVariant =
  | "landing"
  | "access-login"
  | "access-register"
  | `status-${VisualStatusSceneId}`;

type VisualThemeSceneProps = {
  className?: string;
  variant?: VisualThemePublicSceneVariant | "navigation" | VisualPageSceneId;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
};

type ResolvedThemeAsset = Readonly<{
  desktop: VisualThemeAsset;
  mobile?: VisualThemeAsset;
}>;

function resolveThemeAssets(
  variant: NonNullable<VisualThemeSceneProps["variant"]>,
): ResolvedThemeAsset {
  if (variant === "landing") return ACTIVE_VISUAL_THEME.scenes.landing;
  if (variant === "access-login") return ACTIVE_VISUAL_THEME.scenes.access.login;
  if (variant === "access-register") return ACTIVE_VISUAL_THEME.scenes.access.register;
  if (variant === "status-not-found") return ACTIVE_VISUAL_THEME.scenes.status["not-found"];
  if (variant === "status-error") return ACTIVE_VISUAL_THEME.scenes.status.error;
  if (variant === "status-forbidden") return ACTIVE_VISUAL_THEME.scenes.status.forbidden;
  if (variant === "status-maintenance") return ACTIVE_VISUAL_THEME.scenes.status.maintenance;
  if (variant === "navigation") return { desktop: ACTIVE_VISUAL_THEME.scenes.navigation };
  return { desktop: ACTIVE_VISUAL_THEME.scenes.routes[variant] };
}

export function VisualThemeScene({
  className,
  variant = "landing",
  loading = "lazy",
  fetchPriority = "auto",
}: VisualThemeSceneProps) {
  const { theme } = useTheme();
  const assets = resolveThemeAssets(variant);
  const asset = assets.desktop;
  const desktopSource = resolveVisualThemeAssetSource(asset, theme);
  const mobileSource = assets.mobile
    ? resolveVisualThemeAssetSource(assets.mobile, theme)
    : undefined;
  const imagePosition = {
    "--visual-theme-object-position": asset.objectPosition,
    "--visual-theme-mobile-object-position": assets.mobile?.objectPosition ?? asset.objectPosition,
  } as CSSProperties;

  return (
    <div
      className={`visual-theme-scene ${className ?? ""}`.trim()}
      aria-hidden="true"
      data-visual-theme={ACTIVE_VISUAL_THEME.id}
      data-visual-color-mode={theme}
    >
      {assets.mobile ? (
        <picture className="visual-theme-scene__picture">
          <source
            media="(max-width: 767px)"
            srcSet={mobileSource?.src}
          />
          <img
            key={`${desktopSource.src}:${mobileSource?.src}`}
            src={desktopSource.src}
            width={asset.width}
            height={asset.height}
            alt=""
            className="visual-theme-scene__environment"
            loading={loading}
            fetchPriority={fetchPriority}
            draggable={false}
            style={imagePosition}
          />
        </picture>
      ) : (
        <img
          key={desktopSource.src}
          src={desktopSource.src}
          width={asset.width}
          height={asset.height}
          alt=""
          className="visual-theme-scene__environment"
          loading={loading}
          fetchPriority={fetchPriority}
          draggable={false}
          style={imagePosition}
        />
      )}
    </div>
  );
}
