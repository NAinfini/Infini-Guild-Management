import type { VisualColorMode } from "./visual/themes";

export function applySplashTheme(colorMode: VisualColorMode): void {
  document.documentElement.dataset.theme = colorMode;
}

export function applySplashLocale(locale: "en" | "zh"): void {
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  const status = document.getElementById("splash-status");
  if (status) status.textContent = locale === "zh" ? "正在准备公会空间…" : "Preparing your guild space…";
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
