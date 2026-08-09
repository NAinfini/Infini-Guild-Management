// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { dismissSplash } from "./splash";

beforeEach(() => {
  document.documentElement.classList.remove("splash-done");
  document.body.innerHTML = `
    <div id="splash"></div>
    <div id="root" style="opacity:0;position:fixed;inset:0"></div>
  `;
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
