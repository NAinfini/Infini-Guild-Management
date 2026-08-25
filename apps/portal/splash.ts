import type { PortalVisualTheme } from "./visual/themes";

export function applySplashVisualTheme(
  theme: Pick<PortalVisualTheme, "id" | "mark" | "scenes">,
): void {
  document.getElementById("splash")?.setAttribute("data-visual-theme", theme.id);

  const scene = document.getElementById("splash-scene");
  if (scene instanceof HTMLImageElement) scene.src = theme.scenes.access.desktop.src;

  const mobileScene = document.getElementById("splash-scene-mobile");
  if (mobileScene instanceof HTMLSourceElement) {
    mobileScene.srcset = theme.scenes.access.mobile.src;
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
