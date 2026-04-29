import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { announcements } from "../db/schema";
import type { Bindings } from "../index";
import { createBotTask } from "../services/bot-dispatch";
import { publishAnnouncementPublished, publishEntityChanged } from "../services/push";

export async function runAnnouncementPublishCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const nowIso = new Date().toISOString();

  const dueAnnouncements = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      bodyJson: announcements.bodyJson,
      publishAt: announcements.publishAt,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "scheduled"),
        isNull(announcements.archivedAt),
        lte(announcements.publishAt, nowIso),
      ),
    );

  for (const item of dueAnnouncements) {
    try {
      await db
        .update(announcements)
        .set({
          status: "published",
          updatedAt: nowIso,
        })
        .where(eq(announcements.id, item.id));
      await publishEntityChanged(env, {
        entityType: "announcement",
        entityId: item.id,
        hint: "announcement_published",
      });
      await publishAnnouncementPublished(env, {
        announcementId: item.id,
        title: item.title,
        publishedAt: item.publishAt ?? nowIso,
      });

      const payload = {
        announcement_id: item.id,
        title: item.title,
        body_json: item.bodyJson,
        publish_at: item.publishAt,
      };

      await createBotTask(env, {
        platform: "discord",
        taskType: "event_notify",
        targetId: "announcement:discord:broadcast",
        idempotencyKey: `announcement-publish:discord:${item.id}`,
        payload,
        dispatchNow: true,
      });

      await createBotTask(env, {
        platform: "wechat",
        taskType: "event_notify",
        targetId: "announcement:wechat:broadcast",
        idempotencyKey: `announcement-publish:wechat:${item.id}`,
        payload,
        dispatchNow: true,
      });
    } catch (e) {
      console.error(`[announcement-publish] failed to process announcement ${item.id}`, e);
    }
  }
}

export async function runAnnouncementExpiryCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const nowIso = new Date().toISOString();

  const expiredAnnouncements = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "published"),
        isNotNull(announcements.expiresAt),
        lte(announcements.expiresAt, nowIso),
        isNull(announcements.archivedAt),
      ),
    );

  if (expiredAnnouncements.length > 0) {
    for (const item of expiredAnnouncements) {
      await db
        .update(announcements)
        .set({
          status: "archived",
          archivedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(announcements.id, item.id));
    }
    console.log(`[announcement-expiry] Auto-archived ${expiredAnnouncements.length} expired announcement(s).`);
  }
}
