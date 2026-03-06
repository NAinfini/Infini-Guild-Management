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

type UseNotificationSyncOptions = {
  enabled?: boolean;
  pollIntervalMs?: number;
  onMessage?: (message: PushMessage) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const FALLBACK_POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const reconnectDelays = [1000, 10_000, 30_000, 60_000];

type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile }>;

function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

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

function toIsoOrNow(value: string | undefined): string {
  if (value && isIsoDate(value)) {
    return value;
  }
  return new Date().toISOString();
}

export function useNotificationSync(options: UseNotificationSyncOptions = {}) {
  const enabled = options.enabled ?? true;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const appendPushMessage = useNotificationStore((state) => state.appendPushMessage);
  const setFeatureLatest = useNotificationStore((state) => state.setFeatureLatest);
  const setFeatureLatestBatch = useNotificationStore((state) => state.setFeatureLatestBatch);
  const setSyncing = useNotificationStore((state) => state.setSyncing);
  const setLastSyncedAt = useNotificationStore((state) => state.setLastSyncedAt);
  const setWsConnected = useNotificationStore((state) => state.setWsConnected);
  const onMessageRef = useRef<((message: PushMessage) => void) | undefined>(options.onMessage);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
  }, [options.onMessage]);

  const syncFeatureNotifications = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setSyncing(true);
    try {
      const [announcementsResponse, usersResponse] = await Promise.all([
        apiRequest<PaginatedResponse<Announcement>>("/api/announcements?page=1&limit=30&archived=false"),
        apiRequest<UsersListResponse>("/api/users?page=1&limit=100"),
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
    } finally {
      setSyncing(false);
    }
  }, [enabled, setFeatureLatestBatch, setLastSyncedAt, setSyncing]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void syncFeatureNotifications();
    const timerId = window.setInterval(() => {
      void syncFeatureNotifications();
    }, pollIntervalMs);
    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, pollIntervalMs, syncFeatureNotifications]);

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
      fallbackPollId = window.setInterval(emitFallbackSignal, FALLBACK_POLL_INTERVAL_MS);
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
      if (isCleaningUp) {
        return;
      }

      socket = new WebSocket(`${window.location.origin.replace("http", "ws")}/ws`);

      socket.onopen = () => {
        retryCount = 0;
        stopFallbackPolling();
        setWsConnected(true);
        if (socket) {
          startHeartbeat(socket);
        }
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as PushMessage;

          // heartbeat_ack is handled silently — no need to propagate
          if (message.type === "heartbeat_ack") {
            return;
          }

          appendPushMessage(message);

          if (message.type === "announcement_published") {
            setFeatureLatest("announcements", toIsoOrNow(message.published_at));
          }

          onMessageRef.current?.(message);
        } catch {
          // Ignore invalid push payloads.
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        stopHeartbeat();
        if (isCleaningUp) {
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
      setWsConnected(false);
      stopFallbackPolling();
      stopHeartbeat();
      if (reconnectTimeoutId != null) {
        window.clearTimeout(reconnectTimeoutId);
      }
      socket?.close();
      socket = null;
    };
  }, [appendPushMessage, enabled, setFeatureLatest, setWsConnected]);

  return {
    sync: syncFeatureNotifications,
  };
}
