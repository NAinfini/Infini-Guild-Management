import { describe, expect, it, vi } from "vitest";

describe("i18n storage bootstrap", () => {
  it("initializes when localStorage access is blocked", async () => {
    vi.resetModules();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const module = await import("./index");
    await expect(module.i18nReady).resolves.toBeUndefined();
    expect(["en", "zh"]).toContain(module.default.language);
  });

  it("loads only the active locale at bootstrap and lazy-loads the other locale on demand", async () => {
    vi.resetModules();
    window.localStorage.setItem("locale", "zh");

    const module = await import("./index");
    await module.i18nReady;

    expect(module.default.hasResourceBundle("zh", "common")).toBe(true);
    expect(module.default.hasResourceBundle("en", "common")).toBe(false);

    await module.setI18nLocale("en");
    expect(module.default.hasResourceBundle("en", "common")).toBe(true);
    expect(module.default.language).toBe("en");
  });
});
