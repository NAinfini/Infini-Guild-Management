import type {
  Announcement,
  HeartbeatMessage,
  MemberProfile,
  PaginatedResponse,
  PushMessage,
  User,
} from "@guild/shared";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef } from "react";
import { apiRequest } from "../api/client";
import { useNotificationStore } from "../stores/notifications";
import { isIsoDate, toIsoOrNow } from "../utils/datetime";

type UseNotificationSyncOptions = {
  enabled?: boolean;
  onMessage?: (message: PushMessage) => void;
  onConnected?: () => void;
  onUnauthorized?: () => void;
};

const FALLBACK_POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const reconnectDelays = [1000, 10_000, 30_000, 60_000];
const MAX_RETRIES = 10;
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_UNAUTHORIZED = 4401;

type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile }>;

function getLatestIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value || !isIsoDate(value)) {
      continue;
    }
    const timestamp = Date.parse(value);
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latest = value;
    }
  }
  return latest;
}

export function useNotificationSync(options: UseNotificationSyncOptions = {}) {
  const enabled = options.enabled ?? true;
  const appendPushMessage = useNotificationStore((state) => state.appendPushMessage);
  const setFeatureLatest = useNotificationStore((state) => state.setFeatureLatest);
  const setFeatureLatestBatch = useNotificationStore((state) => state.setFeatureLatestBatch);
  const setSyncing = useNotificationStore((state) => state.setSyncing);
  const setLastSyncedAt = useNotificationStore((state) => state.setLastSyncedAt);
  const setWsConnected = useNotificationStore((state) => state.setWsConnected);
  const onMessageRef = useRef<((message: PushMessage) => void) | undefined>(options.onMessage);
  const onConnectedRef = useRef<(() => void) | undefined>(options.onConnected);
  const onUnauthorizedRef = useRef<(() => void) | undefined>(options.onUnauthorized);
  const wsConnectedRef = useRef(false);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
    onConnectedRef.current = options.onConnected;
    onUnauthorizedRef.current = options.onUnauthorized;
  }, [options.onConnected, options.onMessage, options.onUnauthorized]);

  const syncFeatureNotifications = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setSyncing(true);
    try {
      const [announcementsResponse, usersResponse] = await Promise.all([
        apiRequest<PaginatedResponse<Announcement>>("/api/announcements?page=1&limit=30&archived=false"),
        apiRequest<UsersListResponse>("/api/users?page=1&limit=100&include_total=false"),
      ]);

      const latestAnnouncements = getLatestIso(announcementsResponse.data.map((item) => item.updated_at));
      const latestMembers = getLatestIso(
        usersResponse.data.flatMap((row) => [row.user.updated_at, row.profile.updated_at]),
      );

      setFeatureLatestBatch({
        announcements: latestAnnouncements,
        members: latestMembers,
      });
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      /*
       * Every call site is fire-and-forget (`void`), so a rejection here — a 429
       * from the rate limiter, an offline tab, a worker restart — escaped as an
       * unhandled rejection and surfaced as a page-level error. Notification
       * timestamps are advisory, so the sync may fail; the failure must stay
       * visible in the console rather than take down the page.
       */
      console.error("[notification-sync] feature timestamp sync failed", error);
    } finally {
      setSyncing(false);
    }
  }, [enabled, setFeatureLatestBatch, setLastSyncedAt, setSyncing]);

  // Initial sync on mount only — ongoing updates come from WebSocket push
  useEffect(() => {
    if (!enabled) {
      return;
    }
    void syncFeatureNotifications();
  }, [enabled, syncFeatureNotifications]);

  useEffect(() => {
    if (!enabled) {
      setWsConnected(false);
      return;
    }

    let isCleaningUp = false;
    let socket: WebSocket | null = null;
    let reconnectTimeoutId: number | null = null;
    let fallbackPollId: number | null = null;
    let heartbeatTimerId: number | null = null;
    let retryCount = 0;
    let heartbeatSeq = 0;
    const tabId = nanoid(12);

    const emitFallbackSignal = () => {
      onMessageRef.current?.({
        type: "entity_changed",
        entity_type: "event",
        entity_id: "poll",
        updated_at: new Date().toISOString(),
        hint: "poll_fallback",
      });
    };

    const startFallbackPolling = () => {
      if (fallbackPollId != null) {
        return;
      }
      // When WS is down, poll feature timestamps as fallback
      void syncFeatureNotifications();
      fallbackPollId = window.setInterval(() => {
        emitFallbackSignal();
        void syncFeatureNotifications();
      }, FALLBACK_POLL_INTERVAL_MS);
    };

    const stopFallbackPolling = () => {
      if (fallbackPollId == null) {
        return;
      }
      window.clearInterval(fallbackPollId);
      fallbackPollId = null;
    };

    const stopHeartbeat = () => {
      if (heartbeatTimerId == null) {
        return;
      }
      window.clearInterval(heartbeatTimerId);
      heartbeatTimerId = null;
    };

    const startHeartbeat = (ws: WebSocket) => {
      stopHeartbeat();
      heartbeatTimerId = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          stopHeartbeat();
          return;
        }
        heartbeatSeq += 1;
        const beat: HeartbeatMessage = {
          type: "heartbeat",
          tab_id: tabId,
          seq: heartbeatSeq,
          sent_at: new Date().toISOString(),
        };
        ws.send(JSON.stringify(beat));
      }, HEARTBEAT_INTERVAL_MS);
    };

    const connect = () => {
      if (isCleaningUp || socket !== null) {
        return;
      }

      const wsBase = window.location.origin;
      socket = new WebSocket(`${wsBase.replace("http", "ws")}/ws`);

      socket.onopen = () => {
        retryCount = 0;
        stopFallbackPolling();
        wsConnectedRef.current = true;
        setWsConnected(true);
        onConnectedRef.current?.();
        if (socket) {
          startHeartbeat(socket);
        }
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as PushMessage;

          if (message.type === "heartbeat_ack") {
            return;
          }

          if (useNotificationStore.getState().suppressed) {
            return;
          }

          appendPushMessage(message);

          if (message.type === "announcement_published") {
            setFeatureLatest("announcements", toIsoOrNow(message.published_at));
          }

          if (message.type === "entity_changed") {
            const updatedAt = toIsoOrNow(message.updated_at);
            if (message.entity_type === "announcement") {
              setFeatureLatest("announcements", updatedAt);
            } else if (message.entity_type === "member_profile") {
              setFeatureLatest("members", updatedAt);
            }
          }

          onMessageRef.current?.(message);
        } catch {
          // Ignore invalid push payloads.
        }
      };

      socket.onclose = (event) => {
        wsConnectedRef.current = false;
        setWsConnected(false);
        stopHeartbeat();
        socket = null;
        if (isCleaningUp) {
          return;
        }
        if (event.code === WS_CLOSE_UNAUTHORIZED) {
          console.warn(`[useNotificationSync] WebSocket closed with auth error (code ${event.code}). Stopping reconnect.`);
          onUnauthorizedRef.current?.();
          return;
        }
        if (event.code === WS_CLOSE_POLICY_VIOLATION) {
          console.warn(`[useNotificationSync] WebSocket closed with auth error (code ${event.code}). Stopping reconnect.`);
          startFallbackPolling();
          return;
        }
        if (retryCount >= MAX_RETRIES) {
          console.warn(`[useNotificationSync] WebSocket max retries (${MAX_RETRIES}) reached. Stopping reconnect.`);
          startFallbackPolling();
          return;
        }
        startFallbackPolling();
        const delay = reconnectDelays[Math.min(retryCount, reconnectDelays.length - 1)];
        retryCount += 1;
        reconnectTimeoutId = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        // onclose handles retry behavior
      };
    };

    connect();

    return () => {
      isCleaningUp = true;
      wsConnectedRef.current = false;
      setWsConnected(false);
      stopFallbackPolling();
      stopHeartbeat();
      if (reconnectTimeoutId != null) {
        window.clearTimeout(reconnectTimeoutId);
      }
      socket?.close();
      socket = null;
    };
  }, [appendPushMessage, enabled, setFeatureLatest, setWsConnected, syncFeatureNotifications]);

  return {
    sync: syncFeatureNotifications,
  };
}
