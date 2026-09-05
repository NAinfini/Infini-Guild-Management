import {
  ACTIVE_VISUAL_THEME,
  resolveVisualThemeAssetSource,
  type ResponsiveVisualThemeAsset,
  type VisualStatusSceneId,
  type VisualWorkspaceSceneId,
} from "../../visual/themes";
import type { CSSProperties } from "react";
import { useTheme } from "../../providers/ThemeProvider";
import "./VisualThemeArtwork.css";

type VisualThemeSceneVariant =
  | `workspace-${VisualWorkspaceSceneId}`
  | "landing"
  | "access-login"
  | "access-register"
  | `status-${VisualStatusSceneId}`;

type VisualThemeSceneProps = {
  className?: string;
  variant?: VisualThemeSceneVariant;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
};

function resolveThemeAssets(
  variant: NonNullable<VisualThemeSceneProps["variant"]>,
): ResponsiveVisualThemeAsset {
  if (variant === "workspace-guild") return ACTIVE_VISUAL_THEME.scenes.workspace.guild;
  if (variant === "workspace-falls") return ACTIVE_VISUAL_THEME.scenes.workspace.falls;
  if (variant === "workspace-citadel") return ACTIVE_VISUAL_THEME.scenes.workspace.citadel;
  if (variant === "landing") return ACTIVE_VISUAL_THEME.scenes.landing;
  if (variant === "access-login") return ACTIVE_VISUAL_THEME.scenes.access.login;
  if (variant === "access-register") return ACTIVE_VISUAL_THEME.scenes.access.register;
  if (variant === "status-not-found") return ACTIVE_VISUAL_THEME.scenes.status["not-found"];
  if (variant === "status-error") return ACTIVE_VISUAL_THEME.scenes.status.error;
  if (variant === "status-forbidden") return ACTIVE_VISUAL_THEME.scenes.status.forbidden;
  if (variant === "status-maintenance") return ACTIVE_VISUAL_THEME.scenes.status.maintenance;
  const unsupportedVariant: never = variant;
  throw new Error(`Unsupported visual scene: ${unsupportedVariant}`);
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
  const mobileSource = resolveVisualThemeAssetSource(assets.mobile, theme);
  const imagePosition = {
    "--visual-theme-object-position": asset.objectPosition,
    "--visual-theme-mobile-object-position": assets.mobile.objectPosition,
  } as CSSProperties;

  return (
    <div
      className={`visual-theme-scene ${className ?? ""}`.trim()}
      aria-hidden="true"
      data-visual-theme={ACTIVE_VISUAL_THEME.id}
      data-visual-color-mode={theme}
    >
      <picture className="visual-theme-scene__picture">
        <source
          media="(max-width: 767px)"
          srcSet={mobileSource.src}
        />
        <img
          key={`${desktopSource.src}:${mobileSource.src}`}
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
    </div>
  );
}
