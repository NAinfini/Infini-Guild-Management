import { act, fireEvent, screen } from "@testing-library/react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DARK_MODE_MEDIA_QUERY, REDUCED_MOTION_MEDIA_QUERY } from "./stores/preferences";

const mocks = vi.hoisted(() => ({
  root: null as Root | null,
  mountApp: vi.fn(),
}));

vi.mock("react-dom/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...original,
    createRoot: (...args: Parameters<typeof original.createRoot>) => {
      mocks.root = original.createRoot(...args);
      return mocks.root;
    },
  };
});
describe("portal startup", () => {
  let systemPreferences = { dark: false, reduced: false };

  beforeEach(() => {
    vi.resetModules();
    mocks.mountApp.mockReset();
    systemPreferences = { dark: false, reduced: false };
    vi.spyOn(window, "matchMedia").mockImplementation((query) => Object.assign(new EventTarget(), {
      matches: query === DARK_MODE_MEDIA_QUERY ? systemPreferences.dark
        : query === REDUCED_MOTION_MEDIA_QUERY && systemPreferences.reduced,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as MediaQueryList);
    localStorage.clear();
    localStorage.setItem("themeMode", "light");
    document.documentElement.lang = "";
    delete document.documentElement.dataset.locale;
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.motion;
    document.documentElement.classList.remove("splash-done");
    document.body.innerHTML = '<div id="splash"></div><div id="root" style="opacity:0"></div>';
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => mocks.root?.unmount());
    mocks.root = null;
    vi.unstubAllGlobals();
  });

  it.each([
    { themeMode: null, systemDark: true, motionPreference: null, systemReduced: false, theme: "dark", motion: "full" },
    { themeMode: null, systemDark: false, motionPreference: null, systemReduced: false, theme: "light", motion: "full" },
    { themeMode: "system", systemDark: true, motionPreference: "system", systemReduced: true, theme: "dark", motion: "reduced" },
    { themeMode: "light", systemDark: true, motionPreference: "reduce", systemReduced: false, theme: "light", motion: "reduced" },
    { themeMode: "dark", systemDark: false, motionPreference: "system", systemReduced: true, theme: "dark", motion: "reduced" },
  ] as const)("applies $theme / $motion before bootstrap with themeMode=$themeMode and motionPreference=$motionPreference", async ({
    themeMode, systemDark, motionPreference, systemReduced, theme, motion,
  }) => {
    if (themeMode === null) localStorage.removeItem("themeMode");
    else localStorage.setItem("themeMode", themeMode);
    if (motionPreference !== null) localStorage.setItem("motionPreference", motionPreference);
    systemPreferences = { dark: systemDark, reduced: systemReduced };
    let displayAtMount: { theme: string | undefined; motion: string | undefined } | undefined;
    mocks.mountApp.mockImplementation(() => {
      displayAtMount = { theme: document.documentElement.dataset.theme, motion: document.documentElement.dataset.motion };
    });
    vi.doMock("./bootstrap", () => ({ mountApp: mocks.mountApp }));

    await act(async () => {
      await import("./main");
      await vi.dynamicImportSettled();
    });

    expect(mocks.mountApp).toHaveBeenCalledOnce();
    expect(displayAtMount).toEqual({ theme, motion });
  });

  it.each([
    { stored: "zh", browser: "en-US", locale: "zh", failure: "locale" },
    { stored: "en", browser: "zh-CN", locale: "en", failure: "module" },
    { stored: null, browser: "zh-TW", locale: "zh", failure: "module" },
    { stored: "unsupported", browser: "en-US", locale: "en", failure: "locale" },
    { stored: "blocked", browser: "zh-CN", locale: "zh", failure: "locale" },
  ] as const)(
    "offers $locale recovery for a $failure failure with stored=$stored and browser=$browser",
    async ({ stored, browser, locale, failure }) => {
      if (stored) localStorage.setItem("locale", stored);
      vi.spyOn(navigator, "language", "get").mockReturnValue(browser);
      if (stored === "blocked") {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new DOMException("blocked", "SecurityError");
        });
      }
      const error = new Error(`${failure} resource unavailable`);
      vi.doMock("./bootstrap", () => {
        if (failure === "module") throw error;
        return { mountApp: mocks.mountApp };
      });
      mocks.mountApp.mockRejectedValue(error);

      const reload = vi.fn();
      vi.stubGlobal("window", new Proxy(window, {
        get: (target, key, receiver) => key === "location" ? { reload } : Reflect.get(target, key, receiver),
      }));
      await act(async () => {
        await import("./main");
        await vi.dynamicImportSettled();
      });

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(locale === "zh" ? "无法加载网站" : "Unable to load the portal");
      expect(alert).toHaveTextContent(locale === "zh" ? "请检查网络连接后重试" : "Check your connection and try again");
      expect(alert).not.toHaveTextContent(error.message);
      expect(document.documentElement).toHaveAttribute("lang", locale);
      expect(document.documentElement).toHaveAttribute("data-locale", locale);
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(document.documentElement).toHaveAttribute("data-motion", "full");
      expect(document.getElementById("splash")).toBeNull();
      expect(document.getElementById("root")?.style.opacity).toBe("1");

      const retry = screen.getByRole("button", { name: locale === "zh" ? "重试" : "Retry" });
      retry.focus();
      expect(retry).toHaveFocus();
      fireEvent.click(retry);
      expect(reload).toHaveBeenCalledOnce();
      expect(mocks.mountApp).toHaveBeenCalledTimes(failure === "module" ? 0 : 1);
    },
  );
});
