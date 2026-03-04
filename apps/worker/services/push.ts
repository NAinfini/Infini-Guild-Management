import type { PushMessage } from "@guild/shared";
import type { Bindings } from "../index";

export async function publishPushMessage(env: Bindings, message: PushMessage): Promise<void> {
  try {
    const objectId = env.WS.idFromName("global");
    const stub = env.WS.get(objectId);
    await stub.fetch("https://ws.internal/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
  } catch {
    // Push is best-effort and should never break request flow.
  }
}

export async function publishEntityChanged(
  env: Bindings,
  payload: {
    entityType: string;
    entityId: string;
    hint: string;
  },
): Promise<void> {
  await publishPushMessage(env, {
    type: "entity_changed",
    entity_type: payload.entityType,
    entity_id: payload.entityId,
    updated_at: new Date().toISOString(),
    hint: payload.hint,
  });
}

export async function publishMemberOnline(
  env: Bindings,
  payload: {
    userId: string;
    source: "portal" | "discord" | "wechat";
  },
): Promise<void> {
  await publishPushMessage(env, {
    type: "member_online",
    user_id: payload.userId,
    source: payload.source,
    online_at: new Date().toISOString(),
  });
}

export async function publishEventReminder(
  env: Bindings,
  payload: {
    eventId: string;
    title: string;
    startsAt: string;
    platforms: Array<"discord" | "wechat">;
  },
): Promise<void> {
  await publishPushMessage(env, {
    type: "event_reminder",
    event_id: payload.eventId,
    title: payload.title,
    starts_at: payload.startsAt,
    platforms: payload.platforms,
    generated_at: new Date().toISOString(),
  });
}

export async function publishAnnouncementPublished(
  env: Bindings,
  payload: {
    announcementId: string;
    title: string;
    publishedAt?: string;
  },
): Promise<void> {
  await publishPushMessage(env, {
    type: "announcement_published",
    announcement_id: payload.announcementId,
    title: payload.title,
    published_at: payload.publishedAt ?? new Date().toISOString(),
  });
}
