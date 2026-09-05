import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applySplashLocale, applySplashTheme, dismissSplash } from "./splash";

beforeEach(() => {
  document.documentElement.classList.remove("splash-done");
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = `
    <div id="splash">
      <img id="splash-emblem" src="/guild-logo.svg" alt="" />
      <p id="splash-status"></p>
    </div>
    <div id="root" style="opacity:0;position:fixed;inset:0"></div>
  `;
});

describe("splash startup resources", () => {
  it("preserves injected branding and accessible status with theme-specific scene backgrounds", () => {
    const html = readFileSync(resolve(process.cwd(), "apps/portal/index.html"), "utf8");
    const template = new DOMParser().parseFromString(html, "text/html");

    expect(template.querySelectorAll("#splash img")).toHaveLength(1);
    expect(template.getElementById("splash-emblem")?.getAttribute("src")).toBe("{{SITE_LOGO_URL}}");
    expect(template.getElementById("splash-title")?.textContent).toBe("{{SITE_NAME}}");
    expect(template.getElementById("splash-status")?.getAttribute("role")).toBe("status");
    expect(template.querySelector('link[rel="preload"][as="image"]')).toBeNull();
    expect(template.querySelector("#splash picture, #splash source")).toBeNull();
    expect(html).toContain("/visual-themes/forged/public/login-desktop.webp");
    expect(html).toContain("/visual-themes/forged/public/light/login-mobile.webp");
    expect(template.querySelector("script:not([src])")).toBeNull();
  });

  it.each(["zh", "en"] as const)("localizes the startup status to %s before locale chunks load", (locale) => {
    applySplashLocale(locale);
    expect(document.documentElement.lang).toBe(locale);
    expect(document.getElementById("splash-status")?.textContent).toBe(
      locale === "zh" ? "正在准备公会空间…" : "Preparing your guild space…",
    );
  });

  it.each(["light", "dark"] as const)("applies %s mode without replacing or adding image resources", (colorMode) => {
    document.documentElement.dataset.theme = colorMode === "light" ? "dark" : "light";
    applySplashTheme(colorMode);

    expect(document.documentElement).toHaveAttribute("data-theme", colorMode);
    expect(document.querySelectorAll("#splash img")).toHaveLength(1);
    expect(document.getElementById("splash-emblem")).toHaveAttribute(
      "src",
      "/guild-logo.svg",
    );
  });
});

describe("dismissSplash", () => {
  it("removes the loading layer and reveals the app root", () => {
    dismissSplash();

    expect(document.getElementById("splash")).toBeNull();
    const root = document.getElementById("root");
    expect(root?.style.opacity).toBe("1");
    expect(root?.style.position).toBe("");
    expect(root?.style.inset).toBe("");
    expect(document.documentElement).toHaveClass("splash-done");
  });

  it("is safe when the splash or root has already been removed", () => {
    document.body.innerHTML = "";

    expect(() => dismissSplash()).not.toThrow();
    expect(document.documentElement).toHaveClass("splash-done");
  });
});
