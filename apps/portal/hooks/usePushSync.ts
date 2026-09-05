import type { HeartbeatMessage, PushMessage } from "@guild/shared";
import { pushMessageSchema } from "@guild/shared";
import { nanoid } from "nanoid";
import { useEffect, useRef } from "react";
import { useAuthStore } from "../stores/auth";
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
  const sessionKey = useAuthStore((state) => state.sessionKey);
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
    const isCurrentSession = () => !isCleaningUp && useAuthStore.getState().sessionKey === sessionKey;
    let socket: WebSocket | null = null;
    let reconnectTimeoutId: number | null = null;
    let fallbackPollId: number | null = null;
    let heartbeatTimerId: number | null = null;
    let retryCount = 0;
    let heartbeatSeq = 0;
    let hasConnected = false;
    const tabId = nanoid(12);

    const startFallbackPolling = (immediate: boolean) => {
      if (!isCurrentSession() || fallbackPollId != null) {
        return;
      }
      if (immediate) onRefreshRef.current?.();
      fallbackPollId = window.setInterval(() => {
        if (isCurrentSession()) onRefreshRef.current?.();
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
        if (!isCurrentSession() || ws.readyState !== WebSocket.OPEN) {
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
      if (!isCurrentSession() || socket !== null) {
        return;
      }

      const wsBase = window.location.origin;
      const connectedSocket = new WebSocket(`${wsBase.replace("http", "ws")}/ws`);
      socket = connectedSocket;

      connectedSocket.onopen = () => {
        if (!isCurrentSession() || socket !== connectedSocket) return;
        retryCount = 0;
        stopFallbackPolling();
        if (hasConnected) {
          onRefreshRef.current?.();
        }
        hasConnected = true;
        startHeartbeat(connectedSocket);
      };

      connectedSocket.onmessage = (event) => {
        if (!isCurrentSession() || socket !== connectedSocket) return;
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

      connectedSocket.onclose = (event) => {
        if (!isCurrentSession() || socket !== connectedSocket) return;
        stopHeartbeat();
        socket = null;
        if (event.code === WS_CLOSE_UNAUTHORIZED) {
          stopFallbackPolling();
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

      connectedSocket.onerror = () => {
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
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      socket = null;
    };
  }, [enabled, sessionKey]);
}
