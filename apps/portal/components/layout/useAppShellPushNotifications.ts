import type { PushMessage } from "@guild/shared";
import type { PushEntityType } from "@guild/shared/constants/push-hints";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { queryKeys } from "../../api/query-keys";
import { usePushSync } from "../../hooks/usePushSync";
import { fetchPublicSiteConfig } from "../../services/SiteConfigService";
import { applyPublicSiteConfig } from "../../stores/site-config";

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
  const pendingInvalidationsRef = useRef(new Map<string, readonly unknown[]>());
  const pendingSiteConfigRefreshRef = useRef(false);
  const invalidationTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (invalidationTimerRef.current !== null) window.clearTimeout(invalidationTimerRef.current);
  }, []);

  const queueInvalidations = useCallback(
    (keys: readonly (readonly unknown[])[]) => {
      for (const key of keys) pendingInvalidationsRef.current.set(JSON.stringify(key), key);
      invalidationTimerRef.current ??= window.setTimeout(() => {
        invalidationTimerRef.current = null;
        const pending = [...pendingInvalidationsRef.current.values()];
        pendingInvalidationsRef.current.clear();
        for (const queryKey of pending) void queryClient.invalidateQueries({ queryKey });
        if (pendingSiteConfigRefreshRef.current) {
          pendingSiteConfigRefreshRef.current = false;
          void fetchPublicSiteConfig()
            .then(applyPublicSiteConfig)
            .catch((error: unknown) => {
              console.error("[site-config] push refresh failed", error);
            });
        }
      }, PUSH_INVALIDATION_WINDOW_MS);
    },
    [queryClient],
  );

  const handlePushMessage = useCallback(
    (message: PushMessage) => {
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
    [queueInvalidations],
  );

  const refreshAfterPushConnection = useCallback(() => {
    pendingSiteConfigRefreshRef.current = true;
    queueInvalidations(PUSH_RECOVERY_QUERY_KEYS);
  }, [queueInvalidations]);

  const handleNotificationUnauthorized = useCallback(() => {
    onUnauthorized();
  }, [onUnauthorized]);

  usePushSync({
    enabled,
    onMessage: handlePushMessage,
    onRefresh: refreshAfterPushConnection,
    onUnauthorized: handleNotificationUnauthorized,
  });
}
