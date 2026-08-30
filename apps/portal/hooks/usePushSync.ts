import type { HeartbeatMessage, PushMessage } from "@guild/shared";
import { pushMessageSchema } from "@guild/shared";
import { nanoid } from "nanoid";
import { useEffect, useRef } from "react";
import { usePushSyncStore } from "../stores/push-sync";

type UsePushSyncOptions = {
  enabled?: boolean;
  onMessage?: (message: PushMessage) => void;
  onRefresh?: () => void;
  onUnauthorized?: () => void;
};

const FALLBACK_POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const reconnectDelays = [1000, 10_000, 30_000, 60_000];
const MAX_RETRIES = 10;
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_UNAUTHORIZED = 4401;

export function usePushSync(options: UsePushSyncOptions = {}) {
  const enabled = options.enabled ?? true;
  const onMessageRef = useRef<((message: PushMessage) => void) | undefined>(options.onMessage);
  const onRefreshRef = useRef<(() => void) | undefined>(options.onRefresh);
  const onUnauthorizedRef = useRef<(() => void) | undefined>(options.onUnauthorized);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
    onRefreshRef.current = options.onRefresh;
    onUnauthorizedRef.current = options.onUnauthorized;
  }, [options.onMessage, options.onRefresh, options.onUnauthorized]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isCleaningUp = false;
    let socket: WebSocket | null = null;
    let reconnectTimeoutId: number | null = null;
    let fallbackPollId: number | null = null;
    let heartbeatTimerId: number | null = null;
    let retryCount = 0;
    let heartbeatSeq = 0;
    let hasConnected = false;
    const tabId = nanoid(12);

    const startFallbackPolling = (immediate: boolean) => {
      if (fallbackPollId != null) {
        return;
      }
      if (immediate) onRefreshRef.current?.();
      fallbackPollId = window.setInterval(() => {
        onRefreshRef.current?.();
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
        if (hasConnected) {
          onRefreshRef.current?.();
        }
        hasConnected = true;
        if (socket) {
          startHeartbeat(socket);
        }
      };

      socket.onmessage = (event) => {
        try {
          const parsed = pushMessageSchema.safeParse(JSON.parse(event.data));
          if (!parsed.success) return;
          const message = parsed.data;

          if (message.type === "heartbeat_ack") {
            return;
          }

          if (usePushSyncStore.getState().suppressed) {
            return;
          }

          onMessageRef.current?.(message);
        } catch {
          // Ignore invalid push payloads.
        }
      };

      socket.onclose = (event) => {
        stopHeartbeat();
        socket = null;
        if (isCleaningUp) {
          return;
        }
        if (event.code === WS_CLOSE_UNAUTHORIZED) {
          console.warn(`[usePushSync] WebSocket closed with auth error (code ${event.code}). Stopping reconnect.`);
          onUnauthorizedRef.current?.();
          return;
        }
        if (event.code === WS_CLOSE_POLICY_VIOLATION) {
          console.warn(`[usePushSync] WebSocket closed by server policy (code ${event.code}). Stopping reconnect.`);
          startFallbackPolling(true);
          return;
        }
        if (retryCount >= MAX_RETRIES) {
          console.warn(`[usePushSync] WebSocket max retries (${MAX_RETRIES}) reached. Stopping reconnect.`);
          startFallbackPolling(true);
          return;
        }
        startFallbackPolling(false);
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
      stopFallbackPolling();
      stopHeartbeat();
      if (reconnectTimeoutId != null) {
        window.clearTimeout(reconnectTimeoutId);
      }
      socket?.close();
      socket = null;
    };
  }, [enabled]);
}
