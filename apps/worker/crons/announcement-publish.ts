import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { announcements } from "../db/schema";
import type { Bindings } from "../index";
import { publishAnnouncementPublished, publishEntityChanged } from "../services/push";

const D1_SAFE_VARIABLE_LIMIT = 90;

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += D1_SAFE_VARIABLE_LIMIT) {
    chunks.push(ids.slice(index, index + D1_SAFE_VARIABLE_LIMIT));
  }
  return chunks;
}

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
        lte(announcements.publishAt, nowIso),
      ),
    );

  const dueAnnouncementIds = dueAnnouncements.map((item) => item.id);
  for (const ids of chunkIds(dueAnnouncementIds)) {
    await db
      .update(announcements)
      .set({
        status: "published",
        updatedAt: nowIso,
      })
      .where(inArray(announcements.id, ids));
  }

  for (const item of dueAnnouncements) {
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
  }

  const expiredAnnouncements = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "published"),
        isNotNull(announcements.expiresAt),
        lte(announcements.expiresAt, nowIso),
      ),
    );

  const expiredIds = expiredAnnouncements.map((item) => item.id);
  for (const ids of chunkIds(expiredIds)) {
    await db
      .update(announcements)
      .set({
        status: "archived",
        archivedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(inArray(announcements.id, ids));
  }

  for (const item of expiredAnnouncements) {
    await publishEntityChanged(env, {
      entityType: "announcement",
      entityId: item.id,
      hint: "announcement_archived",
    });
  }
}
