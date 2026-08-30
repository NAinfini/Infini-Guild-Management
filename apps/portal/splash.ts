import {
  resolveVisualThemeAssetSource,
  type PortalVisualTheme,
  type VisualColorMode,
} from "./visual/themes";

export function applySplashVisualTheme(
  theme: Pick<PortalVisualTheme, "id" | "mark" | "scenes">,
  colorMode: VisualColorMode,
): void {
  document.documentElement.dataset.theme = colorMode;

  const splash = document.getElementById("splash");
  splash?.setAttribute("data-visual-theme", theme.id);
  splash?.setAttribute("data-visual-color-mode", colorMode);

  const desktopSource = resolveVisualThemeAssetSource(
    theme.scenes.access.login.desktop,
    colorMode,
  ).src;
  const mobileSource = resolveVisualThemeAssetSource(
    theme.scenes.access.login.mobile,
    colorMode,
  ).src;

  const scene = document.getElementById("splash-scene");
  if (scene instanceof HTMLImageElement) scene.src = desktopSource;

  for (const sourceId of ["splash-scene-light-desktop"]) {
    const source = document.getElementById(sourceId);
    if (source instanceof HTMLSourceElement) source.srcset = desktopSource;
  }

  for (const sourceId of ["splash-scene-light-mobile", "splash-scene-mobile"]) {
    const source = document.getElementById(sourceId);
    if (source instanceof HTMLSourceElement) source.srcset = mobileSource;
  }

  const emblem = document.getElementById("splash-emblem");
  if (emblem instanceof HTMLImageElement) emblem.src = theme.mark.src;
}

export function dismissSplash(): void {
  document.getElementById("splash")?.remove();

  const root = document.getElementById("root");
  if (root) {
    root.style.opacity = "1";
    root.style.position = "";
    root.style.inset = "";
  }

  document.documentElement.classList.add("splash-done");
}
