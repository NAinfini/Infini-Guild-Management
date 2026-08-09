import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared";
import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  announcements,
  events,
  galleryItems,
  memberProfiles,
  roles,
  users,
  warHistory,
  wikiArticles,
} from "../db/schema";
import { escapeLikePattern } from "./helpers";
import { eventPublicVisibilityFilter } from "./events/event-visibility";
import { ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;

export type SearchResultType = "user" | "event" | "announcement" | "wiki" | "gallery" | "war";

export type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  type: SearchResultType;
  to: string;
  entity_id?: string;
  role?: string;
  role_name?: string;
  role_color?: string | null;
  role_level?: number;
};

type SearchInput = {
  query?: string;
  limit?: string;
  features?: FeatureFlags;
};

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, parsed);
}

function likePattern(query: string): string {
  return `%${escapeLikePattern(query.toLowerCase())}%`;
}

export class SearchService {
  constructor(private readonly db: DrizzleDb) {}

  async search(input: SearchInput): Promise<ServiceResult<{ data: SearchResult[] }>> {
    const query = (input.query ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    if (query.length < MIN_QUERY_LENGTH) return ok({ data: [] });

    const limit = parseLimit(input.limit);
    const features = input.features ?? DEFAULT_FEATURE_FLAGS;
    const perTypeLimit = Math.max(3, Math.ceil(limit / 3));
    const pattern = likePattern(query);
    const [userRows, eventRows, announcementRows, wikiRows, galleryRows, warRows] = await Promise.all([
      this.db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          roleName: roles.name,
          roleColor: roles.color,
          roleLevel: roles.level,
          power: memberProfiles.power,
        })
        .from(users)
        .innerJoin(roles, eq(users.role, roles.id))
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(and(isNull(users.deletedAt), eq(users.isActive, true), sql`lower(${users.username}) LIKE ${pattern} ESCAPE '\\'`))
        .orderBy(users.username, users.id)
        .limit(perTypeLimit),
      this.db
        .select({ id: events.id, title: events.title, type: events.type, startAt: events.startAt })
        .from(events)
        .where(and(
          isNull(events.archivedAt),
          eventPublicVisibilityFilter(new Date().toISOString()),
          or(sql`lower(${events.title}) LIKE ${pattern} ESCAPE '\\'`, sql`lower(${events.description}) LIKE ${pattern} ESCAPE '\\'`)!,
        ))
        .orderBy(events.startAt, events.id)
        .limit(perTypeLimit),
      this.db
        .select({ id: announcements.id, title: announcements.title, createdAt: announcements.createdAt })
        .from(announcements)
        .where(and(eq(announcements.status, "published"), or(sql`lower(${announcements.title}) LIKE ${pattern} ESCAPE '\\'`, like(announcements.bodyJson, pattern))!))
        .orderBy(desc(announcements.pinned), desc(announcements.createdAt), announcements.id)
        .limit(perTypeLimit),
      this.db
        .select({ id: wikiArticles.id, title: wikiArticles.title, slug: wikiArticles.slug, updatedAt: wikiArticles.updatedAt })
        .from(wikiArticles)
        .where(and(isNull(wikiArticles.archivedAt), or(sql`lower(${wikiArticles.title}) LIKE ${pattern} ESCAPE '\\'`, like(wikiArticles.bodyJson, pattern))!))
        .orderBy(desc(wikiArticles.pinned), desc(wikiArticles.updatedAt), wikiArticles.id)
        .limit(perTypeLimit),
      this.db
        .select({ id: galleryItems.id, type: galleryItems.type, caption: galleryItems.caption, createdAt: galleryItems.createdAt })
        .from(galleryItems)
        .where(sql`lower(coalesce(${galleryItems.caption}, '')) LIKE ${pattern} ESCAPE '\\'`)
        .orderBy(desc(galleryItems.createdAt), galleryItems.id)
        .limit(perTypeLimit),
      this.db
        .select({ id: warHistory.id, warName: warHistory.warName, enemyName: warHistory.enemyName, createdAt: warHistory.createdAt })
        .from(warHistory)
        .where(or(sql`lower(${warHistory.warName}) LIKE ${pattern} ESCAPE '\\'`, sql`lower(coalesce(${warHistory.enemyName}, '')) LIKE ${pattern} ESCAPE '\\'`))
        .orderBy(desc(warHistory.createdAt), warHistory.id)
        .limit(perTypeLimit),
    ]);

    return ok({
      data: [
        ...userRows.map((row): SearchResult => ({
          id: row.id,
          title: row.username,
          subtitle: `${row.roleName}${row.power ? ` · ${Math.round(row.power).toLocaleString()} power` : ""}`,
          type: "user",
          to: "/roster",
          entity_id: row.id,
          role: row.role,
          role_name: row.roleName,
          role_color: row.roleColor,
          role_level: row.roleLevel,
        })),
        ...(features.events ? eventRows.map((row): SearchResult => ({
          id: row.id,
          title: row.title,
          subtitle: `${row.type} · ${new Date(row.startAt).toLocaleDateString("en-US")}`,
          type: "event",
          to: "/events",
          entity_id: row.id,
        })) : []),
        ...(features.announcements ? announcementRows.map((row): SearchResult => ({
          id: row.id,
          title: row.title,
          subtitle: "Announcement",
          type: "announcement",
          to: "/announcements",
          entity_id: row.id,
        })) : []),
        ...(features.wiki ? wikiRows.map((row): SearchResult => ({
          id: row.id,
          title: row.title,
          subtitle: "Wiki article",
          type: "wiki",
          to: "/wiki",
          entity_id: row.slug,
        })) : []),
        ...(features.gallery ? galleryRows.map((row): SearchResult => ({
          id: row.id,
          title: row.caption?.trim() || `${row.type[0]?.toUpperCase()}${row.type.slice(1)} item`,
          subtitle: "Gallery",
          type: "gallery",
          to: "/gallery",
          entity_id: row.id,
        })) : []),
        ...(features.guildWar ? warRows.map((row): SearchResult => ({
          id: row.id,
          title: row.warName,
          subtitle: row.enemyName ? `vs ${row.enemyName}` : "Guild war",
          type: "war",
          to: "/guild-war",
          entity_id: row.id,
        })) : []),
      ].slice(0, limit),
    });
  }
}
