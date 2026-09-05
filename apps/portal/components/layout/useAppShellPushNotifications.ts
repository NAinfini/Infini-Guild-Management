import type { PushMessage } from "@guild/shared";
import type { PushEntityType } from "@guild/shared/constants/push-hints";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { queryKeys } from "../../api/query-keys";
import { usePushSync } from "../../hooks/usePushSync";
import { fetchPublicSiteConfig } from "../../services/SiteConfigService";
import { applyPublicSiteConfig } from "../../stores/site-config";
import { useAuthStore } from "../../stores/auth";

const ENTITY_QUERY_KEYS = {
  announcement: [queryKeys.announcements.all, queryKeys.dashboard.latestAnnouncement()],
  event: [queryKeys.events.all, queryKeys.dashboard.all, queryKeys.guildWar.events()],
  wiki: [queryKeys.wiki.all],
  gallery: [queryKeys.gallery.all],
  storage: [queryKeys.storage.all],
  guild_war: [queryKeys.guildWar.all],
  member_profile: [queryKeys.users.all, queryKeys.myProfile.all],
  member_badge: [queryKeys.users.all, queryKeys.myProfile.all],
  site_config: [queryKeys.siteConfig.all],
} satisfies Record<PushEntityType, readonly (readonly string[])[]>;

const PUSH_INVALIDATION_WINDOW_MS = 300;
const PUSH_RECOVERY_QUERY_KEYS = [
  queryKeys.cmdk.all,
  queryKeys.notifications.all,
  queryKeys.importantNotices.all,
  ...ENTITY_QUERY_KEYS.announcement,
  ...ENTITY_QUERY_KEYS.event,
  ...ENTITY_QUERY_KEYS.wiki,
  ...ENTITY_QUERY_KEYS.gallery,
  ...ENTITY_QUERY_KEYS.storage,
  ...ENTITY_QUERY_KEYS.guild_war,
  ...ENTITY_QUERY_KEYS.member_profile,
  ...ENTITY_QUERY_KEYS.member_badge,
  ...ENTITY_QUERY_KEYS.site_config,
];

type UseAppShellPushNotificationsOptions = {
  queryClient: QueryClient;
  enabled: boolean;
  onUnauthorized: () => void;
};

export function useAppShellPushNotifications({
  queryClient,
  enabled,
  onUnauthorized,
}: UseAppShellPushNotificationsOptions) {
  const sessionKey = useAuthStore((state) => state.sessionKey);
  const activeRef = useRef(enabled);
  const pendingInvalidationsRef = useRef(new Map<string, readonly unknown[]>());
  const pendingSiteConfigRefreshRef = useRef(false);
  const invalidationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = enabled;
    const pending = pendingInvalidationsRef.current;
    return () => {
      activeRef.current = false;
      if (invalidationTimerRef.current !== null) window.clearTimeout(invalidationTimerRef.current);
      invalidationTimerRef.current = null;
      pending.clear();
      pendingSiteConfigRefreshRef.current = false;
    };
  }, [enabled, sessionKey]);

  const isCurrentSession = useCallback(
    () => activeRef.current && useAuthStore.getState().sessionKey === sessionKey,
    [sessionKey],
  );

  const queueInvalidations = useCallback(
    (keys: readonly (readonly unknown[])[]) => {
      if (!isCurrentSession()) return;
      for (const key of keys) pendingInvalidationsRef.current.set(JSON.stringify(key), key);
      invalidationTimerRef.current ??= window.setTimeout(() => {
        if (!isCurrentSession()) return;
        invalidationTimerRef.current = null;
        const pending = [...pendingInvalidationsRef.current.values()];
        pendingInvalidationsRef.current.clear();
        for (const queryKey of pending) void queryClient.invalidateQueries({ queryKey });
        if (pendingSiteConfigRefreshRef.current) {
          pendingSiteConfigRefreshRef.current = false;
          void fetchPublicSiteConfig()
            .then((config) => {
              if (isCurrentSession()) applyPublicSiteConfig(config);
            })
            .catch((error: unknown) => {
              if (!isCurrentSession()) return;
              console.error("[site-config] push refresh failed", error);
            });
        }
      }, PUSH_INVALIDATION_WINDOW_MS);
    },
    [isCurrentSession, queryClient],
  );

  const handlePushMessage = useCallback(
    (message: PushMessage) => {
      if (!isCurrentSession()) return;
      if (message.type === "entity_changed") {
        if (message.entity_type === "site_config") pendingSiteConfigRefreshRef.current = true;
        queueInvalidations([queryKeys.cmdk.all, ...(ENTITY_QUERY_KEYS[message.entity_type] ?? [])]);
      }
      if (message.type === "announcement_published") {
        queueInvalidations(ENTITY_QUERY_KEYS.announcement);
      }
      if (message.type === "inbox_changed") {
        queueInvalidations([queryKeys.notifications.all, queryKeys.importantNotices.all]);
      }
    },
    [isCurrentSession, queueInvalidations],
  );

  const refreshAfterPushConnection = useCallback(() => {
    if (!isCurrentSession()) return;
    pendingSiteConfigRefreshRef.current = true;
    queueInvalidations(PUSH_RECOVERY_QUERY_KEYS);
  }, [isCurrentSession, queueInvalidations]);

  useEffect(() => {
    if (!enabled) return;
    // Push is best effort. Returning to the page is a server-state refresh
    // boundary even when the socket never disconnected after a missed hint.
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshAfterPushConnection();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [enabled, refreshAfterPushConnection]);

  const handleNotificationUnauthorized = useCallback(() => {
    if (!isCurrentSession()) return;
    onUnauthorized();
  }, [isCurrentSession, onUnauthorized]);

  usePushSync({
    enabled,
    onMessage: handlePushMessage,
    onRefresh: refreshAfterPushConnection,
    onUnauthorized: handleNotificationUnauthorized,
  });
}
