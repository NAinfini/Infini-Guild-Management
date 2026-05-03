import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { announcements } from "../db/schema";
import type { Bindings } from "../index";
import { publishAnnouncementPublished, publishEntityChanged } from "../services/push";

export async function runAnnouncementPublishCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const nowIso = new Date().toISOString();

  const dueAnnouncements = await db
    .select({
      id: announcements.id,
      title: announcements.title,
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

  let archivedCount = 0;
  for (const item of expiredAnnouncements) {
    try {
      await db
        .update(announcements)
        .set({
          status: "archived",
          archivedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(announcements.id, item.id));
      archivedCount += 1;
    } catch (e) {
      console.error(`[announcement-expiry] failed to archive announcement ${item.id}`, e);
    }
  }
  if (archivedCount > 0) {
    console.log(`[announcement-expiry] Auto-archived ${archivedCount} expired announcement(s).`);
  }
}
