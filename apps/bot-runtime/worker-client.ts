import { createHmac } from "node:crypto";
import type { BotRuntimeConfig } from "./config";

function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type WorkerClient = ReturnType<typeof createWorkerClient>;

export function createWorkerClient(config: BotRuntimeConfig) {
  async function request<TResponse>(
    path: string,
    method: "GET" | "POST" | "PATCH",
    payload?: Record<string, unknown>,
  ): Promise<TResponse> {
    const query =
      method === "GET" && payload
        ? `?${new URLSearchParams(
            Object.entries(payload)
              .filter(([, value]) => value !== undefined && value !== null)
              .map(([key, value]) => [key, String(value)]),
          ).toString()}`
        : "";
    const body = method === "GET" ? "" : JSON.stringify(payload ?? {});
    const timestamp = Date.now().toString();
    const signaturePayload = `${timestamp}.${body}`;

    const response = await fetch(`${config.workerApiBaseUrl}${path}${query}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Signature": signPayload(signaturePayload, config.workerSharedSecret),
      },
      ...(method === "GET" ? {} : { body }),
    });

    if (!response.ok) {
      throw new Error(`Worker request failed: ${response.status} ${path}`);
    }

    if (response.status === 204) {
      return {} as TResponse;
    }

    return (await response.json()) as TResponse;
  }

  return {
    signup: (payload: { event_id: string; user_id?: string; discord_id?: string; source?: "discord" | "wechat" }) =>
      request<{ ok: true; event_id: string; user_id: string }>("/internal/bot/signup", "POST", payload),
    leave: (payload: { event_id: string; user_id?: string; discord_id?: string; source?: "discord" | "wechat" }) =>
      request<{ ok: true; event_id: string; user_id: string }>("/internal/bot/leave", "POST", payload),
    linkStart: (payload: { username: string; discord_id: string }) =>
      request<{ code: string; expires_at: string; user_id: string }>("/internal/bot/link/start", "POST", payload),
    linkVerify: (payload: { code: string; discord_id: string }) =>
      request<{ ok: true; user_id: string; discord_id: string }>("/internal/bot/link/verify", "POST", payload),
    taskStatus: (taskId: string, payload: { status: "queued" | "sending" | "sent" | "failed"; error?: string; message_id?: string }) =>
      request<{ ok: true }>(`/internal/bot/tasks/${taskId}/status`, "PATCH", payload),
    events: () =>
      request<{
        data: Array<{ id: string; title: string; type: string; start_at: string; capacity: number | null }>;
      }>("/internal/bot/events", "GET"),
    teams: () =>
      request<{
        war: { id: string; war_name: string; created_at: string } | null;
        teams: Array<{
          id: string;
          team_name: string;
          notes: string | null;
          is_locked: boolean;
          members: Array<{
            user_id: string;
            username: string;
            wechat_name: string | null;
            power: number;
            class_name: string | null;
            role_tag: string | null;
          }>;
        }>;
      }>("/internal/bot/teams", "GET"),
    roster: () =>
      request<{
        data: Array<{
          user_id: string;
          username: string;
          wechat_name: string | null;
          power: number;
          class_name: string | null;
        }>;
      }>("/internal/bot/roster", "GET"),
    stats: (payload: { member?: string; discord_id?: string }) =>
      request<{
        member: { user_id: string; username: string };
        wars: Array<{
          war_id: string;
          war_name: string;
          created_at: string;
          damage: number | null;
          healing: number | null;
          building_damage: number | null;
          kills: number | null;
          deaths: number | null;
          assists: number | null;
          credits: number | null;
        }>;
      }>("/internal/bot/stats", "GET", payload),
    reminders: (payload: { mode: "on" | "off"; discord_id: string }) =>
      request<{ ok: true; mode: "on" | "off" }>("/internal/bot/reminders", "POST", payload),
  };
}
