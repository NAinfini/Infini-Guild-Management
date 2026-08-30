import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applySplashVisualTheme, dismissSplash } from "./splash";

beforeEach(() => {
  document.documentElement.classList.remove("splash-done");
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = `
    <div id="splash" data-visual-theme="forged">
      <source id="splash-scene-light-mobile" srcset="/visual-themes/forged/public/light/login-mobile.webp" />
      <source id="splash-scene-mobile" srcset="/visual-themes/forged/public/login-mobile.webp" />
      <source id="splash-scene-light-desktop" srcset="/visual-themes/forged/public/light/login-desktop.webp" />
      <img id="splash-scene" src="/visual-themes/forged/public/login-desktop.webp" alt="" />
      <img id="splash-emblem" src="/guild-logo.svg" alt="" />
    </div>
    <div id="root" style="opacity:0;position:fixed;inset:0"></div>
  `;
});

describe("splash visual theme", () => {
  it("keeps the default assets in static HTML before applying the configured theme", () => {
    const html = readFileSync(resolve(process.cwd(), "apps/portal/index.html"), "utf8");

    expect(html).toContain('data-visual-theme="forged"');
    expect(html).toContain('/visual-themes/forged/public/login-desktop.webp');
    expect(html).toContain('/visual-themes/forged/public/login-mobile.webp');
    expect(html).toContain('/visual-themes/forged/public/light/login-desktop.webp');
    expect(html).toContain('/visual-themes/forged/public/light/login-mobile.webp');
    expect(html).toContain('/guild-logo.svg');
  });

  it("switches both responsive access scenes, color mode, and the formal mark before React renders", () => {
    applySplashVisualTheme({
      id: "forged",
      mark: { src: "/custom-mark.svg" },
      scenes: {
        landing: {} as never,
        access: {
          login: {
            desktop: {
              sources: {
                dark: { src: "/custom/dark-login-desktop.webp" },
                light: { src: "/custom/light-login-desktop.webp" },
              },
            } as never,
            mobile: {
              sources: {
                dark: { src: "/custom/dark-login-mobile.webp" },
                light: { src: "/custom/light-login-mobile.webp" },
              },
            } as never,
          },
          register: {} as never,
        },
        status: {} as never,
        navigation: {} as never,
        routes: {} as never,
      },
    }, "light");

    expect(document.getElementById("splash")).toHaveAttribute("data-visual-theme", "forged");
    expect(document.getElementById("splash")).toHaveAttribute("data-visual-color-mode", "light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.getElementById("splash-scene")).toHaveAttribute(
      "src",
      "/custom/light-login-desktop.webp",
    );
    expect(document.getElementById("splash-scene-mobile")).toHaveAttribute(
      "srcset",
      "/custom/light-login-mobile.webp",
    );
    expect(document.getElementById("splash-scene-light-desktop")).toHaveAttribute(
      "srcset",
      "/custom/light-login-desktop.webp",
    );
    expect(document.getElementById("splash-scene-light-mobile")).toHaveAttribute(
      "srcset",
      "/custom/light-login-mobile.webp",
    );
    expect(document.getElementById("splash-emblem")).toHaveAttribute(
      "src",
      "/custom-mark.svg",
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
