import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applySplashVisualTheme, dismissSplash } from "./splash";

beforeEach(() => {
  document.documentElement.classList.remove("splash-done");
  document.body.innerHTML = `
    <div id="splash" data-visual-theme="forged">
      <source id="splash-scene-mobile" srcset="/visual-themes/forged/public/access-mobile.webp" />
      <img id="splash-scene" src="/visual-themes/forged/public/access-desktop.webp" alt="" />
      <img id="splash-emblem" src="/guild-logo.svg" alt="" />
    </div>
    <div id="root" style="opacity:0;position:fixed;inset:0"></div>
  `;
});

describe("splash visual theme", () => {
  it("keeps the default assets in static HTML before applying the configured theme", () => {
    const html = readFileSync(resolve(process.cwd(), "apps/portal/index.html"), "utf8");

    expect(html).toContain('data-visual-theme="forged"');
    expect(html).toContain('/visual-themes/forged/public/access-desktop.webp');
    expect(html).toContain('/visual-themes/forged/public/access-mobile.webp');
    expect(html).toContain('/guild-logo.svg');
  });

  it("uses a full-bleed theme scene without a synthetic falling-star layer", () => {
    const html = readFileSync(resolve(process.cwd(), "apps/portal/index.html"), "utf8");

    expect(html).toMatch(/#splash\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
    expect(html).toMatch(/\.splash-brand\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center/s);
    expect(html).toMatch(/class="splash-brand"[\s\S]*id="splash-emblem"[\s\S]*id="splash-title"/);
    expect(html).toMatch(/\.splash-scene\s*\{[^}]*object-fit:\s*cover/s);
    expect(html).toMatch(
      /#splash\s*>\s*picture,\s*\.splash-scene,\s*\.splash-scrim\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s,
    );
    expect(html).toContain('class="splash-scrim"');
    expect(html).not.toContain("lightfall");
    expect(html).not.toContain("@keyframes splash-progress");
  });

  it("switches both responsive access scenes and the formal mark before React renders", () => {
    applySplashVisualTheme({
      id: "forged",
      mark: { src: "/custom-mark.svg" },
      scenes: {
        landing: {} as never,
        access: {
          desktop: { src: "/custom/access-desktop.webp" } as never,
          mobile: { src: "/custom/access-mobile.webp" } as never,
        },
        status: {} as never,
        navigation: {} as never,
        routes: {} as never,
      },
    });

    expect(document.getElementById("splash")).toHaveAttribute("data-visual-theme", "forged");
    expect(document.getElementById("splash-scene")).toHaveAttribute(
      "src",
      "/custom/access-desktop.webp",
    );
    expect(document.getElementById("splash-scene-mobile")).toHaveAttribute(
      "srcset",
      "/custom/access-mobile.webp",
    );
    expect(document.getElementById("splash-emblem")).toHaveAttribute(
      "src",
      "/custom-mark.svg",
    );
  });

  it("applies the active theme before mounting the React application", () => {
    const main = readFileSync(resolve(process.cwd(), "apps/portal/main.tsx"), "utf8");

    expect(main).toContain('import("./visual/themes").then');
    expect(main.indexOf("applySplashVisualTheme(ACTIVE_VISUAL_THEME)")).toBeLessThan(
      main.indexOf("mountApp(root)"),
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
