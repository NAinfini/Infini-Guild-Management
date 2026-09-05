import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_OAUTH_SETTINGS,
  DEFAULT_SITE_STORAGE_POLICY,
  type PublicSiteConfig,
  type PushMessage,
  type MemberProfile,
  type User,
} from "@guild/shared";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSiteConfigStore } from "../../stores/site-config";
import { useAppShellPushNotifications } from "./useAppShellPushNotifications";
import { useAuthStore } from "../../stores/auth";
import { transitionSession } from "../../session-transition";
import { deferred } from "../../testing/deferred";

const pushSyncState = vi.hoisted(() => ({ options: null as unknown }));
const fetchSiteConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/usePushSync", () => ({
  usePushSync: (options: unknown) => {
    pushSyncState.options = options;
  },
}));

vi.mock("../../services/SiteConfigService", () => ({
  fetchPublicSiteConfig: fetchSiteConfigMock,
}));

const refreshedConfig: PublicSiteConfig = {
  site_name: "Infini Prime",
  site_description: "Updated from another client",
  site_logo_media_id: null,
  default_site_logo_url: "/prime-logo.svg",
  features: { ...DEFAULT_FEATURE_FLAGS, wiki: false },
  oauth: DEFAULT_SITE_OAUTH_SETTINGS,
  media_policy: DEFAULT_SITE_MEDIA_POLICY,
  storage_policy: DEFAULT_SITE_STORAGE_POLICY,
  absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
};

describe("useAppShellPushNotifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushSyncState.options = null;
    fetchSiteConfigMock.mockReset();
    fetchSiteConfigMock.mockResolvedValue(refreshedConfig);
    useAuthStore.getState().setSession({ id: "user-a" } as User, { user_id: "user-a" } as MemberProfile, "normal");
    useSiteConfigStore.setState({
      siteName: "Old guild",
      siteDescription: "Old description",
      siteLogoUrl: "/old.svg",
      mediaPolicy: DEFAULT_SITE_MEDIA_POLICY,
      oauth: DEFAULT_SITE_OAUTH_SETTINGS,
      features: { ...DEFAULT_FEATURE_FLAGS },
    });
    document.head.innerHTML = '<link rel="icon" href="/old.svg">';
    document.title = "Site Config · Old guild";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshes on a visible return after a missed hint and removes resume listeners on unmount", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { unmount } = renderHook(() => useAppShellPushNotifications({
      queryClient, enabled: true, onUnauthorized: vi.fn(),
    }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(invalidate).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(fetchSiteConfigMock).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["announcements"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"] });
    unmount();
    invalidate.mockClear();
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refreshes the public runtime config after a site-config push", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { unmount } = renderHook(() => useAppShellPushNotifications({
      queryClient,
      enabled: true,
      onUnauthorized: vi.fn(),
    }));
    const callbacks = pushSyncState.options as {
      onMessage: (message: PushMessage) => void;
    };

    act(() => callbacks.onMessage({
      type: "entity_changed",
      entity_type: "site_config",
      entity_id: "site",
      updated_at: "2026-08-26T12:00:00.000Z",
      hint: "site_config_updated",
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchSiteConfigMock).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalled();
    expect(useSiteConfigStore.getState()).toMatchObject({
      siteName: "Infini Prime",
      siteDescription: "Updated from another client",
      siteLogoUrl: "/prime-logo.svg",
      features: expect.objectContaining({ wiki: false }),
    });
    expect(document.title).toBe("Site Config · Old guild");
    expect(document.querySelector<HTMLLinkElement>("link[rel='icon']")?.href).toContain("/prime-logo.svg");

    unmount();
  });

  it("coalesces recovery and push keys into targeted invalidations", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const onUnauthorized = vi.fn();
    const { unmount } = renderHook(() => useAppShellPushNotifications({
      queryClient,
      enabled: true,
      onUnauthorized,
    }));
    const callbacks = pushSyncState.options as {
      onMessage: (message: PushMessage) => void;
      onRefresh: () => void;
      onUnauthorized: () => void;
    };

    act(() => {
      callbacks.onRefresh();
      callbacks.onMessage({
        type: "entity_changed",
        entity_type: "announcement",
        entity_id: "announcement-1",
        updated_at: "2026-08-26T12:00:00.000Z",
        hint: "announcement_updated",
      });
      callbacks.onMessage({
        type: "entity_changed",
        entity_type: "announcement",
        entity_id: "announcement-2",
        updated_at: "2026-08-26T12:00:01.000Z",
        hint: "announcement_updated",
      });
      callbacks.onUnauthorized();
    });

    expect(onUnauthorized).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications"] });
    expect(invalidate.mock.calls.filter(([options]) =>
      JSON.stringify((options as { queryKey?: unknown })?.queryKey) === JSON.stringify(["announcements"]),
    )).toHaveLength(1);
    expect(invalidate.mock.calls.every(([options]) =>
      Array.isArray((options as { queryKey?: unknown })?.queryKey),
    )).toBe(true);

    unmount();
  });

  it("drops old subscription timers and callbacks when the identity changes", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const onUnauthorized = vi.fn();
    const { unmount } = renderHook(() => useAppShellPushNotifications({ queryClient, enabled: true, onUnauthorized }));
    const oldCallbacks = pushSyncState.options as {
      onMessage: (message: PushMessage) => void;
      onRefresh: () => void;
      onUnauthorized: () => void;
    };
    act(() => oldCallbacks.onRefresh());
    act(() => transitionSession(queryClient, {
      user: { id: "user-b" } as User,
      profile: { user_id: "user-b" } as MemberProfile,
      session_scope: "normal",
    }, { broadcast: false }));
    act(() => {
      oldCallbacks.onRefresh();
      oldCallbacks.onUnauthorized();
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(fetchSiteConfigMock).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
    const currentCallbacks = pushSyncState.options as typeof oldCallbacks;
    act(() => currentCallbacks.onRefresh());
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(fetchSiteConfigMock).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalled();
    unmount();
  });

  it("ignores a config response started by the old subscription", async () => {
    const queryClient = new QueryClient();
    const pending = deferred<PublicSiteConfig>();
    fetchSiteConfigMock.mockReturnValueOnce(pending.promise);
    const { unmount } = renderHook(() => useAppShellPushNotifications({ queryClient, enabled: true, onUnauthorized: vi.fn() }));
    const oldCallbacks = pushSyncState.options as { onRefresh: () => void };
    act(() => oldCallbacks.onRefresh());
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(fetchSiteConfigMock).toHaveBeenCalledOnce();
    act(() => transitionSession(queryClient, null, { broadcast: false }));
    await act(async () => {
      pending.resolve(refreshedConfig);
      await pending.promise;
    });
    expect(useSiteConfigStore.getState().siteName).toBe("Old guild");
    unmount();
  });
});
