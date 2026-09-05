import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_OAUTH_SETTINGS,
  DEFAULT_SITE_STORAGE_POLICY,
  type MemberProfile,
  type PublicSiteConfig,
  type User,
} from "@guild/shared";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalSession } from "./session-transition";
import { deferred } from "./testing/deferred";

const mocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  requestSession: vi.fn(),
}));

vi.mock("./services/SiteConfigService", () => ({ fetchPublicSiteConfig: mocks.fetchConfig }));
vi.mock("./api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api/client")>(),
  apiRequest: mocks.requestSession,
}));
vi.mock("./router", () => ({ AppRouter: () => null }));
vi.mock("./providers/ThemeProvider", () => ({ PortalThemeProvider: () => null }));
vi.mock("./components/effects/ErrorBoundary", () => ({ ErrorBoundary: () => null }));

const siteConfig: PublicSiteConfig = {
  site_name: "Startup Guild",
  site_description: "Ready after all startup dependencies complete.",
  site_logo_media_id: null,
  default_site_logo_url: "/guild-logo.svg",
  features: { ...DEFAULT_FEATURE_FLAGS, events: false },
  oauth: DEFAULT_SITE_OAUTH_SETTINGS,
  media_policy: DEFAULT_SITE_MEDIA_POLICY,
  storage_policy: DEFAULT_SITE_STORAGE_POLICY,
  absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
};

const session: PortalSession = {
  user: { id: "user-1", display_name: "Member" } as User,
  profile: { user_id: "user-1" } as MemberProfile,
  session_scope: "normal",
};

describe("portal startup", () => {
  let language: ReturnType<typeof deferred<void>>;
  let config: ReturnType<typeof deferred<PublicSiteConfig>>;
  let identity: ReturnType<typeof deferred<PortalSession>>;
  let root: Root;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DEV", false);
    language = deferred<void>();
    config = deferred<PublicSiteConfig>();
    identity = deferred<PortalSession>();
    vi.doMock("./i18n", () => ({
      default: { t: () => "Loading…" },
      i18nReady: language.promise,
    }));
    mocks.fetchConfig.mockReset().mockReturnValue(config.promise);
    mocks.requestSession.mockReset().mockReturnValue(identity.promise);
    root = { render: vi.fn(), unmount: vi.fn() };
    localStorage.clear();
    document.documentElement.classList.remove("splash-done");
    document.body.innerHTML = '<div id="splash"><span id="splash-status"></span></div><div id="root"></div>';
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["authenticated", "anonymous", "password_change"] as const)(
    "loads startup dependencies concurrently and shares the %s session with route guards",
    async (kind) => {
      const { mountApp } = await import("./bootstrap");
      const { ApiRequestError } = await import("./api/client");
      const { useSiteConfigStore } = await import("./stores/site-config");
      const { useAuthStore } = await import("./stores/auth");
      const { createRouteSessionResolver } = await import("./router-session");
      const { getSessionSnapshot, resolveSessionSnapshot } = await import("./session-transition");
      const { queryClient } = await import("./api/query-client");
      const mounting = mountApp(root);

      expect(mocks.fetchConfig).toHaveBeenCalledOnce();
      expect(mocks.requestSession).toHaveBeenCalledExactlyOnceWith("/api/auth/me");
      expect(root.render).not.toHaveBeenCalled();
      config.resolve(siteConfig);
      if (kind === "anonymous") identity.reject(new ApiRequestError("No session", { status: 401 }));
      else identity.resolve({ ...session, session_scope: kind === "password_change" ? kind : "normal" });
      await Promise.allSettled([config.promise, identity.promise]);

      expect(root.render).not.toHaveBeenCalled();
      expect(useSiteConfigStore.getState().siteName).toBe("");
      expect(document.getElementById("splash")).not.toBeNull();
      language.resolve();
      await mounting;

      expect(root.render).toHaveBeenCalledOnce();
      expect(useSiteConfigStore.getState().siteName).toBe(siteConfig.site_name);
      expect(useSiteConfigStore.getState().features.events).toBe(false);
      expect(document.getElementById("splash")).toBeNull();
      expect(useAuthStore.getState().sessionResolved).toBe(true);
      expect(useAuthStore.getState().sessionScope).toBe(kind === "anonymous" ? null : kind === "password_change" ? kind : "normal");

      const resolver = createRouteSessionResolver({
        getCachedSession: getSessionSnapshot,
        requestSession: () => resolveSessionSnapshot(queryClient, undefined, { broadcast: false }),
        isSessionResolved: () => useAuthStore.getState().sessionResolved,
        markSessionResolved: () => useAuthStore.getState().markSessionResolved(),
      });
      await expect(Promise.all([resolver.resolve(), resolver.resolve()])).resolves.toEqual([
        getSessionSnapshot(), getSessionSnapshot(),
      ]);
      expect(mocks.requestSession).toHaveBeenCalledOnce();
      expect(localStorage.getItem("portal:auth-session-transition")).toBeNull();
    },
  );

  it.each(["language", "config", "session"] as const)(
    "does not mount or apply config after a %s failure, including late successful dependencies",
    async (failedDependency) => {
      const { mountApp } = await import("./bootstrap");
      const { useSiteConfigStore } = await import("./stores/site-config");
      const { useAuthStore } = await import("./stores/auth");
      const error = new Error(`${failedDependency} unavailable`);
      const mounting = mountApp(root);
      const failed = expect(mounting).rejects.toBe(error);

      if (failedDependency === "language") language.reject(error);
      else if (failedDependency === "config") config.reject(error);
      else identity.reject(error);
      await failed;

      if (failedDependency !== "language") language.resolve();
      if (failedDependency !== "config") config.resolve(siteConfig);
      if (failedDependency !== "session") identity.resolve(session);
      await Promise.allSettled([language.promise, config.promise, identity.promise]);

      expect(root.render).not.toHaveBeenCalled();
      expect(useSiteConfigStore.getState().siteName).toBe("");
      expect(document.getElementById("splash")).not.toBeNull();
      if (failedDependency === "session") expect(useAuthStore.getState().sessionResolved).toBe(false);
    },
  );
});
