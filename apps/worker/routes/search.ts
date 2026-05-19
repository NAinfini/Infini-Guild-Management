import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  announcements,
  events,
  galleryItems,
  memberProfiles,
  users,
  warHistory,
  wikiArticles,
} from "../db/schema";
import type { Bindings } from "../index";
import { requireSessionUser } from "./_shared";
import { escapeLikePattern } from "../services/helpers";

type SearchResultType = "user" | "event" | "announcement" | "wiki" | "gallery" | "war";

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  type: SearchResultType;
  to: string;
  entity_id?: string;
  role?: string;
};

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

export const searchRoutes = new Hono();

function getDb(c: Context) {
  return drizzle((c.env as Bindings).DB);
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, parsed);
}

function likePattern(query: string): string {
  return `%${escapeLikePattern(query.toLowerCase())}%`;
}

searchRoutes.get("/", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;

  const query = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < MIN_QUERY_LENGTH) return c.json({ data: [] });

  const db = getDb(c);
  const limit = parseLimit(c.req.query("limit"));
  const perTypeLimit = Math.max(3, Math.ceil(limit / 3));
  const pattern = likePattern(query);

  const [
    userRows,
    eventRows,
    announcementRows,
    wikiRows,
    galleryRows,
    warRows,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        classes: memberProfiles.classes,
        power: memberProfiles.power,
      })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(isNull(users.deletedAt), eq(users.isActive, true), sql`lower(${users.username}) LIKE ${pattern} ESCAPE '\\'`))
      .orderBy(users.username, users.id)
      .limit(perTypeLimit),
    db
      .select({ id: events.id, title: events.title, type: events.type, startAt: events.startAt })
      .from(events)
      .where(and(isNull(events.archivedAt), eq(events.isSeriesParent, false), or(sql`lower(${events.title}) LIKE ${pattern} ESCAPE '\\'`, sql`lower(${events.description}) LIKE ${pattern} ESCAPE '\\'`)!))
      .orderBy(events.startAt, events.id)
      .limit(perTypeLimit),
    db
      .select({ id: announcements.id, title: announcements.title, createdAt: announcements.createdAt })
      .from(announcements)
      .where(and(eq(announcements.status, "published"), or(sql`lower(${announcements.title}) LIKE ${pattern} ESCAPE '\\'`, like(announcements.bodyJson, pattern))!))
      .orderBy(desc(announcements.pinned), desc(announcements.createdAt), announcements.id)
      .limit(perTypeLimit),
    db
      .select({ id: wikiArticles.id, title: wikiArticles.title, slug: wikiArticles.slug, updatedAt: wikiArticles.updatedAt })
      .from(wikiArticles)
      .where(and(isNull(wikiArticles.archivedAt), or(sql`lower(${wikiArticles.title}) LIKE ${pattern} ESCAPE '\\'`, like(wikiArticles.bodyJson, pattern))!))
      .orderBy(desc(wikiArticles.pinned), desc(wikiArticles.updatedAt), wikiArticles.id)
      .limit(perTypeLimit),
    db
      .select({ id: galleryItems.id, type: galleryItems.type, caption: galleryItems.caption, createdAt: galleryItems.createdAt })
      .from(galleryItems)
      .where(sql`lower(coalesce(${galleryItems.caption}, '')) LIKE ${pattern} ESCAPE '\\'`)
      .orderBy(desc(galleryItems.createdAt), galleryItems.id)
      .limit(perTypeLimit),
    db
      .select({ id: warHistory.id, warName: warHistory.warName, enemyName: warHistory.enemyName, createdAt: warHistory.createdAt })
      .from(warHistory)
      .where(or(sql`lower(${warHistory.warName}) LIKE ${pattern} ESCAPE '\\'`, sql`lower(coalesce(${warHistory.enemyName}, '')) LIKE ${pattern} ESCAPE '\\'`))
      .orderBy(desc(warHistory.createdAt), warHistory.id)
      .limit(perTypeLimit),
  ]);

  const data: SearchResult[] = [
    ...userRows.map((row): SearchResult => ({
      id: row.id,
      title: row.username,
      subtitle: `${row.role}${row.power ? ` · ${Math.round(row.power).toLocaleString()} power` : ""}`,
      type: "user",
      to: "/roster",
      entity_id: row.id,
      role: row.role,
    })),
    ...eventRows.map((row): SearchResult => ({
      id: row.id,
      title: row.title,
      subtitle: `${row.type} · ${new Date(row.startAt).toLocaleDateString("en-US")}`,
      type: "event",
      to: "/events",
      entity_id: row.id,
    })),
    ...announcementRows.map((row): SearchResult => ({
      id: row.id,
      title: row.title,
      subtitle: "Announcement",
      type: "announcement",
      to: "/announcements",
      entity_id: row.id,
    })),
    ...wikiRows.map((row): SearchResult => ({
      id: row.id,
      title: row.title,
      subtitle: "Wiki article",
      type: "wiki",
      to: "/wiki",
      entity_id: row.slug,
    })),
    ...galleryRows.map((row): SearchResult => ({
      id: row.id,
      title: row.caption?.trim() || `${row.type[0]?.toUpperCase()}${row.type.slice(1)} item`,
      subtitle: "Gallery",
      type: "gallery",
      to: "/gallery",
      entity_id: row.id,
    })),
    ...warRows.map((row): SearchResult => ({
      id: row.id,
      title: row.warName,
      subtitle: row.enemyName ? `vs ${row.enemyName}` : "Guild war",
      type: "war",
      to: "/guild-war",
      entity_id: row.id,
    })),
  ].slice(0, limit);

  return c.json({ data });
});
