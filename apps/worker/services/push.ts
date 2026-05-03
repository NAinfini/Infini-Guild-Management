import type { PushMessage } from "@guild/shared";
import type { Context } from "hono";
import type { Bindings } from "../index";

async function publishPushMessage(env: Bindings, message: PushMessage): Promise<void> {
  try {
    const objectId = env.WS.idFromName("global");
    const stub = env.WS.get(objectId);
    await stub.fetch("https://ws.internal/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch (err) {
    console.error("[push] publishPushMessage failed:", message.type, err);
  }
}

function resolveEnvAndCtx(source: Context | Bindings): { env: Bindings; waitUntil?: (p: Promise<unknown>) => void } {
  if ("env" in source && "executionCtx" in source) {
    const c = source as Context;
    return { env: c.env as Bindings, waitUntil: (p) => c.executionCtx.waitUntil(p) };
  }
  return { env: source as Bindings };
}

export function publishEntityChanged(
  source: Context | Bindings,
  payload: { entityType: string; entityId: string; hint: string },
): Promise<void> {
  const { env, waitUntil } = resolveEnvAndCtx(source);
  const task = publishPushMessage(env, {
    type: "entity_changed",
    entity_type: payload.entityType,
    entity_id: payload.entityId,
    updated_at: new Date().toISOString(),
    hint: payload.hint,
  });
  waitUntil?.(task);
  return task;
}

export function publishAnnouncementPublished(
  source: Context | Bindings,
  payload: { announcementId: string; title: string; publishedAt?: string },
): Promise<void> {
  const { env, waitUntil } = resolveEnvAndCtx(source);
  const task = publishPushMessage(env, {
    type: "announcement_published",
    announcement_id: payload.announcementId,
    title: payload.title,
    published_at: payload.publishedAt ?? new Date().toISOString(),
  });
  waitUntil?.(task);
  return task;
}
